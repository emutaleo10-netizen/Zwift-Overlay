import type { MetricsSnapshot, SourceStatus } from '@shared/types/metrics'
import type { DataSource, Unsubscribe } from './DataSource'
import { Emitter } from './DataSource'
import type { MetricsEngine } from './MetricsEngine'

export interface DataHubOptions {
  /** UI への最大配信頻度 */
  minEmitIntervalMs?: number
  /** サンプルが来なくても経過時間・途絶状態を更新する周期 */
  tickMs?: number
}

/**
 * アクティブな DataSource を購読し、MetricsEngine を通して
 * MetricsSnapshot を UI 向けに配信するハブ。
 */
export class DataHub {
  private source: DataSource | null = null
  private sourceUnsubs: Unsubscribe[] = []
  private status: SourceStatus = { state: 'idle' }
  private readonly snapshots = new Emitter<MetricsSnapshot>()
  private readonly minEmitIntervalMs: number
  private readonly tickMs: number
  private lastEmit = 0
  private pending: NodeJS.Timeout | null = null
  private ticker: NodeJS.Timeout | null = null

  constructor(
    private readonly engine: MetricsEngine,
    opts: DataHubOptions = {}
  ) {
    this.minEmitIntervalMs = opts.minEmitIntervalMs ?? 250
    this.tickMs = opts.tickMs ?? 1000
  }

  async useSource(source: DataSource): Promise<void> {
    await this.stopSource()
    this.source = source
    this.status = { state: 'idle' }
    this.sourceUnsubs = [
      source.onSample((s) => {
        this.engine.ingest(s)
        this.requestEmit()
      }),
      source.onStatus((st) => {
        this.status = st
        this.requestEmit()
      })
    ]
    if (!this.ticker) this.ticker = setInterval(() => this.requestEmit(), this.tickMs)
    try {
      await source.start()
    } catch (err) {
      this.status = { state: 'error', message: err instanceof Error ? err.message : String(err) }
      this.requestEmit()
    }
  }

  async stop(): Promise<void> {
    await this.stopSource()
    if (this.ticker) clearInterval(this.ticker)
    if (this.pending) clearTimeout(this.pending)
    this.ticker = null
    this.pending = null
  }

  /** Zwift 終了時などにソース接続だけを停止して待機状態へ戻す */
  async pauseSource(): Promise<void> {
    await this.stopSource()
    this.status = { state: 'idle' }
    this.engine.reset()
    this.emitNow()
  }

  hasActiveSource(): boolean {
    return this.source !== null
  }

  markLap(): void {
    this.engine.markLap()
    this.emitNow()
  }

  resetRide(): void {
    this.engine.reset()
    this.emitNow()
  }

  latest(): MetricsSnapshot {
    return {
      ...this.engine.snapshot(),
      source: {
        id: this.source?.id ?? 'none',
        name: this.source?.displayName ?? '未接続',
        status: this.status
      }
    }
  }

  onSnapshot(cb: (s: MetricsSnapshot) => void): Unsubscribe {
    return this.snapshots.on(cb)
  }

  private async stopSource(): Promise<void> {
    this.sourceUnsubs.forEach((u) => u())
    this.sourceUnsubs = []
    if (this.source) {
      try {
        await this.source.stop()
      } catch (err) {
        console.error('[DataHub] failed to stop source', err)
      }
    }
    this.source = null
  }

  private requestEmit(): void {
    const wait = this.minEmitIntervalMs - (Date.now() - this.lastEmit)
    if (wait <= 0) {
      this.emitNow()
    } else if (!this.pending) {
      this.pending = setTimeout(() => this.emitNow(), wait)
    }
  }

  private emitNow(): void {
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
    this.lastEmit = Date.now()
    this.snapshots.emit(this.latest())
  }
}
