import { describe, expect, it } from 'vitest'
import { computeCourseProgress, type ZwiftRouteProfile } from '@shared/zwiftRoutes'

/** 全く同じ円周ループを3周するコース（Sacré Trois! のような重複周回コースの模擬） */
function createThreeLapRoute(): ZwiftRouteProfile {
  const totalPts = 96
  const points: [number, number][] = []
  const elevations: number[] = []
  const radius = 50_000 // 500m 半径 (cm)
  for (let i = 0; i < totalPts; i++) {
    const frac = i / (totalPts - 1) // 0..1 で 3 周
    const angle = frac * 3 * Math.PI * 2
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
    elevations.push(20 + 15 * Math.sin(angle))
  }
  return {
    id: 999999,
    name: 'Mock 3-Lap Circuit',
    courseId: 14,
    distanceM: 9000, // 1周 3000m × 3周
    elevations,
    points
  }
}

describe('computeCourseProgress (周回コース安定性)', () => {
  it('3周する同一セグメント周回コースで、1周目から3周目へワープせず滑らかに追従する', () => {
    const route = createThreeLapRoute()
    let prevProgress: number | undefined

    // 1周目〜3周目まで 0% → 98% を 2% 刻みで走行（わずかなGPS揺らぎも付与）
    for (let step = 0; step <= 49; step++) {
      const trueP = step * 0.02
      const angle = trueP * 3 * Math.PI * 2
      const radius = 50_000
      // ±300cm (3m) の微小ノイズを混ぜて重複周回の揺らぎを再現
      const jitterX = (step % 2 === 0 ? 1 : -1) * 300
      const jitterY = (step % 3 === 0 ? -1 : 1) * 250
      const x = Math.cos(angle) * radius + jitterX
      const y = Math.sin(angle) * radius + jitterY
      const dirX = -Math.sin(angle)
      const dirY = Math.cos(angle)
      // リードイン相当の +300m ズレを含む走行距離
      const distM = trueP * route.distanceM + 300

      const res = computeCourseProgress(route, x, y, dirX, dirY, distM, prevProgress)

      // 常に真の進行度（同じ周回）の ±0.03 以内に収まり、別周回 (±0.33) へ飛ばないこと
      expect(Math.abs(res.progress - trueP)).toBeLessThan(0.03)
      if (prevProgress !== undefined) {
        expect(res.progress).toBeGreaterThanOrEqual(prevProgress - 0.01)
      }
      prevProgress = res.progress
    }
  })

  it('初回ロックオン時でも走行距離から正しい周回（2周目）を識別できる', () => {
    const route = createThreeLapRoute()
    // 2周目の半ば (trueP = 0.50, 距離 4500m) からオーバーレイを起動したケース
    const trueP = 0.5
    const angle = trueP * 3 * Math.PI * 2
    const x = Math.cos(angle) * 50_000
    const y = Math.sin(angle) * 50_000
    const dirX = -Math.sin(angle)
    const dirY = Math.cos(angle)

    const res = computeCourseProgress(route, x, y, dirX, dirY, 4500, undefined)
    expect(Math.abs(res.progress - 0.5)).toBeLessThan(0.03)
  })
})
