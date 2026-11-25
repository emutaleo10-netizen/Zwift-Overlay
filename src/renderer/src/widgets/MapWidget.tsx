import { useEffect, useMemo, useRef, useState } from 'react'
import { WORLD_MARKERS, WORLD_ROUTE } from '@shared/worldRoute'
import { ZWIFT_WORLD_ROAD_PATHS } from '@shared/zwiftRoads'
import { computeCourseProgress, findActiveRouteProfile } from '@shared/zwiftRoutes'
import {
  getWorldMapBounds,
  getWorldMapUrl,
  getWorldMetaByCourseId,
  worldPosToMapXY
} from '@shared/zwiftWorlds'
import { useAppStore } from '@renderer/stores/appStore'
import type { WidgetProps } from './WidgetShell'

const ROUTE_POLYLINE = WORLD_ROUTE.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
/** 起動時・未接続時の初期マップ位置（Watopia メインスタートゲート前 / Downtown Start Banner） */
const WATOPIA_START_GATE = { x: 19200, y: -87300 } as const

/** 勾配に応じた右上バッジの背景色 */
function gradeBadgeColor(gradePct: number): string {
  const abs = Math.abs(gradePct)
  if (abs >= 8) return '#b91c1c'
  if (abs >= 4) return '#c2410c'
  if (abs >= 1.5) return '#b45309'
  return '#be123c'
}

/**
 * 座標列を滑らかな Catmull-Rom 3次ベジェ SVG パス (M ... C ...) に変換する。
 * これにより走行軌跡がカクカクせず道路曲線に沿って滑らかに描画される。
 */
function pointsToSmoothSvgPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x.toFixed(0)},${pts[0].y.toFixed(0)}`
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(0)},${pts[0].y.toFixed(0)} L ${pts[1].x.toFixed(0)},${pts[1].y.toFixed(0)}`
  }
  let d = `M ${pts[0].x.toFixed(0)},${pts[0].y.toFixed(0)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(0)},${cp1y.toFixed(0)} ${cp2x.toFixed(0)},${cp2y.toFixed(0)} ${p2.x.toFixed(0)},${p2.y.toFixed(0)}`
  }
  return d
}

/**
 * Interactive Map ウィジェット。
 * - 下部の高低差プロファイルは現在走行中のコース全体（左上に表示されるルート名・routeId）の断面プロファイルを表示し、
 *   断面曲線上の現在地ピンおよび垂直インジケーターでコース全体のどこを走っているかをリアルタイムに表示する。
 * - 背景マップ画像には全道路が滑らかに描画されているため、不要なグレーのポリゴン重ね描きを廃止し、
 *   実走行軌跡も Catmull-Rom 3次ベジェ曲線で滑らかに描画する。
 */
