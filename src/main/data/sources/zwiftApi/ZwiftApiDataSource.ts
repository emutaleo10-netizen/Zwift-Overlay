import fs from 'node:fs'
import path from 'node:path'
import type { GroupNode, MapEntity, MetricKey, RawSample, SourceStatus, TrailPoint } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'
import { findActiveRouteProfile } from '@shared/zwiftRoutes'
import { debugLog } from '../../../debugLogger'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { detectZwiftDataDir, parseZwiftLogLine, resolveZwiftLogPath } from '../zwiftLog/ZwiftLogDataSource'
import {
  type AthleteProfileLite,
  fetchAthleteProfilesBatch,
  makeAthleteInitials,
  ZwiftGameMonitor
} from './zwiftGameMonitor'
import {
  decodeDropInWorldListProtobuf,
  decodePlayerStateJson,
  decodePlayerStateProtobuf,
  type ZwiftDropInPlayer,
  type ZwiftPlayerState
} from './zwiftProto'

export interface ZwiftApiOptions {
  /** 観戦用 (Monitor) Zwift アカウントのメールアドレス */
  username: string
  /** 観戦用 (Monitor) Zwift アカウントのパスワード */
  password: string
  /** 監視対象の Player ID (空欄または 0 の場合は Log.txt から自動検出) */
  playerId: number
  /** ポーリング間隔 (ms) 既定 1500ms (レート制限回避のため) */
  pollMs: number
}

export function parseZwiftApiOptions(raw: unknown): ZwiftApiOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const username = typeof r.username === 'string' ? r.username.trim() : ''
  const password = typeof r.password === 'string' ? r.password : ''
  const playerId = typeof r.playerId === 'number' && Number.isFinite(r.playerId) ? Math.round(r.playerId) : 0
  const pollMs = typeof r.pollMs === 'number' && r.pollMs >= 1000 ? Math.min(5000, r.pollMs) : 1500
  return { username, password, playerId, pollMs }
}

/**
 * Log.txt からメインアカウントの Player ID、ルート名、最新の勾配・座標を自動検出する。
 */
export function detectPlayerAndWorldFromLog(logPath?: string): {
  playerId: number | null
  worldId: number
  routeName: string
  latestGradePct: number
  latestWorldPos?: { x: number; y: number; z: number }
} {
  const dir = detectZwiftDataDir()
  const targetLog = logPath || resolveZwiftLogPath(dir)
  let playerId: number | null = null
  let worldId = 1
  let routeName = ''
  let latestGradePct = 0
  let latestWorldPos: { x: number; y: number; z: number } | undefined

  try {
    if (!fs.existsSync(targetLog)) {
      const prefsPath = path.join(dir, 'prefs.xml')
      if (fs.existsSync(prefsPath)) {
        const prefs = fs.readFileSync(prefsPath, 'utf8')
        const m = /<USER\s+id="(\d+)"/i.exec(prefs)
        if (m) playerId = Number(m[1])
      }
      return { playerId, worldId, routeName, latestGradePct }
    }

    const content = fs.readFileSync(targetLog, 'utf8')
    const pidMatches = content.match(/Player ID:\s*(\d+)/gi)
    if (pidMatches && pidMatches.length > 0) {
      const last = pidMatches[pidMatches.length - 1]
      const m = /(\d+)/.exec(last)
      if (m) playerId = Number(m[1])
    }

    const tail = content.slice(-32768)
    const lines = tail.split(/\r?\n/)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!routeName) {
        const rm = /on route:\s*"([^"]+)"|Setting Route:\s*(.+)$/i.exec(line)
        if (rm) routeName = (rm[1] || rm[2] || '').trim()
      }
      const parsed = parseZwiftLogLine(line)
      if (parsed.gradePct !== undefined && latestGradePct === 0) {
        latestGradePct = parsed.gradePct
      }
      if (parsed.worldPos && !latestWorldPos) {
        latestWorldPos = parsed.worldPos
      }
    }
  } catch {
    // ignore
  }

  return { playerId, worldId, routeName, latestGradePct, latestWorldPos }
}

const TOKEN_ENDPOINT = 'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token'
const RELAY_BASE = 'https://us-or-rly101.zwift.com'

function roadCompletion(state: ZwiftPlayerState): number | null {
  if (state.roadId === undefined || state.roadTime <= 0) return null
  return state.reverse ? 1005000 - state.roadTime : state.roadTime - 5000
}

/**
 * Sauce for Zwift と同じく Zwift 公式 Relay サーバー (`/relay/worlds/1/players/{id}` および TCP/UDP GameMonitor ストリーム)
 * へ接続し、リアルタイムテレメトリ・周囲の全 Zwifter のグループギャップ・公式ワールドマップ座標を配信する DataSource。
 */
export class ZwiftApiDataSource implements DataSource {
  readonly id = 'zwift-api'
  readonly displayName = 'Zwift ライブ通信 (Relay API / Sauce方式)'
  readonly capabilities: ReadonlySet<MetricKey> = new Set<MetricKey>([
    'power',
    'heartRate',
    'cadence',
    'speed',
    'distance',
    'world'
  ])

