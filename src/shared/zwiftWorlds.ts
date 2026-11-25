export interface ZwiftWorldMeta {
  courseId: number
  worldId: number
  name: string
  minX: number
  minY: number
  maxX: number
  maxY: number
  anchorX: number
  anchorY: number
  rotateRouteSelect: boolean
  mapVersion: number
  tileScale: number
  mapScale: number
  seaLevel: number
}

/**
 * Sauce for Zwift (worldlist.json) 準拠の全ワールド座標定義テーブル。
 * Zwift の生 3D 座標 (x, y [単位: cm]) と公式マップ画像 (world{worldId}.webp) を正確に一致させる。
 */
export const ZWIFT_WORLDS: readonly ZwiftWorldMeta[] = [
  {
    courseId: 6,
    worldId: 1,
    name: 'Watopia',
    minX: -423600,
    minY: 0,
    maxX: 1270800,
    maxY: 1270800,
    anchorX: -400900,
    anchorY: -209700,
    rotateRouteSelect: true,
    mapVersion: 3,
    tileScale: 847200,
    mapScale: 3072,
    seaLevel: 9000
  },
  {
    courseId: 2,
    worldId: 2,
    name: 'Richmond',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 847200,
    anchorX: -462300,
    anchorY: -383600,
    rotateRouteSelect: true,
    mapVersion: 0,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 9000
  },
  {
    courseId: 7,
    worldId: 3,
    name: 'London',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 847200,
    anchorX: -67200,
    anchorY: -383900,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 9000
  },
  {
    courseId: 8,
    worldId: 4,
    name: 'New York',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 2541600,
    anchorX: -387400,
    anchorY: -554700,
    rotateRouteSelect: false,
    mapVersion: 3,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 2000
  },
  {
    courseId: 9,
    worldId: 5,
    name: 'Innsbruck',
    minX: 0,
    minY: 0,
    maxX: 992500,
    maxY: 992500,
    anchorX: -342800,
    anchorY: -243700,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 992500,
    mapScale: 4096,
    seaLevel: 9000
  },
  {
    courseId: 10,
    worldId: 6,
    name: 'Bologna',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 847200,
    anchorX: -637400,
    anchorY: -400700,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 9000
  },
  {
    courseId: 11,
    worldId: 7,
    name: 'Yorkshire',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 847200,
    anchorX: -589365,
    anchorY: -380288,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 9000
  },
  {
    courseId: 12,
    worldId: 8,
    name: 'Crit City',
    minX: 0,
    minY: 0,
    maxX: 423600,
    maxY: 423600,
    anchorX: -207100,
    anchorY: -208000,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 423600,
    mapScale: 2048,
    seaLevel: 9000
  },
  {
    courseId: 13,
    worldId: 9,
    name: 'Makuri Islands',
    minX: -423600,
    minY: -423600,
    maxX: 847200,
    maxY: 847200,
    anchorX: -710900,
    anchorY: -346500,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 847200,
    mapScale: 4096,
    seaLevel: 15000
  },
  {
    courseId: 14,
    worldId: 10,
    name: 'France',
    minX: 207248.1585,
    minY: 209392.164,
    maxX: 1478498.1585,
    maxY: 1480642.164,
    anchorX: -886900,
    anchorY: -820200,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 1695000,
    mapScale: 8192,
    seaLevel: 9000
  },
  {
    courseId: 15,
    worldId: 11,
    name: 'Paris',
    minX: 0,
    minY: 0,
    maxX: 847200,
    maxY: 847200,
    anchorX: -211800,
    anchorY: -211900,
    rotateRouteSelect: false,
    mapVersion: 2,
    tileScale: 423600,
    mapScale: 2048,
    seaLevel: 9000
  },
  {
    courseId: 16,
    worldId: 12,
    name: 'Gravel Mountain',
    minX: 0,
    minY: 0,
    maxX: 210500,
    maxY: 210500,
    anchorX: -107400,
    anchorY: -314000,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 210500,
    mapScale: 2048,
    seaLevel: 17422
  },
  {
    courseId: 17,
    worldId: 13,
    name: 'Scotland',
    minX: 0,
    minY: 0,
    maxX: 639800,
    maxY: 639800,
    anchorX: -451100,
    anchorY: -320100,
    rotateRouteSelect: false,
    mapVersion: 0,
    tileScale: 639800,
    mapScale: 4096,
    seaLevel: 8000
  }
]

export function getWorldMetaByCourseId(courseId?: number): ZwiftWorldMeta {
  if (courseId !== undefined) {
    const found = ZWIFT_WORLDS.find((w) => w.courseId === courseId)
    if (found) return found
  }
  return ZWIFT_WORLDS[0]
}

export function getWorldMapUrl(meta: ZwiftWorldMeta): string {
  const ver = meta.mapVersion ? `-v${meta.mapVersion}` : ''
  return `https://www.sauce.llc/products/sauce4zwift/maps/world${meta.worldId}${ver}.webp`
}

export function getWorldMapBounds(meta: ZwiftWorldMeta): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: meta.minX + meta.anchorX,
    y: meta.minY + meta.anchorY,
    width: meta.maxX - meta.minX,
    height: meta.maxY - meta.minY
  }
}

/**
 * Zwift の生 3D 座標 (rawX, rawY) をワールドマップ画像上の SVG 座標に変換する。
 * Watopia / Richmond のような rotateRouteSelect=true のワールドでは [y, -x] に90度回転される。
 */
export function worldPosToMapXY(meta: ZwiftWorldMeta, rawX: number, rawY: number): { x: number; y: number } {
  if (meta.rotateRouteSelect) {
    return { x: rawY, y: -rawX }
  }
  return { x: rawX, y: rawY }
}
