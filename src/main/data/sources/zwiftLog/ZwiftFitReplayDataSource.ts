import fs from 'node:fs'
import path from 'node:path'
import type { MetricKey, RawSample, SourceStatus } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'
import type { DataSource, DataSourceContext, Unsubscribe } from '../../DataSource'
import { Emitter } from '../../DataSource'
import { steadySpeed } from '../mock/rideSimulator'
import { parseFitRecords, type FitRecord } from './fitParser'
import { detectZwiftDataDir } from './ZwiftLogDataSource'

export interface ZwiftFitReplayOptions {
  zwiftDir?: string
  fitPath?: string
  intervalMs: number
}

export function parseZwiftFitReplayOptions(raw: unknown): ZwiftFitReplayOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const zwiftDir = typeof r.zwiftDir === 'string' ? r.zwiftDir.trim() : undefined
  const fitPath = typeof r.fitPath === 'string' ? r.fitPath.trim() : undefined
  const intervalMs = typeof r.intervalMs === 'number' && r.intervalMs >= 100 ? Math.min(2000, r.intervalMs) : 1000
  return { zwiftDir, fitPath, intervalMs }
}

/**
 * ユーザーの Zwift Activities フォルダにある実際のライド記録 (.fit) を読み込み、
 * 1秒ずつリアルタイム再生するデータソース。
 * Zwift を起動していない時でも、ご自身の ANT+ 実測パワー・心拍・ケイデンスでオーバーレイを検証できる。
 */
export class ZwiftFitReplayDataSource implements DataSource {
  readonly id = 'zwift-fit-replay'
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
  private records: FitRecord[] = []
  private cursor = 0
  private timer: NodeJS.Timeout | null = null
  private loadedFileName = ''

  constructor(
    private readonly opts: ZwiftFitReplayOptions,
    private readonly ctx: DataSourceContext
  ) {
    this.zwiftDir = detectZwiftDataDir(opts.zwiftDir)
    this.displayName = 'Zwift 実ライド再生 (.fit)'
  }

  async start(): Promise<void> {
    if (this.timer) return
    this.statuses.emit({ state: 'connecting' })

    const target = this.findBestFitFile()
    if (!target) {
      this.statuses.emit({
        state: 'error',
        message: `FIT ファイルが見つかりません (${path.join(this.zwiftDir, 'Activities')})`
      })
      return
    }

    try {
      const buf = fs.readFileSync(target)
      this.records = parseFitRecords(buf)
      this.loadedFileName = path.basename(target)
    } catch (err) {
      this.statuses.emit({
        state: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }

    if (this.records.length === 0) {
      this.statuses.emit({
        state: 'error',
        message: `${this.loadedFileName} に有効なライドレコードがありません`
      })
      return
    }

    // 冒頭の 0W 待機区間をスキップしてペダリング開始地点から再生する
    const firstActive = this.records.findIndex((r) => (r.power ?? 0) > 40)
    this.cursor = firstActive >= 0 ? firstActive : 0

    this.statuses.emit({ state: 'connected' })
    this.tick()
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs)
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

  private findBestFitFile(): string | null {
    if (this.opts.fitPath && fs.existsSync(this.opts.fitPath)) {
      return this.opts.fitPath
    }
    const actDir = path.join(this.zwiftDir, 'Activities')
    if (!fs.existsSync(actDir)) return null

    try {
      // inProgressActivity.fit 以外で最も新しい十分なサイズの .fit を優先選択
      const files = fs
        .readdirSync(actDir)
        .filter((f) => f.toLowerCase().endsWith('.fit'))
        .map((f) => {
          const full = path.join(actDir, f)
          const st = fs.statSync(full)
          return { name: f, full, size: st.size, mtime: st.mtimeMs }
        })
        .filter((f) => f.size > 1024)
        .sort((a, b) => {
          const aInProg = a.name.toLowerCase() === 'inprogressactivity.fit' ? 1 : 0
          const bInProg = b.name.toLowerCase() === 'inprogressactivity.fit' ? 1 : 0
          if (aInProg !== bInProg) return aInProg - bInProg
          return b.mtime - a.mtime
        })

      return files[0]?.full ?? null
    } catch {
      return null
    }
  }

  private tick(): void {
    if (this.records.length === 0) return
    const rec = this.records[this.cursor]
    this.cursor = (this.cursor + 1) % this.records.length

    const now = Date.now()
    const { weightKg } = this.ctx.getAthlete()
    const power = rec.power ?? 0
    const speed = rec.speed ?? steadySpeed(power, weightKg + 9)
    const dist = rec.distance ?? 0
    const pos = sampleRouteByDistance(dist)

    this.samples.emit({
      timestamp: now,
      power,
      heartRate: rec.heartRate,
      cadence: rec.cadence,
      speed,
      distance: dist,
      world: {
        routeProgress: pos.progress,
        x: pos.x,
        y: pos.y,
        headingRad: pos.headingRad,
        altitudeM: rec.altitudeM !== undefined ? Math.round(rec.altitudeM) : Math.round(pos.altitudeM),
        gradePct: rec.gradePct !== undefined ? Math.round(rec.gradePct * 10) / 10 : Math.round(pos.gradePct * 10) / 10,
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
              power,
              speedKph: Math.round(speed * 3.6)
            }
          ]
        }
      }
    })
  }
}
