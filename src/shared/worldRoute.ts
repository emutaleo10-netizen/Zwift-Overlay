export interface RoutePoint {
  /** 正規化ワールド座標 0〜1000 */
  x: number
  y: number
  /** 標高 (m) */
  altitudeM: number
  /** 始点からの累積距離 (m) */
  distanceM: number
  /** この地点での勾配 (%) */
  gradePct: number
  /** 進行方向 (ラジアン) */
  headingRad: number
}

export interface RouteMarker {
  /** 進行度 0〜1 */
  progress: number
  label: string
  kind: 'kom' | 'sprint' | 'arch'
}

/**
 * Watopia の海岸線〜山岳ワインディング〜市街地を模した周回コース（1周 約12km）。
 * 2枚目のスクリーンショットのように、西側が海、中央にスイッチバック（つづら折り）、
 * 南東にダウンタウンのグリッド道路がある地形を再現する。
 */
const CONTROL_POINTS: readonly { x: number; y: number; alt: number }[] = [
  // 南東ダウンタウン出発 → 北上
  { x: 780, y: 740, alt: 18 },
  { x: 750, y: 630, alt: 22 },
  { x: 675, y: 550, alt: 28 },
  { x: 625, y: 470, alt: 38 },
  // 北側の分岐 → 海岸沿い北端へ
  { x: 640, y: 360, alt: 32 },
  { x: 690, y: 260, alt: 25 },
  { x: 705, y: 165, alt: 16 },
  { x: 670, y: 85, alt: 14 },
  { x: 600, y: 120, alt: 24 },
  { x: 575, y: 220, alt: 42 },
  { x: 590, y: 330, alt: 58 },
  // 中央から南西の山岳スイッチバックへ登坂
  { x: 560, y: 450, alt: 78 },
  { x: 505, y: 540, alt: 96 },
  { x: 465, y: 595, alt: 118 },
  { x: 525, y: 635, alt: 142 },
  { x: 445, y: 685, alt: 168 },
  { x: 535, y: 730, alt: 192 },
  { x: 420, y: 775, alt: 215 },
  { x: 515, y: 815, alt: 228 },
  { x: 385, y: 845, alt: 210 },
  // 南岸からダウンタウンへ下り
  { x: 470, y: 895, alt: 155 },
  { x: 585, y: 880, alt: 95 },
  { x: 695, y: 850, alt: 45 },
  { x: 775, y: 815, alt: 22 }
]

/** Catmull-Rom スプライン補間で滑らかな周回ルート点列を生成 */
function buildRoute(samplesPerSegment = 16): RoutePoint[] {
  const n = CONTROL_POINTS.length
  const raw: { x: number; y: number; alt: number }[] = []

  const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t
    const t3 = t2 * t
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    )
  }

  for (let i = 0; i < n; i++) {
    const p0 = CONTROL_POINTS[(i - 1 + n) % n]
    const p1 = CONTROL_POINTS[i]
    const p2 = CONTROL_POINTS[(i + 1) % n]
    const p3 = CONTROL_POINTS[(i + 2) % n]
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment
      raw.push({
        x: catmull(p0.x, p1.x, p2.x, p3.x, t),
        y: catmull(p0.y, p1.y, p2.y, p3.y, t),
        alt: catmull(p0.alt, p1.alt, p2.alt, p3.alt, t)
      })
    }
  }

  // 1 座標単位 ≒ 3.2m として距離と勾配を計算
  const METERS_PER_UNIT = 3.2
  const out: RoutePoint[] = []
  let cumDist = 0

  for (let i = 0; i < raw.length; i++) {
    const curr = raw[i]
    const next = raw[(i + 1) % raw.length]
    const prev = raw[(i - 1 + raw.length) % raw.length]
    if (i > 0) {
      const seg = Math.hypot(curr.x - prev.x, curr.y - prev.y) * METERS_PER_UNIT
      cumDist += seg
    }
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const dist2 = Math.max(1, Math.hypot(dx, dy) * METERS_PER_UNIT)
    const dAlt = next.alt - prev.alt
    const gradePct = Math.max(-18, Math.min(18, (dAlt / dist2) * 100))
    const headingRad = Math.atan2(next.y - curr.y, next.x - curr.x)

    out.push({
      x: curr.x,
      y: curr.y,
      altitudeM: curr.alt,
      distanceM: cumDist,
      gradePct,
      headingRad
    })
  }
  return out
}

export const WORLD_ROUTE: readonly RoutePoint[] = buildRoute(16)

export const WORLD_TOTAL_DISTANCE_M =
  WORLD_ROUTE[WORLD_ROUTE.length - 1].distanceM +
  Math.hypot(
    WORLD_ROUTE[0].x - WORLD_ROUTE[WORLD_ROUTE.length - 1].x,
    WORLD_ROUTE[0].y - WORLD_ROUTE[WORLD_ROUTE.length - 1].y
  ) *
    3.2

export const WORLD_MARKERS: readonly RouteMarker[] = [
  { progress: 0.14, label: 'Sprint', kind: 'sprint' },
  { progress: 0.34, label: 'Coast Arch', kind: 'arch' },
  { progress: 0.62, label: 'Switchback KOM', kind: 'kom' },
  { progress: 0.85, label: 'City Gate', kind: 'arch' }
]

/** 累積距離 (m) からコース上の補間位置を取得する */
export function sampleRouteByDistance(distanceM: number): RoutePoint & { progress: number } {
  const total = WORLD_TOTAL_DISTANCE_M
  const wrapped = ((distanceM % total) + total) % total
  const pts = WORLD_ROUTE
  let idx = 0
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].distanceM <= wrapped) idx = i
    else break
  }
  const a = pts[idx]
  const b = pts[(idx + 1) % pts.length]
  const segLen =
    idx + 1 < pts.length ? b.distanceM - a.distanceM : total - a.distanceM
  const t = segLen > 0 ? Math.min(1, Math.max(0, (wrapped - a.distanceM) / segLen)) : 0

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    altitudeM: a.altitudeM + (b.altitudeM - a.altitudeM) * t,
    distanceM: wrapped,
    gradePct: a.gradePct + (b.gradePct - a.gradePct) * t,
    headingRad: a.headingRad,
    progress: wrapped / total
  }
}
