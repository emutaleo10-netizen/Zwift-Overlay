/**
 * Zwift Protocol Buffers (PlayerState / DropInWorldList) 軽量バイナリデコーダー。
 */

export interface ZwiftPlayerState {
  id: number
  worldTime?: number
  /** m */
  distanceM: number
  roadTime: number
  laps: number
  /** m/s */
  speedMs: number
  /** km/h */
  speedKph: number
  /** rpm */
  cadenceRpm: number
  /** bpm */
  heartRateBpm: number
  /** W */
  powerWatts: number
  /** rad */
  headingRad: number
  /** m */
  climbingM: number
  /** sec */
  elapsedSec: number
  /** world X */
  x?: number
  /** world Z (altitude cm) */
  z?: number
  /** m */
  altitudeM?: number
  /** world Y */
  y?: number
  watchingRiderId?: number
  groupId?: number
  courseId?: number
  routeId?: number
  roadId?: number
  reverse?: boolean
}

export interface ZwiftDropInPlayer {
  athleteId: number
  firstName: string
  lastName: string
  distanceM: number
  powerWatts: number
  speedKph: number
  x?: number
  z?: number
  y?: number
  courseId?: number
}

export interface ZwiftDropInWorld {
  courseId: number
  name: string
  players: ZwiftDropInPlayer[]
}

function readVarint(buf: Buffer, offset: number): { value: bigint; nextOffset: number } | null {
  let result = 0n
  let shift = 0n
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos]
    pos += 1
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: pos }
    }
    shift += 7n
    if (shift > 64n) return null
  }
  return null
}

/**
 * Protobuf バイナリから PlayerState をデコードする。
 */
export function decodePlayerStateProtobuf(buf: Buffer): ZwiftPlayerState | null {
  let offset = 0
  let id = 0
  let worldTime: number | undefined
  let distanceM = 0
  let roadTime = 0
  let laps = 0
  let rawSpeed = 0
  let cadenceUHz = 0
  let heartRateBpm = 0
  let powerWatts = 0
  let rawHeading = 0
  let climbingM = 0
  let elapsedSec = 0
  let flags1 = 0
  let flags2 = 0
  let x: number | undefined
  let z: number | undefined
  let y: number | undefined
  let watchingRiderId: number | undefined
  let groupId: number | undefined
  let courseId: number | undefined
  let routeId: number | undefined
  let parsedFields = 0

  while (offset < buf.length) {
    const tag = readVarint(buf, offset)
    if (!tag) break
    offset = tag.nextOffset
    const fieldNum = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)

    if (wireType === 0) {
      const v = readVarint(buf, offset)
      if (!v) break
      offset = v.nextOffset
      const num = Number(BigInt.asIntN(64, v.value))
      const unum = Number(BigInt.asUintN(32, v.value))
      parsedFields += 1

      switch (fieldNum) {
        case 1:
          id = num
          break
        case 2:
          worldTime = num
          break
        case 3:
          distanceM = Math.max(0, num)
          break
        case 4:
          roadTime = Math.max(0, num)
          break
        case 5:
          laps = Math.max(0, num)
          break
        case 6:
          rawSpeed = Math.max(0, num)
          break
        case 9:
          cadenceUHz = Math.max(0, num)
          break
        case 11:
          heartRateBpm = Math.max(0, num)
          break
        case 12:
          powerWatts = Math.max(0, num)
          break
        case 13:
          rawHeading = num
          break
        case 15:
          climbingM = num
          break
        case 16:
          elapsedSec = Math.max(0, num)
          break
        case 19:
          flags1 = unum
          break
        case 20:
          flags2 = unum
          break
        case 28:
          watchingRiderId = num
          break
        case 29:
          groupId = num
          break
        case 35:
          courseId = num
          break
        case 39:
          routeId = unum || undefined
          break
      }
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break
      const f = buf.readFloatLE(offset)
      offset += 4
      parsedFields += 1
      switch (fieldNum) {
        case 25:
          x = f
          break
        case 26:
          z = f
          break
        case 27:
          y = f
          break
      }
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break
      offset += 8
    } else if (wireType === 2) {
      const len = readVarint(buf, offset)
      if (!len) break
      offset = len.nextOffset + Number(len.value)
    } else {
      break
    }
  }

  if (parsedFields === 0) return null

  const speedKph = rawSpeed > 1000 ? rawSpeed / 1_000_000 : rawSpeed
  const speedMs = speedKph / 3.6
  const cadenceRpm =
    cadenceUHz > 1000 && cadenceUHz < 4_000_000
      ? Math.round((cadenceUHz * 60) / 1_000_000)
      : cadenceUHz <= 240
        ? Math.round(cadenceUHz)
        : 0

  const HALF_CIRCLE = 1e6 * Math.PI
  const headingDeg =
    Math.abs(rawHeading) > 100
      ? (((rawHeading + HALF_CIRCLE) / (2 * HALF_CIRCLE)) * 360) % 360
      : ((rawHeading * 180) / Math.PI + 360) % 360
  const headingRad = (headingDeg * Math.PI) / 180

  let altitudeM: number | undefined
  if (z !== undefined && Number.isFinite(z)) {
    altitudeM = z > 5000 ? (z - 9000) / 200 : z / 100
  }

  const reverse = flags1 ? !(flags1 & 0b100) : undefined
  const roadId = flags2 ? (flags2 >>> 8) & 0xffff : undefined

  return {
    id,
    worldTime,
    distanceM,
    roadTime,
    laps,
    speedMs,
    speedKph,
    cadenceRpm,
    heartRateBpm,
    powerWatts,
    headingRad,
    climbingM,
    elapsedSec,
    x,
    z,
    altitudeM,
    y,
    watchingRiderId,
    groupId,
    courseId,
    routeId,
    roadId,
    reverse
  }
}

