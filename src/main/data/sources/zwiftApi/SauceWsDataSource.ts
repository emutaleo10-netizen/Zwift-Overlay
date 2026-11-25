import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { steadySpeed } from '../mock/rideSimulator'
import { parseUdpPayload } from '../zwiftUdp/udpParser'

export interface SauceWsOptions {
  /** 既定: http://127.0.0.1:1080 */
  baseUrl: string
  pollMs: number
}

export function parseSauceWsOptions(raw: unknown): SauceWsOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const baseUrl =
    typeof r.baseUrl === 'string' && r.baseUrl.trim() !== ''
      ? r.baseUrl.trim().replace(/\/+$/, '')
      : 'http://127.0.0.1:1080'
  const pollMs = typeof r.pollMs === 'number' && r.pollMs >= 200 ? Math.min(2000, r.pollMs) : 250
  return { baseUrl, pollMs }
}

/**
 * Sauce for Zwift (または互換ブリッジサーバー: デフォルト 127.0.0.1:1080) の
 * `/api/athlete/watching` および `/api/nearby` から 4Hz (250ms) でライブテレメトリを取得する DataSource。
 */
export class SauceWsDataSource implements DataSource {
  readonly id = 'sauce-ws'
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
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private cumDistanceM = 0

  constructor(
    private readonly opts: SauceWsOptions,
    private readonly ctx: DataSourceContext
  ) {
    this.displayName = `Sauce4Zwift API (${opts.baseUrl})`
  }

  async start(): Promise<void> {
    if (this.timer) return
    this.statuses.emit({ state: 'connecting' })
    void this.poll()
    this.timer = setInterval(() => {
      void this.poll()
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

  private async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const res = await fetch(`${this.opts.baseUrl}/api/athlete/watching`, {
        headers: { Accept: 'application/json' }
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const text = await res.text()
      const sample = parseUdpPayload(text, Date.now())
      if (!sample) return

      if (sample.speed === undefined && sample.power !== undefined) {
        const { weightKg } = this.ctx.getAthlete()
        sample.speed = steadySpeed(sample.power, weightKg + 9)
      }
      if (sample.distance !== undefined) {
        this.cumDistanceM = sample.distance
      }
      if (!sample.world) {
        const pos = sampleRouteByDistance(this.cumDistanceM)
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
                power: sample.power ?? 0,
                speedKph: Math.round((sample.speed ?? 0) * 3.6)
              }
            ]
          }
        }
      }

      this.statuses.emit({ state: 'connected' })
      this.samples.emit(sample)
    } catch (err) {
      this.statuses.emit({
        state: 'error',
        message: `${this.opts.baseUrl} に接続できません (${err instanceof Error ? err.message : String(err)})`
      })
    } finally {
      this.busy = false
    }
  }
}
