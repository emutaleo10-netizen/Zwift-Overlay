import { getZone } from '@shared/zones'
import type { LapState, MetricsSnapshot, RawSample } from '@shared/types/metrics'
import type { AthleteSettings } from '@shared/types/settings'

export type EngineSnapshot = Omit<MetricsSnapshot, 'source'>

export interface MetricsEngineOptions {
  /** 移動平均の窓幅 */
  windowMs?: number
  /** この時間サンプルが来なければ瞬時値を null にする */
  staleMs?: number
  /** 平均計算で 1 サンプルが代表する最大時間（通信途絶時の過大評価を防ぐ） */
  maxGapMs?: number
}

interface LapAccumulator {
  startTs: number
  powerSum: number
  powerDur: number
  hrSum: number
  hrDur: number
  cadSum: number
  cadDur: number
}

const newAcc = (startTs: number): LapAccumulator => ({
  startTs,
  powerSum: 0,
  powerDur: 0,
  hrSum: 0,
  hrDur: 0,
  cadSum: 0,
  cadDur: 0
})

interface PowerPoint {
  timestamp: number
  power: number
}

const POWER_5S_MS = 5_000
const POWER_30S_MS = 30_000
const POWER_1M_MS = 60_000
const POWER_5M_MS = 300_000
const POWER_20M_MS = 1_200_000

/**
 * 生サンプルから派生メトリクスを計算する。Electron に依存しない純粋なクラス。
 * 平均は時間加重（各サンプルは直前サンプルからの区間を代表する）。
 */
export class MetricsEngine {
  private readonly windowMs: number
  private readonly staleMs: number
  private readonly maxGapMs: number
  private readonly maxPowerHistoryMs: number

  private powerHistory: PowerPoint[] = []
  private last: RawSample | null = null
  private lastDistance: number | null = null
  private rideStartTs: number | null = null
  private lapIndex = 1
  private lap: LapAccumulator | null = null
  private prevLap: LapState | null = null
  private wBalJ: number | null = null
  /** Normalized Power 算出用の累積値（30秒移動平均の4乗を時間加重積算） */
  private npSum4 = 0
  private npDur = 0
  private powerElapsedMs = 0
  /** ライド中の各区間ベスト平均パワー (Best Effort) */
  private bestPower5s: number | null = null
  private bestPower1m: number | null = null
  private bestPower5m: number | null = null
  private bestPower20m: number | null = null

  constructor(
    private readonly getAthlete: () => AthleteSettings,
    opts: MetricsEngineOptions = {}
  ) {
    this.windowMs = opts.windowMs ?? 3000
    this.staleMs = opts.staleMs ?? 15000
    this.maxGapMs = opts.maxGapMs ?? 4000
    this.maxPowerHistoryMs = Math.max(this.windowMs, POWER_20M_MS)
  }

  ingest(s: RawSample): void {
    if (this.last && s.timestamp <= this.last.timestamp) return

    // 同日の2回目以降のライドを自動検知して前回ライドの Best Effort / NP / ラップ等をリセット
    const isNewRideByDistance =
      s.distance != null && this.lastDistance != null && s.distance + 100 < this.lastDistance
    const isNewRideByGap = this.last != null && s.timestamp - this.last.timestamp >= 300_000
    if (isNewRideByDistance || isNewRideByGap) {
      this.reset()
    }
    if (s.distance != null) {
      this.lastDistance = s.distance
    }

    if (this.rideStartTs === null) this.rideStartTs = s.timestamp
    if (!this.lap) this.lap = newAcc(s.timestamp)

    const { ftp, wPrime: rawWPrime } = this.getAthlete()
    const wPrime = rawWPrime && rawWPrime > 0 ? rawWPrime : 20000
    if (this.wBalJ === null) {
      this.wBalJ = wPrime
    }

    let dtPower = 0
    if (this.last) {
      const dt = Math.min(s.timestamp - this.last.timestamp, s.timestamp - this.lap.startTs, this.maxGapMs)
      if (dt > 0) {
        accumulate(this.lap, s, dt)
        // Skiba / Froncioni / Clarke 微分法による W'bal リアルタイム積分
        const elapsedSec = dt / 1000
        const p = s.power ?? 0
        const cpDelta = (ftp - p) * elapsedSec
        this.wBalJ += cpDelta > 0 ? (cpDelta * (wPrime - this.wBalJ)) / wPrime : cpDelta
        if (this.wBalJ > wPrime) this.wBalJ = wPrime
      }
      dtPower = Math.min(s.timestamp - this.last.timestamp, this.maxGapMs)
    }

    this.last = s

    if (s.power != null) {
      this.powerHistory.push({ timestamp: s.timestamp, power: s.power })
      const cutoff = s.timestamp - this.maxPowerHistoryMs - this.maxGapMs
      while (this.powerHistory.length > 1 && this.powerHistory[0].timestamp < cutoff) {
        this.powerHistory.shift()
      }

      if (dtPower > 0) {
        this.powerElapsedMs += dtPower
        // ライド中の各区間 Best Effort (最高平均パワー) を更新（区間長に達してから算出）
        if (this.powerElapsedMs >= POWER_5S_MS) {
          const p5s = this.powerWindowAverage(POWER_5S_MS)
          if (p5s != null && (this.bestPower5s === null || p5s > this.bestPower5s)) this.bestPower5s = p5s
        }
        if (this.powerElapsedMs >= POWER_1M_MS) {
          const p1m = this.powerWindowAverage(POWER_1M_MS)
          if (p1m != null && (this.bestPower1m === null || p1m > this.bestPower1m)) this.bestPower1m = p1m
        }
        if (this.powerElapsedMs >= POWER_5M_MS) {
          const p5m = this.powerWindowAverage(POWER_5M_MS)
          if (p5m != null && (this.bestPower5m === null || p5m > this.bestPower5m)) this.bestPower5m = p5m
        }
        if (this.powerElapsedMs >= POWER_20M_MS) {
          const p20m = this.powerWindowAverage(POWER_20M_MS)
          if (p20m != null && (this.bestPower20m === null || p20m > this.bestPower20m)) this.bestPower20m = p20m
        }

        // Coggan 標準定義: 30秒以上経過後から30秒移動平均パワーの4乗を積算する（ライド全体）
        if (this.powerElapsedMs >= POWER_30S_MS) {
          const p30s = this.powerWindowAverage(POWER_30S_MS)
          if (p30s != null) {
            this.npSum4 += Math.pow(p30s, 4) * dtPower
            this.npDur += dtPower
          }
        }
      }
    }
  }