/**
 * Zwift Relay API が JSON を返した場合のデコーダー。
 */
export function decodePlayerStateJson(raw: unknown): ZwiftPlayerState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const num = (k: string, def = 0): number =>
    typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : def

  const id = num('id', num('athleteId', num('playerId', 0)))
  const rawSpeed = num('speed', num('_speed', 0))
  const speedKph = rawSpeed > 1000 ? rawSpeed / 1_000_000 : rawSpeed
  const speedMs = speedKph / 3.6

  const rawCad = num('cadenceUHz', num('_cadence', num('cadence', 0)))
  const cadenceRpm = rawCad > 1000 ? Math.round((rawCad * 60) / 1_000_000) : Math.round(rawCad)

  const rawAlt = typeof r.altitude === 'number' ? r.altitude : typeof r.z === 'number' ? r.z : undefined
  const altitudeM =
    rawAlt !== undefined ? (rawAlt > 5000 ? (rawAlt - 9000) / 200 : rawAlt > 1000 ? rawAlt / 100 : rawAlt) : undefined

  return {
    id,
    worldTime: typeof r.worldTime === 'number' ? r.worldTime : undefined,
    distanceM: num('distance', 0),
    roadTime: num('roadTime', 0),
    laps: num('laps', 0),
    speedMs,
    speedKph,
    cadenceRpm,
    heartRateBpm: num('heartrate', num('heartRate', 0)),
    powerWatts: num('power', num('watts', 0)),
    headingRad: num('heading', num('_heading', 0)) / 1_000_000,
    climbingM: num('climbing', 0),
    elapsedSec: num('time', 0),
    x: typeof r.x === 'number' ? r.x : undefined,
    z: typeof r.z === 'number' ? r.z : undefined,
    altitudeM,
    y: typeof r.y === 'number' ? r.y : undefined,
    watchingRiderId: typeof r.watchingRiderId === 'number' ? r.watchingRiderId : undefined,
    groupId: typeof r.groupId === 'number' ? r.groupId : undefined,
    courseId: typeof r.courseId === 'number' ? r.courseId : undefined
  }
}