export function MapWidget({ config, metrics, settings }: WidgetProps): React.JSX.Element {
  const world = metrics?.world
  const mode = useAppStore((s) => s.mode)
  const isEditMode = mode === 'edit'
  const [followSelf, setFollowSelf] = useState(true)
  const [rotateHeading, setRotateHeading] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mapImgFailed, setMapImgFailed] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    active: boolean
    startClientX: number
    startClientY: number
    startPanX: number
    startPanY: number
  }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0
  })
  const isHoveredRef = useRef(false)

  useEffect(() => {
    return () => {
      void window.overlayApi.setOverlayInteractive(false)
    }
  }, [])

  const hasLiveWorldCoords = world?.rawX !== undefined && world?.rawY !== undefined
  const isMockSource = metrics?.source.id === 'mock'
  /** ライブ座標あり、または未接続の初期待機時は公式ワールドマップ（初期は Watopia メインスタートゲート前）を表示 */
  const useOfficialWorldMap = hasLiveWorldCoords || !isMockSource
  const worldMeta = useMemo(
    () => getWorldMetaByCourseId(hasLiveWorldCoords ? world?.courseId : 6),
    [hasLiveWorldCoords, world?.courseId]
  )
  const worldBounds = useMemo(() => getWorldMapBounds(worldMeta), [worldMeta])
  const worldMapUrl = useMemo(() => {
    setMapImgFailed(false)
    return getWorldMapUrl(worldMeta)
  }, [worldMeta])

  const liveSelfMapPos = useMemo(() => {
    if (hasLiveWorldCoords && world?.rawX !== undefined && world?.rawY !== undefined) {
      return worldPosToMapXY(worldMeta, world.rawX, world.rawY)
    }
    if (!isMockSource) {
      return { x: WATOPIA_START_GATE.x, y: WATOPIA_START_GATE.y }
    }
    return { x: world?.x ?? 560, y: world?.y ?? 620 }
  }, [hasLiveWorldCoords, isMockSource, world?.rawX, world?.rawY, world?.x, world?.y, worldMeta])

  const selfX = liveSelfMapPos.x
  const selfY = liveSelfMapPos.y
  const altitudeM = world?.altitudeM ?? (hasLiveWorldCoords || !isMockSource ? 2 : 82)
  const gradePct = world?.gradePct ?? 0
  const worldRoadPath = useMemo(() => ZWIFT_WORLD_ROAD_PATHS[worldMeta.courseId] ?? '', [worldMeta.courseId])
  const stableHeadingDegRef = useRef<number | null>(null)
  const travelDirRef = useRef<{ dx: number; dy: number } | undefined>(undefined)
  const progressTrackRef = useRef<{ routeId: number; progress: number; distanceM?: number } | null>(null)

  // 実走行軌跡から地図上の進行方向角度（度）と単位ベクトルを安定算出
  const headingDeg = useMemo(() => {
    if (hasLiveWorldCoords) {
      if (world?.trail && world.trail.length >= 2) {
        for (let i = world.trail.length - 1; i >= 0; i--) {
          const pt = world.trail[i]
          if (pt.rawX === undefined || pt.rawY === undefined) continue
          const pPrev = worldPosToMapXY(worldMeta, pt.rawX, pt.rawY)
          const dx = selfX - pPrev.x
          const dy = selfY - pPrev.y
          const dist = Math.hypot(dx, dy)
          if (dist >= 300) {
            travelDirRef.current = { dx: dx / dist, dy: dy / dist }
            const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
            stableHeadingDegRef.current = deg
            return deg
          }
        }
      }
      if (stableHeadingDegRef.current !== null) {
        return stableHeadingDegRef.current
      }
      if (world) {
        const rawDeg = (world.headingRad * 180) / Math.PI
        return worldMeta.rotateRouteSelect ? rawDeg : rawDeg + 90
      }
      return 0
    }
    return world ? (world.headingRad * 180) / Math.PI + 90 : 0
  }, [hasLiveWorldCoords, selfX, selfY, world, worldMeta])

  // 現在走行中のコース（ルート）プロファイルを特定
  const activeRoute = useMemo(() => {
    if (!hasLiveWorldCoords) return null
    return findActiveRouteProfile({
      routeId: world?.routeId,
      routeName: world?.worldName,
      courseId: worldMeta.courseId,
      mapX: selfX,
      mapY: selfY
    })
  }, [hasLiveWorldCoords, selfX, selfY, world?.routeId, world?.worldName, worldMeta.courseId])

  // コース全体に対する現在地の進行度 (0.0 〜 1.0)
  // 周回コースで別周回へ飛ばないよう、同一ルート走行中の前回進行度をトラッキングする
  const courseProgress = useMemo(() => {
    if (hasLiveWorldCoords && activeRoute) {
      const prev = progressTrackRef.current
      const isSameRoute = prev !== null && prev.routeId === activeRoute.id
      const isRideReset =
        isSameRoute &&
        prev.distanceM !== undefined &&
        world?.distanceM !== undefined &&
        world.distanceM + 200 < prev.distanceM
      const prevProgress = isSameRoute && !isRideReset ? prev.progress : undefined

      const next = computeCourseProgress(
        activeRoute,
        selfX,
        selfY,
        travelDirRef.current?.dx,
        travelDirRef.current?.dy,
        world?.distanceM,
        prevProgress
      ).progress
      progressTrackRef.current = { routeId: activeRoute.id, progress: next, distanceM: world?.distanceM }
      return next
    }
    return world?.routeProgress ?? 0.52
  }, [activeRoute, hasLiveWorldCoords, selfX, selfY, world?.distanceM, world?.routeProgress])

  const mapTrailMode = settings.overlay.mapTrailMode ?? 'full'

  // 実走行軌跡の滑らかなベジェパス（設定に応じてライド全体 / 直近5分 / 直近3分 / 非表示を切替）
  const liveSmoothTrailPath = useMemo(() => {
    if (mapTrailMode === 'off' || !world?.trail || world.trail.length < 2) return ''

    let filtered = world.trail
    if (mapTrailMode === '3m' || mapTrailMode === '5m') {
      const windowMs = mapTrailMode === '3m' ? 180_000 : 300_000
      const latestTs = world.trail[world.trail.length - 1]?.ts
      if (latestTs !== undefined) {
        const cutoff = latestTs - windowMs
        filtered = world.trail.filter((p) => p.ts === undefined || p.ts >= cutoff)
      }
    }
    if (filtered.length < 2) return ''

    // 長距離ライドでも描画を高速に保つため、1200点超の場合は描画時のみ等間隔サンプリング
    const maxDrawPts = 1200
    let sampled = filtered
    if (filtered.length > maxDrawPts) {
      const step = (filtered.length - 1) / (maxDrawPts - 1)
      sampled = []
      for (let i = 0; i < maxDrawPts; i++) {
        sampled.push(filtered[Math.min(filtered.length - 1, Math.round(i * step))])
      }
    }

    if (hasLiveWorldCoords) {
      const pts = sampled
        .filter((p) => p.rawX !== undefined && p.rawY !== undefined)
        .map((p) => worldPosToMapXY(worldMeta, p.rawX!, p.rawY!))
      return pointsToSmoothSvgPath(pts)
    }
    return pointsToSmoothSvgPath(sampled)
  }, [hasLiveWorldCoords, mapTrailMode, world?.trail, worldMeta])

  // コース全体の高低差プロファイル SVG パスと現在地の断面座標 (curX, curY)
  const elevationProfile = useMemo(() => {
    const w = 300
    const h = 46
    const srcPoints =
      hasLiveWorldCoords && activeRoute && activeRoute.elevations.length >= 2
        ? activeRoute.elevations
        : world?.trail && world.trail.length >= 2
          ? world.trail.map((p) => p.altitudeM)
          : isMockSource
            ? WORLD_ROUTE.map((p) => p.altitudeM)
            : [2, 2]

    let minAlt = Infinity
    let maxAlt = -Infinity
    for (const a of srcPoints) {
      if (a < minAlt) minAlt = a
      if (a > maxAlt) maxAlt = a
    }
    if (!Number.isFinite(minAlt)) minAlt = 0
    // 平坦〜微起伏コースでも高低差が潰れすぎず綺麗に見えるよう最小レンジ 35m を確保
    const spanAlt = Math.max(35, (maxAlt - minAlt) * 1.15)

    const coords = srcPoints.map((alt, i) => {
      const x = (i / Math.max(1, srcPoints.length - 1)) * w
      const norm = Math.max(0, Math.min(1, (alt - minAlt) / spanAlt))
      const y = h - norm * (h - 12) - 4
      return { x, y }
    })

    const ptsStr = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    const line = `M ${ptsStr.join(' L ')}`
    const area = `${line} L ${w},${h} L 0,${h} Z`

    // 断面プロファイル上の現在地 (curX, curY) を線形補間で算出
    const clampedP = Math.max(0, Math.min(1, courseProgress))
    const exactIdx = clampedP * (coords.length - 1)
    const i0 = Math.min(coords.length - 1, Math.floor(exactIdx))
    const i1 = Math.min(coords.length - 1, i0 + 1)
    const frac = exactIdx - i0
    const curX = clampedP * w
    const curY = coords[i0].y * (1 - frac) + coords[i1].y * frac

    // 周囲のライダーの断面プロファイル上の座標
    const nearbyDots: { id: string; x: number; y: number }[] = []
    if (world?.groups?.nodes && activeRoute && activeRoute.distanceM > 100) {
      for (const node of world.groups.nodes) {
        if (node.isSelf) continue
        // 秒差 × 約10m/s からコース上の相対進行度差を算出
        const deltaP = -(node.gapFromSelfSec * 10) / activeRoute.distanceM
        const np = ((clampedP + deltaP) % 1 + 1) % 1
        const nIdx = np * (coords.length - 1)
        const ni0 = Math.min(coords.length - 1, Math.floor(nIdx))
        const ni1 = Math.min(coords.length - 1, ni0 + 1)
        const nFrac = nIdx - ni0
        nearbyDots.push({
          id: node.id,
          x: np * w,
          y: coords[ni0].y * (1 - nFrac) + coords[ni1].y * nFrac
        })
      }
    }

    return { line, area, w, h, curX, curY, nearbyDots }
  }, [activeRoute, courseProgress, hasLiveWorldCoords, isMockSource, world?.groups?.nodes, world?.trail])

  // カメラのビューボックスと描画スケール単位
  const { viewBox, span, unit, cameraCenterX, cameraCenterY } = useMemo(() => {
    if (useOfficialWorldMap) {
      if (!followSelf && panOffset.x === 0 && panOffset.y === 0) {
        const fullSpan = Math.max(worldBounds.width, worldBounds.height) * 0.72
        const cx = worldBounds.x + worldBounds.width / 2
        const cy = worldBounds.y + worldBounds.height / 2
        return {
          viewBox: `${(cx - fullSpan / 2).toFixed(0)} ${(cy - fullSpan / 2).toFixed(0)} ${fullSpan.toFixed(0)} ${fullSpan.toFixed(0)}`,
          span: fullSpan,
          unit: fullSpan / 360,
          cameraCenterX: cx,
          cameraCenterY: cy
        }
      }
      const curSpan = Math.round(120000 / zoomLevel)
      const cx = selfX + panOffset.x
      const cy = selfY + panOffset.y
      return {
        viewBox: `${(cx - curSpan / 2).toFixed(0)} ${(cy - curSpan / 2).toFixed(0)} ${curSpan} ${curSpan}`,
        span: curSpan,
        unit: curSpan / 360,
        cameraCenterX: cx,
        cameraCenterY: cy
      }
    }

    if (!followSelf && panOffset.x === 0 && panOffset.y === 0) {
      return {
        viewBox: '220 40 700 880',
        span: 780,
        unit: 1.8,
        cameraCenterX: 570,
        cameraCenterY: 480
      }
    }
    const curSpan = Math.round(460 / zoomLevel)
    const cx = Math.min(820, Math.max(280, selfX)) + panOffset.x
    const cy = Math.min(820, Math.max(200, selfY)) + panOffset.y
    return {
      viewBox: `${(cx - curSpan / 2).toFixed(1)} ${(cy - curSpan / 2).toFixed(1)} ${curSpan} ${curSpan}`,
      span: curSpan,
      unit: curSpan / 460,
      cameraCenterX: cx,
      cameraCenterY: cy
    }
  }, [followSelf, panOffset.x, panOffset.y, selfX, selfY, useOfficialWorldMap, worldBounds, zoomLevel])

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (isEditMode || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStateRef.current = {
      active: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y
    }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!dragStateRef.current.active) return
    e.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    const w = rect?.width || config.width || 340
    const h = rect?.height || config.height || 340
    const dxPx = e.clientX - dragStateRef.current.startClientX
    const dyPx = e.clientY - dragStateRef.current.startClientY

    const rad = rotateHeading ? (headingDeg * Math.PI) / 180 : 0
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rotDx = dxPx * cos - dyPx * sin
    const rotDy = dxPx * sin + dyPx * cos

    const mapDx = -(rotDx / Math.max(1, w)) * span
    const mapDy = -(rotDy / Math.max(1, h)) * span
    setPanOffset({
      x: dragStateRef.current.startPanX + mapDx,
      y: dragStateRef.current.startPanY + mapDy
    })
  }

  const finishDrag = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!dragStateRef.current.active) return
    dragStateRef.current.active = false
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (!isHoveredRef.current) {
      void window.overlayApi.setOverlayInteractive(false)
    }
  }

  const handleCenterToggle = (): void => {
    if (panOffset.x !== 0 || panOffset.y !== 0) {
      setPanOffset({ x: 0, y: 0 })
      setFollowSelf(true)
    } else {
      setFollowSelf((v) => !v)
    }
  }

  const scale = config.fontScale
  const isPanned = Math.hypot(panOffset.x, panOffset.y) > unit * 5
  const displayRouteName = world?.worldName || activeRoute?.name || worldMeta.name

  return (
    <div
      ref={containerRef}
      className="hud-text relative h-full w-full overflow-hidden rounded-2xl border border-black/50 shadow-2xl select-none"
      style={{
        opacity: Math.max(0.25, config.bgOpacity),
        fontSize: `${Math.round(14 * scale)}px`
      }}
      onMouseEnter={() => {
        isHoveredRef.current = true
        void window.overlayApi.setOverlayInteractive(true)
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false
        if (!dragStateRef.current.active) {
          void window.overlayApi.setOverlayInteractive(false)
        }
      }}
      onWheel={(e) => {
        e.stopPropagation()
        setZoomLevel((z) => Math.max(0.12, Math.min(6, z * (e.deltaY < 0 ? 1.25 : 0.8))))
      }}
    >
      {/* メインマップ SVG（ドラッグでパン移動可能） */}
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ background: '#0e74e8', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={() => setSelectedEntityId(null)}
      >
        <g
          transform={
            rotateHeading
              ? `rotate(${(-headingDeg).toFixed(1)} ${cameraCenterX.toFixed(1)} ${cameraCenterY.toFixed(1)})`
              : undefined
          }
        >
          {useOfficialWorldMap ? (
            <>
              {/* 公式ワールドマップ高解像度背景画像（道路網も滑らかに描画済み） */}
              <image
                href={worldMapUrl}
                x={worldBounds.x}
                y={worldBounds.y}
                width={worldBounds.width}
                height={worldBounds.height}
                preserveAspectRatio="none"
                onError={() => setMapImgFailed(true)}
              />

              {/* オフライン等で背景画像の読み込みに失敗した場合のみ滑らかな3次ベジェ道路網を描画 */}
              {mapImgFailed && worldRoadPath && (
                <>
                  <path
                    d={worldRoadPath}
                    fill="none"
                    stroke="rgba(15, 23, 42, 0.75)"
                    strokeWidth={unit * 5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={worldRoadPath}
                    fill="none"
                    stroke="rgba(226, 232, 240, 0.85)"
                    strokeWidth={unit * 2.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}

              {/* 実走行軌跡（Catmull-Rom 3次ベジェ曲線でカクつきゼロ） */}
              {liveSmoothTrailPath && (
                <>
                  <path
                    d={liveSmoothTrailPath}
                    fill="none"
                    stroke="rgba(15, 23, 42, 0.82)"
                    strokeWidth={unit * 5.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={liveSmoothTrailPath}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={unit * 3.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}
            </>
          ) : (
            <>
              {/* 浅瀬のターコイズ海岸線 */}
              <path
                d="M 450,-40 C 440,120 465,240 450,350 C 435,450 475,540 420,615 C 365,690 425,770 355,830 C 315,865 370,940 410,1020 L 1050,1020 L 1050,-40 Z"
                fill="#22b8cf"
              />
              {/* 陸地（オリーブグリーン） */}
              <path
                d="M 475,-40 C 465,120 488,240 472,350 C 458,450 495,540 442,615 C 392,685 445,765 378,825 C 345,860 395,940 430,1020 L 1050,1020 L 1050,-40 Z"
                fill="#7b9a32"
              />

              {/* 地形の陰影・植生パッチ */}
              <path
                d="M 505,120 C 535,210 530,320 515,430 C 500,510 540,520 555,420 C 565,310 560,190 505,120 Z"
                fill="#567d2b"
                opacity="0.7"
              />
              <path
                d="M 480,250 C 505,310 498,395 486,465 C 472,510 505,525 516,455 C 528,370 520,295 480,250 Z"
                fill="#4d7326"
                opacity="0.7"
              />

              {/* スイッチバック周辺の岩肌ポリゴン */}
              <g fill="#737373" opacity="0.85">
                <polygon points="485,575 535,555 552,585 495,605" />
                <polygon points="445,635 505,618 518,645 458,662" />
                <polygon points="525,685 575,670 588,700 535,715" />
                <polygon points="435,725 492,708 505,736 445,750" />
                <polygon points="545,765 595,748 612,778 555,792" />
                <polygon points="430,805 485,792 495,822 440,835" />
              </g>

              {/* 湖・ラグーン */}
              <ellipse cx="755" cy="315" rx="22" ry="14" fill="#1da1f2" />
              <ellipse cx="788" cy="345" rx="16" ry="24" fill="#1da1f2" />
              <ellipse cx="738" cy="355" rx="14" ry="10" fill="#1da1f2" />
              <path
                d="M 530,610 C 565,590 595,620 580,665 C 560,705 510,695 505,655 Z"
                fill="#22b8cf"
                opacity="0.75"
              />

              {/* 南東ダウンタウン市街地ベース */}
              <path
                d="M 650,770 L 760,460 L 960,495 L 960,960 L 650,960 Z"
                fill="#9ca3af"
                opacity="0.75"
              />
              <path
                d="M 675,785 L 775,495 L 950,525 L 950,950 L 675,950 Z"
                fill="#1e293b"
              />

              {/* ダウンタウンの街路グリッド */}
              <g stroke="#64748b" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.85">
                <path d="M 710,720 L 910,720" />
                <path d="M 730,650 L 920,650" />
                <path d="M 755,585 L 930,585" />
                <path d="M 700,795 L 920,795" />
                <path d="M 775,525 L 775,890" />
                <path d="M 835,535 L 835,890" />
                <path d="M 895,550 L 895,890" />
              </g>

              {/* サブルート（灰色の脇道） */}
              <g stroke="#9ca3af" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 640,360 C 710,375 760,330 820,285" />
                <path d="M 625,470 C 710,450 785,410 865,390" />
                <path d="M 835,620 C 875,610 915,640 945,615" stroke="#ef4444" strokeWidth="6" />
              </g>

              {/* メインコース道路（黒縁＋白センター） */}
              <polyline
                points={ROUTE_POLYLINE}
                fill="none"
                stroke="#334155"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ROUTE_POLYLINE}
                fill="none"
                stroke="#f8fafc"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* ラウンドアバウト（ロータリー） */}
              <circle cx="755" cy="565" r="18" fill="#1e293b" stroke="#f8fafc" strokeWidth="6" />
              <circle cx="755" cy="565" r="12" fill="none" stroke="#38bdf8" strokeWidth="3" />
            </>
          )}

          {/* 周囲の Zwifter の小径ドット（クリックまたはホバー時のみラベル表示） */}
          {(world?.entities ?? []).map((ent) => {
            if (ent.isSelf) return null
            const pos =
              hasLiveWorldCoords && ent.rawX !== undefined && ent.rawY !== undefined
                ? worldPosToMapXY(worldMeta, ent.rawX, ent.rawY)
                : { x: ent.x, y: ent.y }
            const isActive = selectedEntityId === ent.id || hoveredEntityId === ent.id
            return (
              <g
                key={ent.id}
                transform={`translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredEntityId(ent.id)}
                onMouseLeave={() => setHoveredEntityId((prev) => (prev === ent.id ? null : prev))}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedEntityId((prev) => (prev === ent.id ? null : ent.id))
                }}
              >
                <circle
                  r={isActive ? unit * 4.8 : unit * 3.1}
                  fill={isActive ? '#fde047' : '#38bdf8'}
                  stroke="#0f172a"
                  strokeWidth={unit * 1.1}
                />
                {isActive && ent.label && (
                  <text
                    y={-unit * 7.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={unit * 10}
                    fontWeight="bold"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}
                  >
                    {ent.label}
                    {ent.power !== undefined ? ` (${ent.power}W)` : ''}
                  </text>
                )}
              </g>
            )
          })}

          {/* 自車マーカー（コンパクトなオレンジ発光ドット＋進行方向矢印） */}
          <g transform={`translate(${selfX.toFixed(1)}, ${selfY.toFixed(1)}) rotate(${headingDeg.toFixed(1)})`}>
            <circle r={unit * 9.5} fill="rgba(249,115,22,0.32)" />
            <circle r={unit * 5.6} fill="#f97316" stroke="#ffffff" strokeWidth={unit * 1.8} />
            <polygon
              points={`0,${(-unit * 10.5).toFixed(1)} ${(-unit * 4.2).toFixed(1)},${(-unit * 3).toFixed(1)} ${(unit * 4.2).toFixed(1)},${(-unit * 3).toFixed(1)}`}
              fill="#ffffff"
            />
          </g>
        </g>
      </svg>

      {/* 左上 コース名バッジ */}
      {(world?.worldName || useOfficialWorldMap) && (
        <div className="pointer-events-none absolute top-2.5 left-12 max-w-[58%] truncate rounded-md bg-black/60 px-2.5 py-1 text-[0.75em] font-semibold text-white/95 backdrop-blur-sm">
          {displayRouteName}
        </div>
      )}

      {/* 左上コントロールボタン（コンパス・自車追従リセット・ズーム） */}
      <div className="no-widget-drag absolute top-2.5 left-2.5 flex flex-col gap-1.5">
        <button
          type="button"
          title="進行方向回転 (ヘディングアップ) 切替"
          onClick={(e) => {
            e.stopPropagation()
            setRotateHeading((v) => !v)
          }}
          className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border shadow-md transition-colors ${
            rotateHeading
              ? 'border-sky-300 bg-[#0b5cab] text-white'
              : 'border-white/30 bg-[#0b5cab]/85 text-white/85 hover:bg-[#0b5cab]'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          type="button"
          title={isPanned ? '自車位置にセンター復帰' : '自車ズーム追従 / ワールド全体俯瞰切替'}
          onClick={(e) => {
            e.stopPropagation()
            handleCenterToggle()
          }}
          className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border shadow-md transition-colors ${
            followSelf && !isPanned
              ? 'border-sky-300 bg-white text-[#0b5cab]'
              : 'border-white/30 bg-white/80 text-slate-700 hover:bg-white'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </button>

        <div className="flex flex-col overflow-hidden rounded-lg border border-white/30 bg-black/60 text-white shadow-md backdrop-blur-sm">
          <button
            type="button"
            title="ズームイン"
            onClick={(e) => {
              e.stopPropagation()
              setFollowSelf(true)
              setZoomLevel((z) => Math.min(6, z * 1.4))
            }}
            className="flex h-6 w-8 cursor-pointer items-center justify-center text-sm font-bold hover:bg-white/20"
          >
            +
          </button>
          <button
            type="button"
            title="ズームアウト"
            onClick={(e) => {
              e.stopPropagation()
              setFollowSelf(true)
              setZoomLevel((z) => Math.max(0.12, z / 1.4))
            }}
            className="flex h-6 w-8 cursor-pointer items-center justify-center border-t border-white/15 text-sm font-bold hover:bg-white/20"
          >
            -
          </button>
        </div>
      </div>

      {/* 右上 勾配バッジ ("1.2% 🚴") */}
      <div
        className="pointer-events-none absolute top-0 right-0 flex items-baseline gap-1 rounded-bl-2xl px-3.5 py-1.5 text-white shadow-lg transition-colors duration-300"
        style={{ backgroundColor: gradeBadgeColor(gradePct) }}
      >
        <span className="text-[1.35em] font-bold tracking-tight tabular-nums">
          {gradePct >= 0 ? gradePct.toFixed(1) : gradePct.toFixed(1)}
        </span>
        <span className="text-[0.95em] font-semibold opacity-90">%</span>
        <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4 self-center opacity-90" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6" cy="17" r="3" />
          <circle cx="18" cy="17" r="3" />
          <path d="M6 17l4-7h5l3 7M10 10l3 7M13 6h2" />
        </svg>
      </div>

      {/* 下部 コース全体の高低差プロファイル + 断面上の現在地マーカー + 標高表示 ("21m") */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16">
        <svg
          viewBox={`0 0 ${elevationProfile.w} ${elevationProfile.h}`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-12 w-full"
        >
          <defs>
            <clipPath id="elev-completed-clip">
              <rect x="0" y="0" width={elevationProfile.curX} height={elevationProfile.h} />
            </clipPath>
          </defs>

          {/* コース全体の標高塗りつぶし（未走行部分） */}
          <path d={elevationProfile.area} fill="rgba(18, 23, 34, 0.76)" />

          {/* コース全体の標高塗りつぶし（現在地までの走行済み部分をハイライト） */}
          {(hasLiveWorldCoords || isMockSource) && (
            <path
              d={elevationProfile.area}
              fill="rgba(249, 115, 22, 0.35)"
              clipPath="url(#elev-completed-clip)"
            />
          )}

          {/* モック時のスプリント/KOM セグメント帯 */}
          {!useOfficialWorldMap &&
            WORLD_MARKERS.map((m) => {
              const x = m.progress * elevationProfile.w
              return (
                <rect
                  key={m.label}
                  x={x - 7}
                  y={0}
                  width={14}
                  height={elevationProfile.h}
                  fill="rgba(34, 197, 94, 0.55)"
                />
              )
            })}

          {/* コース全体の標高稜線 */}
          <path
            d={elevationProfile.line}
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.9"
            vectorEffect="non-scaling-stroke"
          />

          {/* 断面プロファイル上の現在地垂直ライン */}
          {(hasLiveWorldCoords || isMockSource) && (
            <line
              x1={elevationProfile.curX}
              y1={elevationProfile.curY}
              x2={elevationProfile.curX}
              y2={elevationProfile.h}
              stroke="rgba(251, 191, 36, 0.9)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* 断面プロファイル上のマーカー層（SVG の非等比伸縮の影響を受けず常に真円で描画） */}
        {(hasLiveWorldCoords || isMockSource) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 w-full">
            {elevationProfile.nearbyDots.map((nd) => (
              <div
                key={nd.id}
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900 bg-sky-400"
                style={{
                  left: `${(nd.x / elevationProfile.w) * 100}%`,
                  top: `${(nd.y / elevationProfile.h) * 100}%`
                }}
              />
            ))}
            <div
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow"
              style={{
                left: `${(elevationProfile.curX / elevationProfile.w) * 100}%`,
                top: `${(elevationProfile.curY / elevationProfile.h) * 100}%`
              }}
            />
          </div>
        )}

        {/* モック時の白い縦ポールマーカー */}
        {!useOfficialWorldMap &&
          WORLD_MARKERS.map((m) => (
            <div
              key={m.label}
              className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${(m.progress * 100).toFixed(1)}%` }}
            >
              <div className="h-3 w-3 rounded-full bg-white shadow" />
              <div className="h-10 w-[3px] bg-white/95 shadow" />
            </div>
          ))}

        {/* 右下 標高テキスト ("21m") + 赤ピン */}
        <div className="absolute right-2.5 bottom-2 flex items-end gap-1">
          <span className="text-[1.65em] leading-none font-extrabold tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
            {altitudeM}
            <span className="ml-0.5 text-[0.75em] font-bold">m</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-8 w-8 -mb-1 text-red-500 drop-shadow" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
        </div>
      </div>
    </div>
  )
}
