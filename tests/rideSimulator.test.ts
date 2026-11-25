import { describe, expect, it } from 'vitest'
import { RideSimulator, steadySpeed } from '../src/main/data/sources/mock/rideSimulator'

const athlete = { ftp: 250, weightKg: 70 }

function run(seed: number, seconds: number) {
  const sim = new RideSimulator({ seed, getAthlete: () => athlete })
  return Array.from({ length: seconds }, () => sim.step(1))
}

describe('RideSimulator', () => {
  it('同じシードなら同じ系列を生成する（再現性）', () => {
    expect(run(42, 120)).toEqual(run(42, 120))
  })

  it('値が現実的な範囲に収まる', () => {
    const out = run(7, 3600)
    for (const o of out) {
      expect(o.power).toBeGreaterThanOrEqual(0)
      expect(o.power).toBeLessThan(athlete.ftp * 3)
      expect(o.heartRate).toBeGreaterThanOrEqual(40)
      expect(o.heartRate).toBeLessThanOrEqual(210)
      expect(o.cadence).toBeGreaterThanOrEqual(0)
      expect(o.cadence).toBeLessThan(140)
    }
  })

  it('ワークアウトに沿って強度が変化する（ウォームアップより VO2 区間の方が高い）', () => {
    const out = run(1, 1500)
    const avg = (a: number, b: number) => out.slice(a, b).reduce((s, o) => s + o.power, 0) / (b - a)
    const warmup = avg(30, 230) // 50% FTP 付近
    const vo2 = avg(1030, 1200) // 最初の VO2 区間（115% FTP）
    expect(warmup).toBeGreaterThan(athlete.ftp * 0.35)
    expect(warmup).toBeLessThan(athlete.ftp * 0.7)
    expect(vo2).toBeGreaterThan(athlete.ftp * 0.95)
  })

  it('心拍はパワーに遅れて追従する', () => {
    const out = run(3, 1300)
    // VO2 区間開始直後より終盤の方が心拍が高い
    expect(out[1190].heartRate).toBeGreaterThan(out[1025].heartRate)
  })

  it('速度モデルが妥当な値を返す', () => {
    expect(steadySpeed(0, 80)).toBe(0)
    const v = steadySpeed(250, 79) * 3.6
    expect(v).toBeGreaterThan(30)
    expect(v).toBeLessThan(45)
  })

  it('ワールド座標・標高・勾配とグループギャップを生成する', () => {
    const out = run(99, 60)
    const last = out[out.length - 1]
    expect(last.world.routeProgress).toBeGreaterThan(0)
    expect(last.world.routeProgress).toBeLessThan(1)
    expect(last.world.altitudeM).toBeGreaterThan(0)
    expect(last.world.groups.nodes.some((n) => n.isSelf)).toBe(true)
    expect(last.world.entities.some((e) => e.isSelf)).toBe(true)
  })
})