  private readonly samples = new Emitter<RawSample>()
  private readonly statuses = new Emitter<SourceStatus>()
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt = 0

  private pollTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private dropInTimer: NodeJS.Timeout | null = null
  private profileBatchTimer: NodeJS.Timeout | null = null
  private gameMonitor: ZwiftGameMonitor | null = null

  private targetPlayerId = 0
  private latestGradePct = 0
  private routeName = ''
  private zwiftDir: string
  private logPath: string
  private logOffset = 0
  private busy = false
  private rateLimitBackoffUntil = 0
  private lastMonitorSelfAt = 0
  /** 今回のライドセッションが実際に動き出したか（前回ライドの静止キャッシュを除外するため） */
  private hasActiveSession = false
  private initialObservedState: { worldTime?: number; distanceM: number; x?: number; y?: number } | null = null

  /** 最新の自己状態（APIレスポンス間の1Hzハートビート補間・維持用） */
  private lastState: ZwiftPlayerState | null = null
  /** TCP/UDP GameMonitor ストリームからリアルタイムに受信した周囲の Zwifter 状態 */
  private readonly liveNearbyStates = new Map<number, { state: ZwiftPlayerState; updatedAt: number }>()
  /** 周囲の Zwifter のプロフィール（イニシャル・名前）キャッシュ */
  private readonly profileCache = new Map<number, AthleteProfileLite>()
  private readonly pendingProfileIds = new Set<number>()
  /** `/relay/dropin` フォールバック一覧 */
  private dropInPlayers: ZwiftDropInPlayer[] = []
  /** 実走行の 3D ワールド座標 (x, y, altitudeM, ts) の軌跡（ライド全体を保持） */
  private rawTrail: { x: number; y: number; alt: number; ts: number }[] = []
  /** 自車の道路進行履歴（同一道路上の後続ライダーとの正確な実測タイムギャップ算出用） */
  private selfRoadCheckpoints: { ts: number; roadId: number; reverse: boolean; completion: number; x: number; y: number }[] = []

  constructor(
    private readonly opts: ZwiftApiOptions,
    _ctx: DataSourceContext
  ) {
    this.zwiftDir = detectZwiftDataDir()
    this.logPath = resolveZwiftLogPath(this.zwiftDir)
  }

