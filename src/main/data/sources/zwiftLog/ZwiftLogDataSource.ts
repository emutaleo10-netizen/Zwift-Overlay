import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { steadySpeed } from '../mock/rideSimulator'
import { parseFitRecords, type FitRecord } from './fitParser'

export interface ZwiftLogOptions {
  /** 指定しない場合は自動検出 (%LOCALAPPDATA%\Zwift 等) */
  zwiftDir?: string
  logPath?: string
  pollMs: number
}

/**
 * ユーザーの環境から有効な Zwift データディレクトリを自動検出する。
 * 1. %LOCALAPPDATA%\Zwift (Zwift Launcher 1.1.15+ の UseLocalAppData=True 移行先)
 * 2. %USERPROFILE%\OneDrive\ドキュメント\Zwift
 * 3. %USERPROFILE%\OneDrive\Documents\Zwift
 * 4. %USERPROFILE%\Documents\Zwift
 */
export function detectZwiftDataDir(customDir?: string): string {
  const candidates: string[] = []
  if (customDir && customDir.trim() !== '') {
    const c = customDir.trim()
    // もし Log.txt へのファイルパスが直接指定されていたら親ディレクトリを辿る
    if (c.toLowerCase().endsWith('.txt')) {
      const parent = path.dirname(c)
      candidates.push(path.basename(parent).toLowerCase() === 'logs' ? path.dirname(parent) : parent)
    } else {
      candidates.push(c)
    }
  }

  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  candidates.push(
    path.join(localAppData, 'Zwift'),
    path.join(home, 'OneDrive', 'ドキュメント', 'Zwift'),
    path.join(home, 'OneDrive', 'Documents', 'Zwift'),
    path.join(home, 'Documents', 'Zwift'),
    path.join(home, 'ドキュメント', 'Zwift')
  )

  // Activities または Logs/Log.txt が存在し、かつ更新日時が新しいディレクトリを優先する
  let bestDir = candidates[0]
  let bestMtime = -1

  for (const dir of candidates) {
    try {
      const logCandidate1 = path.join(dir, 'Logs', 'Log.txt')
      const logCandidate2 = path.join(dir, 'Log.txt')
      const actDir = path.join(dir, 'Activities')

      let mtime = -1
      if (fs.existsSync(logCandidate1)) {
        mtime = Math.max(mtime, fs.statSync(logCandidate1).mtimeMs)
      }
      if (fs.existsSync(logCandidate2)) {
        mtime = Math.max(mtime, fs.statSync(logCandidate2).mtimeMs)
      }
      if (fs.existsSync(actDir)) {
        mtime = Math.max(mtime, fs.statSync(actDir).mtimeMs)
      }

      if (mtime > bestMtime) {
        bestMtime = mtime
        bestDir = dir
      }
    } catch {
      // ignore
    }
  }

  return bestDir
}

export function resolveZwiftLogPath(zwiftDir: string, explicitLogPath?: string): string {
  if (explicitLogPath && explicitLogPath.trim() !== '' && fs.existsSync(explicitLogPath.trim())) {
    return explicitLogPath.trim()
  }
  const inLogs = path.join(zwiftDir, 'Logs', 'Log.txt')
  if (fs.existsSync(inLogs)) return inLogs
  const inRoot = path.join(zwiftDir, 'Log.txt')
  if (fs.existsSync(inRoot)) return inRoot
  return inLogs
}

export function defaultZwiftLogPath(): string {
  const dir = detectZwiftDataDir()
  return resolveZwiftLogPath(dir)
}

export function parseZwiftLogOptions(raw: unknown): ZwiftLogOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const zwiftDir = typeof r.zwiftDir === 'string' ? r.zwiftDir.trim() : undefined
  const logPath = typeof r.logPath === 'string' ? r.logPath.trim() : undefined
  const pollMs = typeof r.pollMs === 'number' && r.pollMs >= 200 ? Math.min(5000, r.pollMs) : 500
  return { zwiftDir, logPath, pollMs }
}

export interface ParsedLogLine {
  power?: number
  heartRate?: number
  cadence?: number
  speed?: number
  gradePct?: number
  worldPos?: { x: number; y: number; z: number }
}

/**
 * Zwift の Log.txt 1行から勾配・3D座標・またはカスタムテレメトリ表記を抽出する。
 * 実際の Zwift Log.txt に出力される行:
 * - `FE-C SIM GRADE 0.032` または `FE-C SIM GRADE -0.015` (勾配: 比率または%)
 * - `FPS 52.54, 12481, 13518, -4897` (フレームレートとワールド X, Z, Y 座標)
 * - カスタム出力: `Power=240 HeartRate=152 Cadence=90`
 */
