import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import type { AthleteSettings } from '@shared/types/settings'

export type Unsubscribe = () => void

/**
 * データ取得層の差し替えポイント。
 * 実装は「生のセンサー値を流すこと」だけに責務を限定し、
 * 3 秒平均・W/kg・ゾーン・ラップ等の派生計算は MetricsEngine が担う。
 */
export interface DataSource {
  /** 'mock' | 'zwift-udp' | 'ble' など */
  readonly id: string
  readonly displayName: string
  readonly capabilities: ReadonlySet<MetricKey>

  start(): Promise<void>
  stop(): Promise<void>
  onSample(listener: (sample: RawSample) => void): Unsubscribe
  onStatus(listener: (status: SourceStatus) => void): Unsubscribe
}

/** ソースが必要に応じて参照できるアプリ側の情報 */
export interface DataSourceContext {
  getAthlete(): AthleteSettings
}

/** ソース固有のオプションは unknown で受け取り、各ファクトリが検証する */
export type DataSourceFactory = (options: unknown, ctx: DataSourceContext) => DataSource

/** ソース実装で使い回せるリスナー管理の小さなヘルパー */
export class Emitter<T> {
  private listeners = new Set<(v: T) => void>()

  on(listener: (v: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const l of this.listeners) {
      try {
        l(value)
      } catch (err) {
        console.error('[Emitter] listener error', err)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
