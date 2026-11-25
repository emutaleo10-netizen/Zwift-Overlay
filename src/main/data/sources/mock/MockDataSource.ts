import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { RideSimulator } from './rideSimulator'

export interface MockOptions {
  intervalMs: number
  seed?: number
}

export function parseMockOptions(raw: unknown): MockOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const interval = typeof r.intervalMs === 'number' && r.intervalMs >= 100 ? r.intervalMs : 1000
  const seed = typeof r.seed === 'number' ? r.seed : undefined
  return { intervalMs: Math.min(5000, interval), seed }
}

export class MockDataSource implements DataSource {
  readonly id = 'mock'
  readonly displayName = 'モックデータ'
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
  private readonly sim: RideSimulator
  private timer: NodeJS.Timeout | null = null
  private lastTs = 0

  constructor(
    private readonly opts: MockOptions,
    ctx: DataSourceContext
  ) {
    this.sim = new RideSimulator({ seed: opts.seed, getAthlete: () => ctx.getAthlete() })
  }

  async start(): Promise<void> {
    if (this.timer) return
    this.statuses.emit({ state: 'connecting' })
    this.lastTs = Date.now()
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs)
    this.statuses.emit({ state: 'connected' })
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

  private tick(): void {
    const now = Date.now()
    const dt = (now - this.lastTs) / 1000
    this.lastTs = now
    const out = this.sim.step(dt)
    this.samples.emit({ timestamp: now, ...out })
  }
}