  markLap(now = Date.now()): void {
    if (!this.lap) return
    this.prevLap = toLapState(this.lap, this.lapIndex, now)
    this.lapIndex += 1
    this.lap = newAcc(now)
  }

  reset(): void {
    this.powerHistory = []
    this.last = null
    this.lastDistance = null
    this.rideStartTs = null
    this.lapIndex = 1
    this.lap = null
    this.prevLap = null
    this.wBalJ = null
    this.npSum4 = 0
    this.npDur = 0
    this.powerElapsedMs = 0
    this.bestPower5s = null
    this.bestPower1m = null
    this.bestPower5m = null
    this.bestPower20m = null
  }

  snapshot(now = Date.now()): EngineSnapshot {
    const { ftp, weightKg, wPrime: rawWPrime } = this.getAthlete()
    const wPrime = rawWPrime && rawWPrime > 0 ? rawWPrime : 20000
    const last = this.last
    const stale = !last || now - last.timestamp > this.staleMs
    const endTs = last && stale ? last.timestamp : now

    const power = stale ? null : (last?.power ?? null)
    const power3s = stale ? null : this.powerWindowAverage(this.windowMs)
    const power5s = this.bestPower5s
    const power1m = this.bestPower1m
    const power5m = this.bestPower5m
    const power20m = this.bestPower20m
    const normalizedPower = this.npDur > 0 ? Math.pow(this.npSum4 / this.npDur, 0.25) : null
    const wkg = power3s != null && weightKg > 0 ? power3s / weightKg : null
    const curWBalJ = this.wBalJ ?? wPrime
    const wBal = stale
      ? null
      : {
          joules: Math.round(curWBalJ),
          capacityJ: wPrime,
          pct: Math.max(0, Math.min(100, (curWBalJ / wPrime) * 100))
        }

    return {
      timestamp: now,
      power,
      power3s,
      power5s,
      power1m,
      power5m,
      power20m,
      normalizedPower,
      wkg,
      heartRate: stale ? null : (last?.heartRate ?? null),
      cadence: stale ? null : (last?.cadence ?? null),
      speed: stale ? null : (last?.speed ?? null),
      zone: getZone(power3s, ftp),
      wBal,
      rideElapsedMs: this.rideStartTs === null ? 0 : Math.max(0, endTs - this.rideStartTs),
      currentLap: this.lap
        ? toLapState(this.lap, this.lapIndex, Math.max(endTs, this.lap.startTs))
        : { index: this.lapIndex, elapsedMs: 0, avgPower: null, avgHeartRate: null, avgCadence: null },
      previousLap: this.prevLap,
      world: stale ? null : (last?.world ?? null)
    }
  }

  /** 最新サンプル時刻を終端とした指定 windowMs 区間のパワー時間加重平均 */
  private powerWindowAverage(windowMs: number): number | null {
    const h = this.powerHistory
    if (h.length === 0) return null
    const end = h[h.length - 1].timestamp
    const start = end - windowMs
    let sum = 0
    let dur = 0
    let plainSum = 0
    let plainCount = 0

    for (let i = h.length - 1; i >= 0; i--) {
      const s = h[i]
      if (s.timestamp <= start) break
      const prevTs = i > 0 ? h[i - 1].timestamp : s.timestamp - this.maxGapMs
      const w = Math.min(s.timestamp - Math.max(prevTs, start), this.maxGapMs)
      sum += s.power * w
      dur += w
      plainSum += s.power
      plainCount += 1
    }
    if (dur > 0) return sum / dur
    return plainCount > 0 ? plainSum / plainCount : null
  }
}

function accumulate(acc: LapAccumulator, s: RawSample, dt: number): void {
  if (s.power != null) {
    acc.powerSum += s.power * dt
    acc.powerDur += dt
  }
  if (s.heartRate != null && s.heartRate > 0) {
    acc.hrSum += s.heartRate * dt
    acc.hrDur += dt
  }
  if (s.cadence != null) {
    acc.cadSum += s.cadence * dt
    acc.cadDur += dt
  }
}

function toLapState(acc: LapAccumulator, index: number, endTs: number): LapState {
  return {
    index,
    elapsedMs: Math.max(0, endTs - acc.startTs),
    avgPower: acc.powerDur > 0 ? acc.powerSum / acc.powerDur : null,
    avgHeartRate: acc.hrDur > 0 ? acc.hrSum / acc.hrDur : null,
    avgCadence: acc.cadDur > 0 ? acc.cadSum / acc.cadDur : null
  }
}