  async start(): Promise<void> {
    if (this.pollTimer) return
    this.statuses.emit({ state: 'connecting' })
    debugLog.info('ZwiftAPI', `Starting ZwiftApiDataSource (pollMs=${this.opts.pollMs}, zwiftDir=${this.zwiftDir})`)

    const detected = detectPlayerAndWorldFromLog(this.logPath)
    this.targetPlayerId = this.opts.playerId > 0 ? this.opts.playerId : (detected.playerId ?? 0)
    // 同日の前回ライド情報を引き継がないよう、起動時はルート名・勾配・状態・トレイルをすべて初期化
    this.latestGradePct = 0
    this.routeName = ''
    this.lastState = null
    this.hasActiveSession = false
    this.initialObservedState = null
    this.liveNearbyStates.clear()
    this.dropInPlayers = []

    debugLog.info('ZwiftAPI', `Detected targetPlayerId=${this.targetPlayerId} (clean session start)`)

    // 前回のライド座標からのワープ線を防ぐため、起動時は常に空のトレイルから開始する
    this.rawTrail = []
    this.selfRoadCheckpoints = []

    try {
      if (fs.existsSync(this.logPath)) {
        // 前回ライドのログ行を誤読しないよう、現在ファイル末尾から監視を開始する
        this.logOffset = fs.statSync(this.logPath).size
      }
    } catch {
      this.logOffset = 0
    }

    if (!this.opts.username || !this.opts.password) {
      const msg = '設定画面で観戦用 Zwift アカウントのメールアドレスとパスワードを入力してください'
      debugLog.warn('ZwiftAPI', msg)
      this.statuses.emit({ state: 'error', message: msg })
      return
    }

    if (!this.targetPlayerId) {
      const msg = '監視対象の Player ID が未設定です（Log.txt から自動検出できない場合は手入力してください）'
      debugLog.warn('ZwiftAPI', msg)
      this.statuses.emit({ state: 'error', message: msg })
      return
    }

    try {
      await this.authenticate()
      this.statuses.emit({ state: 'connected' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      debugLog.error('ZwiftAPI', `Authentication failed: ${msg}`)
      this.statuses.emit({ state: 'error', message: msg })
      return
    }

    // 初回 PlayerState 取得
    await this.pollPlayerState()

    // Sauce 方式の TCP/UDP GameMonitor ストリームを開始（周囲の全 Zwifter の PlayerState をリアルタイム受信）
    this.gameMonitor = new ZwiftGameMonitor(() => this.accessToken, this.targetPlayerId)
    if (this.lastState) {
      this.gameMonitor.updateWatchingState(this.lastState)
    }
    this.gameMonitor.on('playerStates', (states: ZwiftPlayerState[]) => {
      this.onMonitorPlayerStates(states)
    })
    void this.gameMonitor.start()

    // フォールバック用の REST ポーリング (既定 1.5s)
    this.pollTimer = setInterval(() => {
      void this.pollPlayerState()
    }, this.opts.pollMs)

    // DropIn ポーリング (10s 周期、UDP確立前の補助用)
    void this.pollDropInPlayers()
    this.dropInTimer = setInterval(() => {
      if (this.liveNearbyStates.size === 0) {
        void this.pollDropInPlayers()
      }
    }, 10000)

    // 周囲ライダーのイニシャル・名前を 2秒おきにバッチ取得
    this.profileBatchTimer = setInterval(() => {
      void this.drainPendingProfiles()
    }, 2000)

    // 1秒ごとのハートビート配信
    this.heartbeatTimer = setInterval(() => {
      this.updateFromLogTail()
      if (this.lastState) {
        this.emitCurrentSnapshot()
      }
    }, 1000)
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.dropInTimer) clearInterval(this.dropInTimer)
    if (this.profileBatchTimer) clearInterval(this.profileBatchTimer)
    this.pollTimer = null
    this.heartbeatTimer = null
    this.dropInTimer = null
    this.profileBatchTimer = null
    if (this.gameMonitor) {
      this.gameMonitor.stop()
      this.gameMonitor = null
    }
    this.liveNearbyStates.clear()
    this.pendingProfileIds.clear()
    this.accessToken = null
    this.refreshToken = null
    debugLog.info('ZwiftAPI', 'Stopped ZwiftApiDataSource')
    this.statuses.emit({ state: 'stopped' })
  }

  onSample(listener: (sample: RawSample) => void): Unsubscribe {
    return this.samples.on(listener)
  }

  onStatus(listener: (status: SourceStatus) => void): Unsubscribe {
    return this.statuses.on(listener)
  }

  private onMonitorPlayerStates(states: ZwiftPlayerState[]): void {
    const now = Date.now()
    for (const s of states) {
      if (s.id === this.targetPlayerId) {
        this.lastMonitorSelfAt = now
        this.ingestSelfState(s)
      } else {
        this.liveNearbyStates.set(s.id, { state: s, updatedAt: now })
        if (!this.profileCache.has(s.id)) {
          this.pendingProfileIds.add(s.id)
        }
      }
    }
  }

  private async drainPendingProfiles(): Promise<void> {
    if (!this.accessToken || this.pendingProfileIds.size === 0) return
    const batch = Array.from(this.pendingProfileIds).slice(0, 30)
    for (const id of batch) {
      this.pendingProfileIds.delete(id)
    }
    try {
      const profiles = await fetchAthleteProfilesBatch(this.accessToken, batch)
      for (const p of profiles) {
        this.profileCache.set(p.id, p)
      }
    } catch {
      // ignore
    }
  }

  private ingestSelfState(state: ZwiftPlayerState): void {
    // 起動直後に Relay REST API が前回ライド終了時の静止キャッシュを返している間は無視し、
    // 実際にペダリング/走行しているか worldTime・位置が動き出した瞬間にセッション開始とみなす
    if (!this.hasActiveSession) {
      const isMoving = state.powerWatts > 0 || state.speedKph > 1 || state.cadenceRpm > 0
      const init = this.initialObservedState
      const hasChangedFromInit =
        init !== null &&
        ((state.worldTime !== undefined && init.worldTime !== undefined && state.worldTime > init.worldTime) ||
          state.distanceM !== init.distanceM ||
          (state.x !== undefined &&
            state.y !== undefined &&
            init.x !== undefined &&
            init.y !== undefined &&
            Math.hypot(state.x - init.x, state.y - init.y) > 100))

      if (isMoving || hasChangedFromInit) {
        this.hasActiveSession = true
      } else {
        if (!init) {
          this.initialObservedState = {
            worldTime: state.worldTime,
            distanceM: state.distanceM,
            x: state.x,
            y: state.y
          }
        }
        return
      }
    }

    if (this.lastState) {
      // ワールド変更、距離リセット（新ライド開始）、または 250m 以上の瞬間移動（テレポート）を検出したら軌跡をリセット
      const courseChanged =
        state.courseId !== undefined &&
        this.lastState.courseId !== undefined &&
        state.courseId !== this.lastState.courseId
      const distanceReset =
        this.lastState.distanceM > 50 && state.distanceM < this.lastState.distanceM - 20
      const teleported =
        state.x !== undefined &&
        state.y !== undefined &&
        this.lastState.x !== undefined &&
        this.lastState.y !== undefined &&
        Math.hypot(state.x - this.lastState.x, state.y - this.lastState.y) > 25000

      if (courseChanged || distanceReset || teleported) {
        debugLog.info(
          'ZwiftAPI',
          `Resetting map trail (courseChanged=${courseChanged}, distanceReset=${distanceReset}, teleported=${teleported})`
        )
        this.rawTrail = []
        this.selfRoadCheckpoints = []
      } else if (
        this.lastState.worldTime !== undefined &&
        state.worldTime !== undefined &&
        state.worldTime <= this.lastState.worldTime &&
        this.lastState.worldTime - state.worldTime < 20000
      ) {
        // UDPストリームより古いRESTポーリング結果が遅れて届いた場合は無視（座標逆行による矢印180度反転を防止）
        return
      }
    }

    if (
      this.lastState &&
      state.altitudeM !== undefined &&
      this.lastState.altitudeM !== undefined &&
      state.distanceM > this.lastState.distanceM
    ) {
      const dDist = state.distanceM - this.lastState.distanceM
      const dAlt = state.altitudeM - this.lastState.altitudeM
      if (dDist >= 2 && dDist < 200) {
        const calcGrade = Math.max(-20, Math.min(20, (dAlt / dDist) * 100))
        this.latestGradePct = Math.round((this.latestGradePct * 0.6 + calcGrade * 0.4) * 10) / 10
      }
    }

    if (state.x !== undefined && state.y !== undefined) {
      this.appendRawTrailPoint(state.x, state.y, state.altitudeM ?? 20)
      const comp = roadCompletion(state)
      if (comp !== null && state.roadId !== undefined) {
        const now = Date.now()
        this.selfRoadCheckpoints.push({
          ts: now,
          roadId: state.roadId,
          reverse: Boolean(state.reverse),
          completion: comp,
          x: state.x,
          y: state.y
        })
        while (this.selfRoadCheckpoints.length > 120) {
          this.selfRoadCheckpoints.shift()
        }
      }
    }

    this.lastState = state
    this.gameMonitor?.updateWatchingState(state)
  }

  private async authenticate(): Promise<void> {
    const now = Date.now()
    if (this.accessToken && now < this.tokenExpiresAt - 60_000) return

    const body = new URLSearchParams()
    body.set('client_id', 'Zwift Game Client')
    if (this.refreshToken && now < this.tokenExpiresAt + 300_000) {
      body.set('grant_type', 'refresh_token')
      body.set('refresh_token', this.refreshToken)
      debugLog.debug('ZwiftAPI', 'Refreshing OAuth token...')
    } else {
      body.set('grant_type', 'password')
      body.set('username', this.opts.username)
      body.set('password', this.opts.password)
      debugLog.info('ZwiftAPI', `Authenticating with username=${this.opts.username}...`)
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Platform: 'OSX',
        Source: 'Game Client',
        'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
      },
      body: body.toString(),
      signal: AbortSignal.timeout(12000)
    })

