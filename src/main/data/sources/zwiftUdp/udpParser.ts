import type { GroupNode, MapEntity, RawSample, WorldState } from '@shared/types/metrics'
import { sampleRouteByDistance } from '@shared/worldRoute'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function pickNum(obj: Obj, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return undefined
}

function pickStr(obj: Obj, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return undefined
}

/**
 * ローカル UDP で受信した JSON ペイロードを RawSample に変換する。
 *
 * 対応フォーマット:
 * 1) フラット形式:
 *    { "power": 240, "heartRate": 155, "cadence": 90, "speed": 9.8, "distance": 1250 }
 *    別名キー: watts / hr / heartrate / rpm / speedKph / kph / altitude / grade 等も自動認識
 * 2) Zwift パケットモニター / ブリッジのネスト形式:
 *    { "state": { "watts": 240, "heartrate": 155, ... }, "nearby": [ ... ], "groups": { ... } }
 */
export function parseUdpPayload(input: string | Buffer, now = Date.now()): RawSample | null {
  const text = (typeof input === 'string' ? input : input.toString('utf8')).trim()
  if (!text) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(parsed)) return null

  // state または data サブオブジェクトがあればフラットに統合して読み取る
  const stateObj = isObj(parsed.state) ? parsed.state : isObj(parsed.data) ? parsed.data : parsed
  const merged: Obj = { ...parsed, ...stateObj }

  const timestamp = pickNum(merged, ['timestamp', 'ts', 'time']) ?? now
  const power = pickNum(merged, ['power', 'watts', 'w'])
  const heartRate = pickNum(merged, ['heartRate', 'heartrate', 'hr', 'bpm'])
  const cadence = pickNum(merged, ['cadence', 'rpm', 'cad'])

  // speed は m/s 優先、speedKph / kph の場合は m/s に変換
  let speed = pickNum(merged, ['speed', 'speedMs', 'velocity'])
  if (speed === undefined) {
    const kph = pickNum(merged, ['speedKph', 'kph', 'kmh'])
    if (kph !== undefined) speed = kph / 3.6
  }

  const distance = pickNum(merged, ['distance', 'distanceM', 'dist'])
  const world = parseWorldState(parsed, merged, distance)

  if (
    power === undefined &&
    heartRate === undefined &&
    cadence === undefined &&
    speed === undefined &&
    distance === undefined &&
    world === undefined
  ) {
    return null
  }

  return {
    timestamp,
    power: power !== undefined ? Math.max(0, Math.round(power)) : undefined,
    heartRate: heartRate !== undefined ? Math.max(0, Math.round(heartRate)) : undefined,
    cadence: cadence !== undefined ? Math.max(0, Math.round(cadence)) : undefined,
    speed: speed !== undefined ? Math.max(0, speed) : undefined,
    distance: distance !== undefined ? Math.max(0, distance) : undefined,
    world
  }
}