export function parseZwiftLogLine(line: string): ParsedLogLine {
  const out: ParsedLogLine = {}

  // 実 Zwift の FE-C SIM GRADE 行
  const gradeMatch = /\bFE-C\s+SIM\s+GRADE\s+(-?\d+(?:\.\d+)?)\b/i.exec(line)
  if (gradeMatch) {
    const rawGrade = Number(gradeMatch[1])
    if (Number.isFinite(rawGrade)) {
      // Zwift の FE-C SIM GRADE は -0.15〜+0.15 のような勾配比(slope)または%で出力される
      const pct = Math.abs(rawGrade) <= 0.45 && rawGrade !== 0 ? rawGrade * 100 : rawGrade
      out.gradePct = Math.round(pct * 10) / 10
    }
  }

  // 実 Zwift の FPS 行 (例: [0:26:24] FPS 52.54, 12481, 13518, -4897)
  const fpsMatch = /\bFPS\s+\d+(?:\.\d+)?\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\b/.exec(line)
  if (fpsMatch) {
    out.worldPos = {
      x: Number(fpsMatch[1]),
      z: Number(fpsMatch[2]),
      y: Number(fpsMatch[3])
    }
  }

  const pMatch = /\b(?:instant[_\s]?power|power|watts)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i.exec(line)
  if (pMatch) out.power = Math.round(Number(pMatch[1]))

  const hrMatch = /\b(?:heart[_\s]?rate|hr|bpm)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i.exec(line)
  if (hrMatch) out.heartRate = Math.round(Number(hrMatch[1]))

  const cadMatch = /\b(?:cadence|rpm)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i.exec(line)
  if (cadMatch) out.cadence = Math.round(Number(cadMatch[1]))

  const spdMatch = /\b(?:speed[_\s]?kph|kph)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i.exec(line)
  if (spdMatch) out.speed = Number(spdMatch[1]) / 3.6

  return out
}

/**
 * Zwift ローカルデータ連携 (Activities\*.fit + Logs\Log.txt ハイブリッド監視)。
 * - ANT+ 接続時でも Zwift 自身が書き出す `Activities\inProgressActivity.fit` および最新 `.fit` ファイルから
 *   パワー(W)・心拍(bpm)・ケイデンス(rpm)・速度(m/s)・距離(m)・標高(m) を直接バイナリデコードする。
 * - 同時に `Logs\Log.txt` の末尾を監視し、`FE-C SIM GRADE` (リアルタイム勾配) と `FPS` (ワールド座標) を取得する。
 * - FIT ファイルのフラッシュ間隔の合間も毎秒サンプルを補間配信するため、オーバーレイの表示が途切れない。
 */
export class ZwiftLogDataSource implements DataSource {
  readonly id = 'zwift-log'
  readonly displayName: string
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
  private readonly zwiftDir: string
  private readonly logPath: string
  private readonly activitiesDir: string

  private timer: NodeJS.Timeout | null = null
  private logOffset = 0
  private logRemainder = ''
  private lastFitPath = ''
  private lastFitMtime = 0
  private lastFitSize = 0

  private state: {
    power?: number
    heartRate?: number
    cadence?: number
    speed?: number
    distance?: number
    altitudeM?: number
    gradePct?: number
    hasData: boolean
  } = { hasData: false }

  constructor(
    private readonly opts: ZwiftLogOptions,
    private readonly ctx: DataSourceContext
  ) {
    this.zwiftDir = detectZwiftDataDir(opts.zwiftDir || opts.logPath)
    this.logPath = resolveZwiftLogPath(this.zwiftDir, opts.logPath)
    this.activitiesDir = path.join(this.zwiftDir, 'Activities')
    this.displayName = `Zwift ローカル (${path.basename(this.zwiftDir)})`
  }

  async start(): Promise<void> {
    if (this.timer) return
    this.statuses.emit({ state: 'connecting' })

    // 起動時に最新の FIT ファイルから直近レコードを読み込む
    this.pollFitFiles(true)

    try {
      const stat = fs.statSync(this.logPath)
      this.logOffset = Math.max(0, stat.size - 16384)
      this.pollLogFile()
      this.statuses.emit({ state: 'connected' })
    } catch {
      this.logOffset = 0
      if (this.state.hasData) {
        this.statuses.emit({ state: 'connected' })
      } else {
        this.statuses.emit({
          state: 'error',
          message: `Zwift データが見つかりません (${this.zwiftDir})`
        })
      }
    }

    if (this.state.hasData) {
      this.emitSample()
    }

    this.timer = setInterval(() => {
      this.pollFitFiles(false)
      this.pollLogFile()
      if (this.state.hasData) {
        this.emitSample()
      }
    }, this.opts.pollMs)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.statuses.emit({ state: 'stopped' })
  }

  onSample(listener: (sample: RawSample) => void): Unsubscribe {
    return this.samples.on(listener)
  }

  onStatus(listener: (status: SourceStatus) => void): Unsubscribe {
    return this.statuses.on(listener)
  }