function decodeDropInPlayer(buf: Buffer, courseId: number): ZwiftDropInPlayer | null {
  let offset = 0
  let athleteId = 0
  let firstName = ''
  let lastName = ''
  let distanceM = 0
  let powerWatts = 0
  let rawSpeed = 0
  let x: number | undefined
  let z: number | undefined
  let y: number | undefined

  while (offset < buf.length) {
    const tag = readVarint(buf, offset)
    if (!tag) break
    offset = tag.nextOffset
    const fieldNum = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)

    if (wireType === 0) {
      const v = readVarint(buf, offset)
      if (!v) break
      offset = v.nextOffset
      const num = Number(BigInt.asIntN(64, v.value))
      switch (fieldNum) {
        case 1:
          athleteId = num
          break
        case 4:
          distanceM = Math.max(0, num)
          break
        case 18:
          powerWatts = Math.max(0, num)
          break
        case 19:
          rawSpeed = Math.max(0, num)
          break
      }
    } else if (wireType === 2) {
      const len = readVarint(buf, offset)
      if (!len) break
      const strEnd = len.nextOffset + Number(len.value)
      if (strEnd > buf.length) break
      const str = buf.subarray(len.nextOffset, strEnd).toString('utf8')
      offset = strEnd
      if (fieldNum === 2) firstName = str
      else if (fieldNum === 3) lastName = str
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break
      const f = buf.readFloatLE(offset)
      offset += 4
      if (fieldNum === 14) x = f
      else if (fieldNum === 15) z = f
      else if (fieldNum === 16) y = f
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break
      offset += 8
    } else {
      break
    }
  }

  if (!athleteId) return null
  const speedKph = rawSpeed > 1000 ? rawSpeed / 1_000_000 : rawSpeed
  return {
    athleteId,
    firstName,
    lastName,
    distanceM,
    powerWatts,
    speedKph,
    x,
    z,
    y,
    courseId
  }
}

function decodeDropInWorld(buf: Buffer): ZwiftDropInWorld | null {
  let offset = 0
  let courseId = 6
  let name = ''
  const players: ZwiftDropInPlayer[] = []

  while (offset < buf.length) {
    const tag = readVarint(buf, offset)
    if (!tag) break
    offset = tag.nextOffset
    const fieldNum = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)

    if (wireType === 0) {
      const v = readVarint(buf, offset)
      if (!v) break
      offset = v.nextOffset
      if (fieldNum === 3) courseId = Number(BigInt.asIntN(32, v.value))
    } else if (wireType === 2) {
      const len = readVarint(buf, offset)
      if (!len) break
      const end = len.nextOffset + Number(len.value)
      if (end > buf.length) break
      const sub = buf.subarray(len.nextOffset, end)
      offset = end
      if (fieldNum === 2) {
        name = sub.toString('utf8')
      } else if (fieldNum === 8 || fieldNum === 9 || fieldNum === 10 || fieldNum === 12) {
        const p = decodeDropInPlayer(sub, courseId)
        if (p) players.push(p)
      }
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      break
    }
  }

  return { courseId, name, players }
}

/**
 * `/relay/dropin` の DropInWorldList Protobuf をデコードし、ワールド内の周囲プレイヤー一覧を返す。
 */
export function decodeDropInWorldListProtobuf(buf: Buffer): ZwiftDropInWorld[] {
  let offset = 0
  const worlds: ZwiftDropInWorld[] = []

  while (offset < buf.length) {
    const tag = readVarint(buf, offset)
    if (!tag) break
    offset = tag.nextOffset
    const fieldNum = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 0x07n)

    if (wireType === 2) {
      const len = readVarint(buf, offset)
      if (!len) break
      const end = len.nextOffset + Number(len.value)
      if (end > buf.length) break
      if (fieldNum === 1) {
        const w = decodeDropInWorld(buf.subarray(len.nextOffset, end))
        if (w) worlds.push(w)
      }
      offset = end
    } else if (wireType === 0) {
      const v = readVarint(buf, offset)
      if (!v) break
      offset = v.nextOffset
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      break
    }
  }

  return worlds
}