function parseWorldState(root: Obj, merged: Obj, distance: number | undefined): WorldState | undefined {
  const rawWorld = isObj(root.world) ? root.world : null
  const src = rawWorld ? { ...merged, ...rawWorld } : merged

  const hasExplicitWorld =
    rawWorld !== null ||
    src.x !== undefined ||
    src.y !== undefined ||
    src.altitude !== undefined ||
    src.altitudeM !== undefined ||
    src.grade !== undefined ||
    src.gradePct !== undefined ||
    Array.isArray(root.nearby) ||
    isObj(root.groups)

  if (!hasExplicitWorld && distance === undefined) return undefined

  const routeSample = sampleRouteByDistance(distance ?? 0)
  const x = pickNum(src, ['x', 'worldX']) ?? routeSample.x
  const y = pickNum(src, ['y', 'worldY']) ?? routeSample.y
  const altitudeM = Math.round(pickNum(src, ['altitudeM', 'altitude', 'elevation', 'alt']) ?? routeSample.altitudeM)
  const gradePct =
    Math.round((pickNum(src, ['gradePct', 'grade', 'gradient', 'slope']) ?? routeSample.gradePct) * 10) / 10
  const headingRad = pickNum(src, ['headingRad', 'heading', 'bearing']) ?? routeSample.headingRad
  const routeProgress = pickNum(src, ['routeProgress', 'progress']) ?? routeSample.progress

  // groups または nearby 配列から GroupsSummary と MapEntity[] を組み立てる
  const groupsObj = isObj(src.groups) ? src.groups : isObj(root.groups) ? root.groups : null
  const nearbyList = Array.isArray(src.nearby)
    ? src.nearby
    : Array.isArray(root.nearby)
      ? root.nearby
      : groupsObj && Array.isArray(groupsObj.nodes)
        ? groupsObj.nodes
        : null

  const nodes: GroupNode[] = []
  const entities: MapEntity[] = []

  if (nearbyList && nearbyList.length > 0) {
    nearbyList.forEach((item, idx) => {
      if (!isObj(item)) return
      const id = pickStr(item, ['id', 'athleteId']) ?? `node-${idx}`
      const isSelf = Boolean(item.isSelf ?? item.self ?? false)
      const size = Math.max(1, Math.round(pickNum(item, ['size', 'count']) ?? 1))
      const label = pickStr(item, ['label', 'initials', 'name']) ?? (size > 1 ? String(size) : 'ZW')
      const gapFromSelfSec = Math.round(pickNum(item, ['gapFromSelfSec', 'gap', 'gapSec']) ?? 0)
      const gapFromPrevSec = Math.round(pickNum(item, ['gapFromPrevSec', 'intervalSec']) ?? Math.abs(gapFromSelfSec))
      const p = Math.max(0, Math.round(pickNum(item, ['power', 'watts', 'w']) ?? 0))
      const kph = Math.max(
        0,
        Math.round(pickNum(item, ['speedKph', 'kph', 'kmh']) ?? (pickNum(item, ['speed']) ?? 0) * 3.6)
      )

      nodes.push({
        id,
        label: label.slice(0, 3).toUpperCase(),
        size,
        isSelf,
        gapFromPrevSec,
        gapFromSelfSec,
        power: p,
        speedKph: kph
      })

      const pos = sampleRouteByDistance((distance ?? 0) - gapFromSelfSec * 9.5)
      entities.push({
        id,
        label,
        x: pickNum(item, ['x']) ?? pos.x,
        y: pickNum(item, ['y']) ?? pos.y,
        isSelf
      })
    })
  }

  // 自分ノードが含まれていなければ追加
  if (!nodes.some((n) => n.isSelf)) {
    const selfPower = Math.max(0, Math.round(pickNum(merged, ['power', 'watts', 'w']) ?? 0))
    const selfKph = Math.max(
      0,
      Math.round(
        pickNum(merged, ['speedKph', 'kph']) ?? (pickNum(merged, ['speed']) ?? 0) * 3.6
      )
    )
    nodes.push({
      id: 'self',
      label: 'YOU',
      size: 1,
      isSelf: true,
      gapFromPrevSec: 0,
      gapFromSelfSec: 0,
      power: selfPower,
      speedKph: selfKph
    })
  }

  if (!entities.some((e) => e.isSelf)) {
    entities.push({ id: 'self', label: 'YOU', x, y, isSelf: true })
  }

  nodes.sort((a, b) => a.gapFromSelfSec - b.gapFromSelfSec)

  const totalAthletes =
    (groupsObj && pickNum(groupsObj, ['totalAthletes', 'total'])) ??
    nodes.reduce((acc, n) => acc + n.size, 0)
  const aheadCount = (groupsObj && pickNum(groupsObj, ['aheadCount', 'ahead'])) ?? 0
  const behindCount = (groupsObj && pickNum(groupsObj, ['behindCount', 'behind'])) ?? 0

  return {
    routeProgress,
    x,
    y,
    headingRad,
    altitudeM,
    gradePct,
    entities,
    groups: {
      totalAthletes,
      aheadCount,
      behindCount,
      nodes
    }
  }
}
