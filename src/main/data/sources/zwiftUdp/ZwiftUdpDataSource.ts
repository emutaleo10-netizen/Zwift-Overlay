import dgram from 'node:dgram'
import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { steadySpeed } from '../mock/rideSimulator'
import { parseUdpPayload } from './udpParser'

export interface ZwiftUdpOptions {
  host: string
  port: number
}

export function parseZwiftUdpOptions(raw: unknown): ZwiftUdpOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const host = typeof r.host === 'string' && r.host.trim() !== '' ? r.host.trim() : '127.0.0.1'
  const port =
    typeof r.port === 'number' && Number.isInteger(r.port) && r.port >= 1024 && r.port <= 65535
      ? r.port
      : 7878
  return { host, port }
}

/**
 * ローカル UDP ソケットで JSON テレメトリストリームを受信する DataSource。
 * Zwift パケットブリッジ、ANT+ ブリッジスクリプト、Companion プロキシ等から
 * 127.0.0.1:7878 (既定) に送信されたパケットをリアルタイムに反映する。
 */
export class ZwiftUdpDataSource implements DataSource {
  readonly id = 'zwift-udp'
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
  private socket: dgram.Socket | null = null
  private cumDistanceM = 0
  private lastSampleTs: number | null = null

  constructor(
    private readonly opts: ZwiftUdpOptions,
    private readonly ctx: DataSourceContext
  ) {
    this.displayName = `UDP (${opts.host}:${opts.port})`
  }

  async start(): Promise<void> {
    if (this.socket) return
    this.statuses.emit({ state: 'connecting' })

    await new Promise<void>((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      this.socket = sock

      const onStartupError = (err: Error): void => {
        this.statuses.emit({ state: 'error', message: `UDP ポート ${this.opts.port} を開けません: ${err.message}` })
        reject(err)
      }

      sock.once('error', onStartupError)

      sock.on('message', (msg) => {
        this.handleMessage(msg)
      })

      sock.bind(this.opts.port, this.opts.host, () => {
        sock.removeListener('error', onStartupError)
        sock.on('error', (err) => {
          this.statuses.emit({ state: 'error', message: err.message })
        })
        this.statuses.emit({ state: 'connected' })
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const sock = this.socket
    this.socket = null
    if (sock) {
      await new Promise<void>((resolve) => {
        try {
          sock.close(() => resolve())
        } catch {
          resolve()
        }
      })
    }
    this.statuses.emit({ state: 'stopped' })
  }

  onSample(listener: (sample: RawSample) => void): Unsubscribe {
    return this.samples.on(listener)
  }

  onStatus(listener: (status: SourceStatus) => void): Unsubscribe {
    return this.statuses.on(listener)
  }

  private handleMessage(msg: Buffer): void {
    const now = Date.now()
    const sample = parseUdpPayload(msg, now)
    if (!sample) return

    // 速度・距離・ワールド情報が省略されたシンプルなセンサーパケットでも
    // マップや距離が動くように物理モデルで自動補完する
    const dt = this.lastSampleTs !== null ? Math.min(5, Math.max(0, (sample.timestamp - this.lastSampleTs) / 1000)) : 1
    this.lastSampleTs = sample.timestamp

    if (sample.speed === undefined && sample.power !== undefined) {
      const { weightKg } = this.ctx.getAthlete()
      sample.speed = steadySpeed(sample.power, weightKg + 9)
    }

    if (sample.distance !== undefined) {
      this.cumDistanceM = sample.distance
    } else if (sample.speed !== undefined) {
      this.cumDistanceM += sample.speed * dt
      sample.distance = this.cumDistanceM
    }

    if (!sample.world) {
      const pos = sampleRouteByDistance(this.cumDistanceM)
      const selfPower = sample.power ?? 0
      const selfKph = Math.round((sample.speed ?? 0) * 3.6)
      sample.world = {
        routeProgress: pos.progress,
        x: pos.x,
        y: pos.y,
        headingRad: pos.headingRad,
        altitudeM: Math.round(pos.altitudeM),
        gradePct: Math.round(pos.gradePct * 10) / 10,
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
              power: selfPower,
              speedKph: selfKph
            }
          ]
        }
      }
    }

    this.samples.emit(sample)
  }
}
