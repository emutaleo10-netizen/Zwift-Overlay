import { describe, expect, it } from 'vitest'
import { MetricsEngine } from '../src/main/data/MetricsEngine'

const athlete = { ftp: 250, weightKg: 70 }
const T0 = 1_000_000

function feed(engine: MetricsEngine, powers: number[], startTs = T0, stepMs = 1000): number {
  powers.forEach((p, i) => engine.ingest({ timestamp: startTs + i * stepMs, power: p, heartRate: 140, cadence: 90 }))
  return startTs + (powers.length - 1) * stepMs
}

describe('MetricsEngine', () => {
  it('1Hz サンプルで直近 3 秒の平均を計算する', () => {
    const e = new MetricsEngine(() => athlete)
    const last = feed(e, [100, 200, 300, 400])
    const s = e.snapshot(last)
    expect(s.power).toBe(400)
    expect(s.power3s).toBeCloseTo(300) // 200, 300, 400
  })

  it('送信周期が不規則でも時間加重で平均する', () => {
    const e = new MetricsEngine(() => athlete)
    e.ingest({ timestamp: T0, power: 0 })
    e.ingest({ timestamp: T0 + 1000, power: 100 }) // 1000ms 区間
    e.ingest({ timestamp: T0 + 3000, power: 400 }) // 2000ms 区間
    expect(e.snapshot(T0 + 3000).power3s).toBeCloseTo((100 * 1000 + 400 * 2000) / 3000)
  })

  it('W/kg とゾーンを 3 秒平均から計算する', () => {
    const e = new MetricsEngine(() => athlete)
    const last = feed(e, [280, 280, 280, 280])
    const s = e.snapshot(last)
    expect(s.wkg).toBeCloseTo(4.0)
    expect(s.zone?.index).toBe(5) // 112%
  })

  it('サンプルが途絶えると瞬時値は null になる', () => {
    const e = new MetricsEngine(() => athlete)
    const last = feed(e, [200, 200])
    const s = e.snapshot(last + 20_000)
    expect(s.power).toBeNull()
    expect(s.power3s).toBeNull()
    expect(s.heartRate).toBeNull()
    expect(s.rideElapsedMs).toBe(1000) // 経過時間は最後のサンプルで止まる
  })

  it('ラップごとに経過時間と平均パワーを集計する', () => {
    const e = new MetricsEngine(() => athlete)
    let last = feed(e, [100, 100, 100, 100, 100]) // 4 秒
    e.markLap(last)
    last = feed(e, [300, 300, 300], last + 1000) // 3 秒
    const s = e.snapshot(last)
    expect(s.previousLap?.index).toBe(1)
    expect(s.previousLap?.elapsedMs).toBe(4000)
    expect(s.previousLap?.avgPower).toBeCloseTo(100)
    expect(s.currentLap.index).toBe(2)
    expect(s.currentLap.elapsedMs).toBe(3000)
    expect(s.currentLap.avgPower).toBeCloseTo(300)
  })

  it('0W（惰性走行）も平均に含める', () => {
    const e = new MetricsEngine(() => athlete)
    const last = feed(e, [200, 200, 0, 0, 200])
    expect(e.snapshot(last).currentLap.avgPower).toBeCloseTo(100)
  })

  it('reset で初期状態に戻る', () => {
    const e = new MetricsEngine(() => athlete)
    const last = feed(e, [200, 200, 200])
    e.markLap(last)
    e.reset()
    const s = e.snapshot(last)
    expect(s.power).toBeNull()
    expect(s.currentLap.index).toBe(1)
    expect(s.previousLap).toBeNull()
    expect(s.rideElapsedMs).toBe(0)
  })

  it('時刻が逆行したサンプルは無視する', () => {
    const e = new MetricsEngine(() => athlete)
    e.ingest({ timestamp: T0 + 1000, power: 200 })
    e.ingest({ timestamp: T0, power: 999 })
    expect(e.snapshot(T0 + 1000).power).toBe(200)
  })

  it('FTP超過で W\'bal が消費され、FTP未満で回復する', () => {
    const e = new MetricsEngine(() => ({ ftp: 250, weightKg: 70, wPrime: 20000 }))
    // 初期 + 350W を 10 秒間 (+100W × 10s = 1000J 消費 -> 残り 19000J = 95%)
    const afterBurn = feed(e, [250, 350, 350, 350, 350, 350, 350, 350, 350, 350, 350])
    const sBurn = e.snapshot(afterBurn)
    expect(sBurn.wBal?.joules).toBe(19000)
    expect(sBurn.wBal?.pct).toBeCloseTo(95)

    // その後 150W で 5 秒走行すると Skiba 微分法により回復する
    const afterRec = feed(e, [150, 150, 150, 150, 150], afterBurn + 1000)
    const sRec = e.snapshot(afterRec)
    expect(sRec.wBal?.joules).toBeGreaterThan(19000)
    expect(sRec.wBal?.joules).toBeLessThanOrEqual(20000)
  })

  it('5秒 / 1分 / 5分 / 20分のライド中 Best Effort (最高平均パワー) を正確に保持する', () => {
    const e = new MetricsEngine(() => athlete)
    // 開始4秒時点ではまだすべての区間長未満なので null
    const t4 = feed(e, [500, 500, 500, 500, 500])
    const s4 = e.snapshot(t4)
    expect(s4.power5s).toBeNull()
    expect(s4.power1m).toBeNull()
    expect(s4.power5m).toBeNull()
    expect(s4.power20m).toBeNull()

    // 5秒経過で 5s Best = 500W が記録され、その後 100W に落ちても 500W を維持する
    const t5 = feed(e, [500], t4 + 1000)
    expect(e.snapshot(t5).power5s).toBeCloseTo(500)

    // 60秒間 300W、続いて 300秒間 250W、続いて 900秒間 150W を流す
    const t65 = feed(e, Array(60).fill(300), t5 + 1000)
    const t365 = feed(e, Array(300).fill(250), t65 + 1000)
    const t1265 = feed(e, Array(900).fill(150), t365 + 1000)
    const sEnd = e.snapshot(t1265)

    // 終盤は 150W だが、各区間の過去最高平均（Best Effort）が保持されている
    expect(sEnd.power5s).toBeCloseTo(500)
    // 1分ベストは冒頭5秒(500W) + 55秒(300W) の平均 = (500*5 + 300*55) / 60 = 316.67W
    expect(sEnd.power1m).toBeCloseTo((500 * 5 + 300 * 55) / 60)
    // 5分ベストは冒頭5秒(500W) + 60秒(300W) + 235秒(250W) の平均 = 264.17W
    expect(sEnd.power5m).toBeCloseTo((500 * 5 + 300 * 60 + 250 * 235) / 300)
    // 20分ベストは最初の1200秒（5*500 + 60*300 + 300*250 + 835*150）/ 1200 = 183.96W
    expect(sEnd.power20m).toBeCloseTo((500 * 5 + 300 * 60 + 250 * 300 + 150 * 835) / 1200)

    // reset で初期化される
    e.reset()
    const sReset = e.snapshot(t1265)
    expect(sReset.power5s).toBeNull()
    expect(sReset.power1m).toBeNull()
    expect(sReset.power5m).toBeNull()
    expect(sReset.power20m).toBeNull()
  })

  it('Normalized Power を30秒経過後から Coggan 定義で計算し、reset で初期化する', () => {
    const e = new MetricsEngine(() => athlete)
    // 20秒経過時点では30秒未満のため null
    const t20 = feed(e, Array(21).fill(200))
    expect(e.snapshot(t20).normalizedPower).toBeNull()

    // 40秒経過時点で一定 200W なら NP = 200W
    const t40 = feed(e, Array(20).fill(200), t20 + 1000)
    expect(e.snapshot(t40).normalizedPower).toBeCloseTo(200)

    // 変動パワー（60秒間 100W → 60秒間 300W）を追加すると算術平均は 200W のままだが NP は大きく上回る
    const t100 = feed(e, Array(60).fill(100), t40 + 1000)
    const t160 = feed(e, Array(60).fill(300), t100 + 1000)
    const sVar = e.snapshot(t160)
    expect(sVar.normalizedPower).not.toBeNull()
    expect(sVar.normalizedPower!).toBeGreaterThan(215)

    // reset で null に戻る
    e.reset()
    expect(e.snapshot(t160).normalizedPower).toBeNull()
  })

  it('同日に2回目のライドを開始（距離リセット）すると Best Effort や NP が自動リセットされる', () => {
    const e = new MetricsEngine(() => athlete)
    // 1回目のライド: 500W で 10 秒走行（距離 0m → 100m → ... → 1000m）
    for (let i = 0; i <= 10; i++) {
      e.ingest({ timestamp: T0 + i * 1000, power: 500, distance: i * 100 })
    }
    expect(e.snapshot(T0 + 10_000).power5s).toBeCloseTo(500)

    // 2回目のライド開始: 距離が 0m に戻る → 自動リセットされ 5s Best はブランク (null) に戻る
    e.ingest({ timestamp: T0 + 15_000, power: 150, distance: 0 })
    const sNew = e.snapshot(T0 + 15_000)
    expect(sNew.power).toBe(150)
    expect(sNew.power5s).toBeNull()
    expect(sNew.normalizedPower).toBeNull()
  })
})