    if (!res.ok) {
      this.refreshToken = null
      this.accessToken = null
      const errText = await res.text().catch(() => '')
      debugLog.error('ZwiftAPI', `OAuth HTTP ${res.status}: ${errText}`)
      throw new Error(`Zwift 認証エラー (${res.status}): アカウント情報を確認してください`)
    }

    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    this.accessToken = data.access_token
    if (data.refresh_token) this.refreshToken = data.refresh_token
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 21600) * 1000
    debugLog.info('ZwiftAPI', `OAuth token acquired (expires_in=${data.expires_in ?? 21600}s)`)
  }

  private updateFromLogTail(): void {
    try {
      const st = fs.statSync(this.logPath)
      if (st.size < this.logOffset) this.logOffset = 0
      if (st.size <= this.logOffset) return
      const len = Math.min(32768, st.size - this.logOffset)
      const buf = Buffer.alloc(len)
      const fd = fs.openSync(this.logPath, 'r')
      try {
        const read = fs.readSync(fd, buf, 0, len, this.logOffset)
        this.logOffset += read
        const lines = buf.subarray(0, read).toString('utf8').split(/\r?\n/)
        for (const line of lines) {
          const p = parseZwiftLogLine(line)
          if (p.gradePct !== undefined) this.latestGradePct = p.gradePct
          // Log.txt の worldPos はカメラ座標であり自車 PlayerState 座標とズレて矢印反転の原因になるため上書きしない
          const rm = /on route:\s*"([^"]+)"|Setting Route:\s*(.+)$/i.exec(line)
          if (rm) this.routeName = (rm[1] || rm[2] || '').trim()
        }
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // ignore
    }
  }

  private async pollPlayerState(): Promise<void> {
    if (this.busy) return
    // UDP GameMonitor から直近 3秒以内に自車状態を受信できている場合は REST ポーリングをスキップして競合を防ぐ
    if (Date.now() - this.lastMonitorSelfAt < 3000) return
    if (Date.now() < this.rateLimitBackoffUntil) return
    this.busy = true
    try {
      await this.authenticate()
      const state = await this.fetchPlayerState(this.targetPlayerId)
      if (state) {
        this.ingestSelfState(state)
        this.statuses.emit({ state: 'connected' })
        this.emitCurrentSnapshot()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      debugLog.warn('ZwiftAPI', `pollPlayerState warning: ${msg}`)
      if (!this.lastState) {
        this.statuses.emit({ state: 'error', message: msg })
      }
    } finally {
      this.busy = false
    }
  }

  private async fetchPlayerState(playerId: number): Promise<ZwiftPlayerState | null> {
    if (!this.accessToken) return null
    const url = `${RELAY_BASE}/relay/worlds/1/players/${playerId}`

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/x-protobuf-lite',
        Platform: 'OSX',
        Source: 'Game Client',
        'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
      },
      signal: AbortSignal.timeout(8000)
    })

    if (res.status === 429) {
      this.rateLimitBackoffUntil = Date.now() + 4000
      debugLog.warn('ZwiftAPI', 'HTTP 429 rate limited on getPlayerState; backing off 4s')
      return null
    }

    if (res.status === 404) {
      debugLog.debug(
        'ZwiftAPI',
        `HTTP 404 on /relay/worlds/1/players/${playerId}`
      )
      return null
    }

    if (res.status === 401) {
      this.accessToken = null
      debugLog.warn('ZwiftAPI', 'HTTP 401 token expired; will re-authenticate')
      return null
    }

    if (!res.ok) {
      debugLog.warn('ZwiftAPI', `HTTP ${res.status} from ${url}`)
      return null
    }

    const arrBuf = await res.arrayBuffer()
    const buf = Buffer.from(arrBuf)
    if (buf.length === 0) return null

    let state: ZwiftPlayerState | null = null
    if (buf[0] === 0x7b) {
      try {
        state = decodePlayerStateJson(JSON.parse(buf.toString('utf8')))
      } catch {
        // fallback
      }
    }
    if (!state) {
      state = decodePlayerStateProtobuf(buf)
    }

    if (state) {
      debugLog.debug(
        'ZwiftAPI',
        `PlayerState recv: id=${state.id} pwr=${state.powerWatts}W hr=${state.heartRateBpm}bpm cad=${state.cadenceRpm}rpm spd=${state.speedKph.toFixed(1)}kph dist=${state.distanceM}m course=${state.courseId ?? '-'} pos=(${Math.round(state.x ?? 0)},${Math.round(state.y ?? 0)}) nearby=${this.liveNearbyStates.size}`
      )
    }
    return state
  }

  private async pollDropInPlayers(): Promise<void> {
    if (!this.accessToken || Date.now() < this.rateLimitBackoffUntil) return
    try {
      const res = await fetch(`${RELAY_BASE}/relay/dropin`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/x-protobuf-lite',
          Platform: 'OSX',
          Source: 'Game Client',
          'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
        },
        signal: AbortSignal.timeout(10000)
      })
      if (!res.ok) return
      const buf = Buffer.from(await res.arrayBuffer())
      const worlds = decodeDropInWorldListProtobuf(buf)
      const myCourseId = this.lastState?.courseId
      const matchedWorlds =
        myCourseId !== undefined ? worlds.filter((w) => w.courseId === myCourseId) : worlds

      const players: ZwiftDropInPlayer[] = []
      const seen = new Set<number>()
      for (const w of matchedWorlds.length > 0 ? matchedWorlds : worlds) {
        for (const p of w.players) {
          if (p.athleteId !== this.targetPlayerId && !seen.has(p.athleteId) && p.speedKph > 1) {
            seen.add(p.athleteId)
            players.push(p)
          }
        }
      }
      this.dropInPlayers = players
    } catch {
      // ignore
    }
  }

  private appendRawTrailPoint(x: number, y: number, alt: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    // (0, 0) 付近の未初期化座標は無視
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return
    const last = this.rawTrail[this.rawTrail.length - 1]
    // 5m (500cm) 以上移動したときだけ軌跡点を追加して微小ノイズを防ぎつつライド全体を軽量保持
    if (last && Math.hypot(x - last.x, y - last.y) < 500) return
    this.rawTrail.push({ x, y, alt, ts: Date.now() })
    // 超ロングライドでもライド全体を残せるよう、上限超過時は古い区間を1点おきに間引く
    if (this.rawTrail.length > 6000) {
      const half = 3000
      const decimated: { x: number; y: number; alt: number; ts: number }[] = []
      for (let i = 0; i < half; i += 2) decimated.push(this.rawTrail[i])
      for (let i = half; i < this.rawTrail.length; i++) decimated.push(this.rawTrail[i])
      this.rawTrail = decimated
    }
  }

  /**
   * 自車の直近の進行方向単位ベクトル (vx, vy) を算出する。
   */
  private getSelfForwardVector(state: ZwiftPlayerState): { vx: number; vy: number } {
    if (this.rawTrail.length >= 2) {
      const last = this.rawTrail[this.rawTrail.length - 1]
      for (let i = this.rawTrail.length - 2; i >= Math.max(0, this.rawTrail.length - 6); i--) {
        const prev = this.rawTrail[i]
        const dx = last.x - prev.x
        const dy = last.y - prev.y
        const len = Math.hypot(dx, dy)
        if (len > 150) {
          return { vx: dx / len, vy: dy / len }
        }
      }
    }
    return {
      vx: Math.cos(state.headingRad),
      vy: Math.sin(state.headingRad)
    }
  }

  private projectWorldCoordinates(
    selfX: number | undefined,
    selfY: number | undefined,
    nearby: { id: string; label: string; rawX?: number; rawY?: number; gapSec: number; isSelf: boolean; power?: number }[],
    fallbackDistanceM: number
  ): {
    normSelfX: number
    normSelfY: number
    entities: MapEntity[]
    trail?: TrailPoint[]
  } {
    if (selfX === undefined || selfY === undefined) {
      const pos = sampleRouteByDistance(fallbackDistanceM)
      const entities: MapEntity[] = nearby.map((n) => {
        if (n.isSelf) return { id: n.id, label: n.label, x: pos.x, y: pos.y, isSelf: true }
        const np = sampleRouteByDistance(fallbackDistanceM - n.gapSec * 9.5)
        return { id: n.id, label: n.label, x: np.x, y: np.y, isSelf: false }
      })
      return { normSelfX: pos.x, normSelfY: pos.y, entities }
    }

    let minX = selfX
    let maxX = selfX
    let minY = selfY
    let maxY = selfY
    for (const pt of this.rawTrail) {
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
    }

    const span = Math.max(800, maxX - minX, maxY - minY) * 1.15
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    const toNorm = (rx: number, ry: number): { x: number; y: number } => ({
      x: Math.min(960, Math.max(40, 500 + ((rx - cx) / span) * 800)),
      y: Math.min(960, Math.max(40, 500 + ((ry - cy) / span) * 800))
    })

    const selfNorm = toNorm(selfX, selfY)
    const trail: TrailPoint[] = this.rawTrail.map((pt) => {
      const n = toNorm(pt.x, pt.y)
      return { x: n.x, y: n.y, altitudeM: pt.alt, ts: pt.ts, rawX: pt.x, rawY: pt.y }
    })

    const entities: MapEntity[] = nearby.map((n) => {
      if (n.isSelf) {
        return {
          id: n.id,
          label: n.label,
          x: selfNorm.x,
          y: selfNorm.y,
          rawX: selfX,
          rawY: selfY,
          isSelf: true,
          power: n.power
        }
      }
      if (n.rawX !== undefined && n.rawY !== undefined) {
        const p = toNorm(n.rawX, n.rawY)
        return {
          id: n.id,
          label: n.label,
          x: p.x,
          y: p.y,
          rawX: n.rawX,
          rawY: n.rawY,
          isSelf: false,
          power: n.power
        }
      }
      return { id: n.id, label: n.label, x: selfNorm.x, y: selfNorm.y, isSelf: false, power: n.power }
    })

    return { normSelfX: selfNorm.x, normSelfY: selfNorm.y, entities, trail }
  }

  /**
   * UDP GameMonitor から受信した周囲のライブ Zwifter 状態を自分との正確なタイムギャップ順および集団 (Pack) に変換する。
   */
  private buildGroupsAndNearby(state: ZwiftPlayerState): {
    nodes: GroupNode[]
    aheadCount: number
    behindCount: number
    totalAthletes: number
    nearbyCoords: { id: string; label: string; rawX?: number; rawY?: number; gapSec: number; isSelf: boolean; power?: number }[]
  } {
    const now = Date.now()
    // 15秒以上更新のない古いライダーを除外
    for (const [id, entry] of this.liveNearbyStates.entries()) {
      if (now - entry.updatedAt > 15000) {
        this.liveNearbyStates.delete(id)
      }
    }

    const selfSpeedMs = Math.max(4.5, state.speedMs)
    const selfX = state.x
    const selfY = state.y
    const selfComp = roadCompletion(state)
    const fwd = this.getSelfForwardVector(state)

    interface CandidateRider {
      athleteId: number
      initials: string
      powerWatts: number
      speedKph: number
      x?: number
      y?: number
      gapSec: number
    }

    const candidates: CandidateRider[] = []

    if (this.liveNearbyStates.size > 0) {
      for (const { state: p } of this.liveNearbyStates.values()) {
        // 違うワールドにいるライダーや完全停止中のライダーは除外
        if (state.courseId && p.courseId && p.courseId !== state.courseId) continue
        if (state.speedKph > 3 && p.speedKph < 0.5 && p.powerWatts === 0) continue

        let gapSec: number | null = null
        const pComp = roadCompletion(p)
        const dist3dM =
          selfX !== undefined && selfY !== undefined && p.x !== undefined && p.y !== undefined
            ? Math.hypot(p.x - selfX, p.y - selfY) / 100
            : null

        // 1. 同一 roadId & 同一進行方向のライダーは roadCompletion から正確な前後関係とタイムギャップを算出
        if (
          selfComp !== null &&
          pComp !== null &&
          p.roadId === state.roadId &&
          Boolean(p.reverse) === Boolean(state.reverse)
        ) {
          const compDiff = pComp - selfComp
          if (Math.abs(compDiff) < 500000) {
            const sign = compDiff >= 0 ? -1 : 1 // 前方は負、後方は正
            // 後続ライダーが自分の過去の通過チェックポイントと一致すれば実測時間差を使用
            if (sign > 0 && this.selfRoadCheckpoints.length >= 2) {
              for (let i = this.selfRoadCheckpoints.length - 1; i >= 0; i--) {
                const cp = this.selfRoadCheckpoints[i]
                if (cp.roadId === state.roadId && cp.reverse === Boolean(state.reverse) && cp.completion <= pComp) {
                  gapSec = Math.max(0.2, (now - cp.ts) / 1000)
                  break
                }
              }
            }
            if (gapSec === null) {
              const effSpeed = Math.max(4.5, (selfSpeedMs + Math.max(3, p.speedMs)) / 2)
              const dM = dist3dM ?? Math.abs(compDiff) * 0.005
              gapSec = sign * (dM / effSpeed)
            }
          }
        }

        // 2. 異なる道路または分岐付近のライダーは 3D 座標距離と進行方向ベクトルの内積から算出
        if (gapSec === null && dist3dM !== null && selfX !== undefined && selfY !== undefined && p.x !== undefined && p.y !== undefined) {
          if (dist3dM > 2500) continue // 2.5km 以上離れた別ルートのライダーは除外
          const dx = (p.x - selfX) / 100
          const dy = (p.y - selfY) / 100
          const dot = dx * fwd.vx + dy * fwd.vy
          const sign = dot >= 0 ? -1 : 1
          const effSpeed = Math.max(4.5, (selfSpeedMs + Math.max(3, p.speedMs)) / 2)
          gapSec = sign * (dist3dM / effSpeed)
        }

        if (gapSec === null || Math.abs(gapSec) > 600) continue

        const prof = this.profileCache.get(p.id)
        candidates.push({
          athleteId: p.id,
          initials: prof ? prof.initials : String(p.id).slice(-2),
          powerWatts: p.powerWatts,
          speedKph: p.speedKph,
          x: p.x,
          y: p.y,
          gapSec
        })
      }
    } else if (this.dropInPlayers.length > 0) {
      for (const p of this.dropInPlayers) {
        const dist3dM =
          selfX !== undefined && selfY !== undefined && p.x !== undefined && p.y !== undefined
            ? Math.hypot(p.x - selfX, p.y - selfY) / 100
            : Math.abs(p.distanceM - state.distanceM)
        const dx = selfX !== undefined && p.x !== undefined ? (p.x - selfX) / 100 : 1
        const dy = selfY !== undefined && p.y !== undefined ? (p.y - selfY) / 100 : 0
        const sign = dx * fwd.vx + dy * fwd.vy >= 0 ? -1 : 1
        candidates.push({
          athleteId: p.athleteId,
          initials: makeAthleteInitials(p.firstName, p.lastName, p.athleteId),
          powerWatts: p.powerWatts,
          speedKph: p.speedKph,
          x: p.x,
          y: p.y,
          gapSec: sign * (dist3dM / selfSpeedMs)
        })
      }
    }

    // 自分も含めた全ライダーを gapSec 昇順（前方:負 → 自分:0 → 後方:正）に並べて 1.8秒以内の集団にクラスタリング
    const allSorted: (CandidateRider & { isSelf?: boolean })[] = [
      ...candidates,
      {
        athleteId: state.id,
        initials: 'YOU',
        powerWatts: state.powerWatts,
        speedKph: state.speedKph,
        x: state.x,
        y: state.y,
        gapSec: 0,
        isSelf: true
      }
    ].sort((a, b) => a.gapSec - b.gapSec)

    interface RiderCluster {
      members: (CandidateRider & { isSelf?: boolean })[]
      containsSelf: boolean
      repGapSec: number
    }

    const clusters: RiderCluster[] = []
    for (const r of allSorted) {
      const lastCluster = clusters[clusters.length - 1]
      const lastMember = lastCluster?.members[lastCluster.members.length - 1]
      if (lastCluster && lastMember && r.gapSec - lastMember.gapSec <= 1.8) {
        lastCluster.members.push(r)
        if (r.isSelf) {
          lastCluster.containsSelf = true
          lastCluster.repGapSec = 0
        }
      } else {
        clusters.push({
          members: [r],
          containsSelf: Boolean(r.isSelf),
          repGapSec: r.isSelf ? 0 : r.gapSec
        })
      }
    }

    let selfClusterIdx = clusters.findIndex((c) => c.containsSelf)
    if (selfClusterIdx === -1) selfClusterIdx = 0

    // 各クラスタの自分基準ギャップ（前方クラスタは末尾メンバー、後方クラスタは先頭メンバー）を確定
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      if (i < selfClusterIdx) {
        c.repGapSec = Math.min(-1, Math.round(c.members[c.members.length - 1].gapSec))
      } else if (i > selfClusterIdx) {
        c.repGapSec = Math.max(1, Math.round(c.members[0].gapSec))
      } else {
        c.repGapSec = 0
      }
    }

    const aheadClusters = clusters.slice(0, selfClusterIdx)
    const behindClusters = clusters.slice(selfClusterIdx + 1)
    const visibleAhead = aheadClusters.slice(-4)
    const visibleBehind = behindClusters.slice(0, 2)
    const visibleClusters = [...visibleAhead, clusters[selfClusterIdx], ...visibleBehind]

    const nodes: GroupNode[] = visibleClusters.map((c, idx) => {
      const size = c.members.length
      if (c.containsSelf) {
        return {
          id: String(state.id),
          label: size > 1 ? String(size) : 'YOU',
          size,
          isSelf: true,
          gapFromPrevSec: 0,
          gapFromSelfSec: 0,
          power: state.powerWatts,
          speedKph: Math.round(state.speedKph)
        }
      }
      const avgPower = Math.round(c.members.reduce((acc, m) => acc + m.powerWatts, 0) / size)
      const avgSpeed = Math.round(c.members.reduce((acc, m) => acc + m.speedKph, 0) / size)
      const first = c.members[0]
      return {
        id: `grp-${first.athleteId}-${idx}`,
        label: size > 1 ? String(size) : first.initials,
        size,
        isSelf: false,
        gapFromPrevSec: 0,
        gapFromSelfSec: c.repGapSec,
        power: avgPower,
        speedKph: avgSpeed
      }
    })

    for (let i = 1; i < nodes.length; i++) {
      nodes[i].gapFromPrevSec = Math.max(1, Math.abs(nodes[i].gapFromSelfSec - nodes[i - 1].gapFromSelfSec))
    }

    // マップ上には周囲最大 60 名の全ライダーのドットを描画
    const mapRiders = candidates
      .slice()
      .sort((a, b) => Math.abs(a.gapSec) - Math.abs(b.gapSec))
      .slice(0, 60)

    const nearbyCoords = [
      ...mapRiders.map((r) => ({
        id: String(r.athleteId),
        label: r.initials,
        rawX: r.x,
        rawY: r.y,
        gapSec: r.gapSec,
        isSelf: false,
        power: r.powerWatts
      })),
      {
        id: String(state.id),
        label: 'YOU',
        rawX: state.x,
        rawY: state.y,
        gapSec: 0,
        isSelf: true,
        power: state.powerWatts
      }
    ]

    const totalAthletes = allSorted.length
    const hiddenAheadAthletes = aheadClusters
      .slice(0, Math.max(0, aheadClusters.length - visibleAhead.length))
      .reduce((acc, c) => acc + c.members.length, 0)
    const hiddenBehindAthletes = behindClusters
      .slice(visibleBehind.length)
      .reduce((acc, c) => acc + c.members.length, 0)

    return {
      nodes,
      aheadCount: hiddenAheadAthletes,
      behindCount: hiddenBehindAthletes,
      totalAthletes,
      nearbyCoords
    }
  }

  private emitCurrentSnapshot(): void {
    const state = this.lastState
    if (!state || !this.hasActiveSession) return
    const now = Date.now()
    const pos = sampleRouteByDistance(state.distanceM)
    const altitudeM = state.altitudeM !== undefined ? Math.round(state.altitudeM) : Math.round(pos.altitudeM)

    const { nodes, aheadCount, behindCount, totalAthletes, nearbyCoords } = this.buildGroupsAndNearby(state)
    const projected = this.projectWorldCoordinates(state.x, state.y, nearbyCoords, state.distanceM)
    const matchedRoute = findActiveRouteProfile({
      routeId: state.routeId,
      routeName: this.routeName,
      courseId: state.courseId
    })

    this.samples.emit({
      timestamp: now,
      power: state.powerWatts,
      heartRate: state.heartRateBpm > 0 ? state.heartRateBpm : undefined,
      cadence: state.cadenceRpm,
      speed: state.speedMs,
      distance: state.distanceM,
      world: {
        routeProgress: pos.progress,
        x: projected.normSelfX,
        y: projected.normSelfY,
        rawX: state.x,
        rawY: state.y,
        courseId: state.courseId,
        routeId: state.routeId,
        distanceM: state.distanceM,
        headingRad: state.headingRad || pos.headingRad,
        altitudeM,
        gradePct: this.latestGradePct,
        entities: projected.entities,
        trail: projected.trail,
        worldName: this.routeName || matchedRoute?.name || undefined,
        groups: {
          totalAthletes,
          aheadCount,
          behindCount,
          nodes
        }
      }
    })
  }
}