  /**
   * Activities フォルダ内の最新 FIT ファイル (`inProgressActivity.fit` または直近の `.fit`) を検査し、
   * 更新があれば末尾の Record からパワー・心拍・ケイデンス・速度・距離・高度を取り込む。
   */
  private pollFitFiles(initial: boolean): void {
    if (!fs.existsSync(this.activitiesDir)) return
    let targetPath = ''
    let targetStat: fs.Stats | null = null

    try {
      const entries = fs.readdirSync(this.activitiesDir)
      for (const name of entries) {
        if (!name.toLowerCase().endsWith('.fit')) continue
        const full = path.join(this.activitiesDir, name)
        try {
          const st = fs.statSync(full)
          if (st.size < 64) continue
          if (!targetStat || st.mtimeMs > targetStat.mtimeMs) {
            targetStat = st
            targetPath = full
          }
        } catch {
          // ignore
        }
      }
    } catch {
      return
    }

    if (!targetStat || !targetPath) return
    if (
      !initial &&
      targetPath === this.lastFitPath &&
      targetStat.mtimeMs === this.lastFitMtime &&
      targetStat.size === this.lastFitSize
    ) {
      return
    }

    this.lastFitPath = targetPath
    this.lastFitMtime = targetStat.mtimeMs
    this.lastFitSize = targetStat.size

    try {
      const buf = fs.readFileSync(targetPath)
      const records = parseFitRecords(buf)
      if (records.length === 0) return

      // 末尾のレコードが 0W（ライド終了後の停止状態）で、かつ初回読込の場合は
      // 直近で実際にペダリングしていたレコードも参照して動作確認しやすくする
      let rec: FitRecord = records[records.length - 1]
      if (initial && (rec.power === 0 || rec.power === undefined) && records.length > 5) {
        for (let i = records.length - 1; i >= Math.max(0, records.length - 60); i--) {
          if ((records[i].power ?? 0) > 0) {
            rec = records[i]
            break
          }
        }
      }

      if (rec.power !== undefined) this.state.power = rec.power
      if (rec.heartRate !== undefined) this.state.heartRate = rec.heartRate
      if (rec.cadence !== undefined) this.state.cadence = rec.cadence
      if (rec.speed !== undefined) this.state.speed = rec.speed
      if (rec.distance !== undefined) this.state.distance = rec.distance
      if (rec.altitudeM !== undefined) this.state.altitudeM = Math.round(rec.altitudeM)
      if (rec.gradePct !== undefined) this.state.gradePct = Math.round(rec.gradePct * 10) / 10
      this.state.hasData = true
      this.statuses.emit({ state: 'connected' })
    } catch {
      // ignore partial read error during flush
    }
  }

  private pollLogFile(): void {
    let stat: fs.Stats
    try {
      stat = fs.statSync(this.logPath)
    } catch {
      return
    }

    if (stat.size < this.logOffset) {
      this.logOffset = 0
      this.logRemainder = ''
    }

    if (stat.size <= this.logOffset) return

    const len = Math.min(65536, stat.size - this.logOffset)
    const buf = Buffer.alloc(len)
    let fd: number | null = null
    try {
      fd = fs.openSync(this.logPath, 'r')
      const bytesRead = fs.readSync(fd, buf, 0, len, this.logOffset)
      this.logOffset += bytesRead
      const chunk = this.logRemainder + buf.subarray(0, bytesRead).toString('utf8')
      const lines = chunk.split(/\r?\n/)
      this.logRemainder = lines.pop() ?? ''

      for (const line of lines) {
        const parsed = parseZwiftLogLine(line)
        if (parsed.power !== undefined) {
          this.state.power = parsed.power
          this.state.hasData = true
        }
        if (parsed.heartRate !== undefined) {
          this.state.heartRate = parsed.heartRate
          this.state.hasData = true
        }
        if (parsed.cadence !== undefined) {
          this.state.cadence = parsed.cadence
          this.state.hasData = true
        }
        if (parsed.speed !== undefined) {
          this.state.speed = parsed.speed
          this.state.hasData = true
        }
        if (parsed.gradePct !== undefined) {
          this.state.gradePct = parsed.gradePct
        }
      }
      this.statuses.emit({ state: 'connected' })
    } catch {
      // ignore
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd)
        } catch {
          // ignore
        }
      }
    }
  }

  private emitSample(): void {
    const now = Date.now()
    const { weightKg } = this.ctx.getAthlete()
    const power = this.state.power
    const speed =
      this.state.speed ?? (power !== undefined ? steadySpeed(power, weightKg + 9) : undefined)
    const dist = this.state.distance ?? 0
    const pos = sampleRouteByDistance(dist)

    this.samples.emit({
      timestamp: now,
      power,
      heartRate: this.state.heartRate,
      cadence: this.state.cadence,
      speed,
      distance: dist,
      world: {
        routeProgress: pos.progress,
        x: pos.x,
        y: pos.y,
        headingRad: pos.headingRad,
        altitudeM: this.state.altitudeM ?? Math.round(pos.altitudeM),
        gradePct: this.state.gradePct ?? Math.round(pos.gradePct * 10) / 10,
        entities: [{ id: 'self', label: 'YOU', x: pos.x, y: pos.y, isSelf: true }],
        groups: {
          totalAthletes: 1,
          aheadCount: 0,
          behindCount: 0,
          nodes: [
            {
              id: 'self',
              label: 'YOU',
              size: 1,
              isSelf: true,
              gapFromPrevSec: 0,
              gapFromSelfSec: 0,
              power: power ?? 0,
              speedKph: Math.round((speed ?? 0) * 3.6)
            }
          ]
        }
      }
    })
  }
}
