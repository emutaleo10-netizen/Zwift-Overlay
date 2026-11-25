/**
 * Garmin FIT (Flexible and Interoperable Data Transfer) バイナリストリームパーサー。
 * ライド進行中の `inProgressActivity.fit` のように末尾がまだ閉じられていないファイルや
 * 途中で切れているチャンクからでも、そこまでに含まれる最新の Record (Global Message 20) を抽出する。
 */

export interface FitRecord {
  /** FIT epoch (1989-12-31T00:00:00Z) からの秒数、または Unix epoch ms */
  timestampMs?: number
  /** W */
  power?: number
  /** bpm */
  heartRate?: number
  /** rpm */
  cadence?: number
  /** m/s */
  speed?: number
  /** m */
  distance?: number
  /** m */
  altitudeM?: number
  /** % */
  gradePct?: number
  /** semicircles または正規化座標 */
  positionLat?: number
  positionLong?: number
}

interface FieldDef {
  fieldNum: number
  size: number
  baseType: number
}

interface MessageDef {
  littleEndian: boolean
  globalMsgNum: number
  fields: FieldDef[]
  devFields: { size: number }[]
  recordSize: number
}

// FIT epoch (1989-12-31T00:00:00Z) と Unix epoch (1970-01-01T00:00:00Z) の差（秒）
const FIT_EPOCH_OFFSET_SEC = 631065600

/**
 * FIT バイナリバッファ全体を走査し、抽出されたすべての Record (Global Message 20) を返す。
 */
export function parseFitRecords(buf: Buffer): FitRecord[] {
  if (buf.length < 14) return []
  const headerSize = buf[0]
  if (headerSize < 12 || headerSize > 16 || buf.length < headerSize) return []
  const sig = buf.subarray(8, 12).toString('ascii')
  if (sig !== '.FIT') return []

  const dataSize = buf.readUInt32LE(4)
  // inProgressActivity.fit ではヘッダの dataSize が古いまま追記される場合があるため、実ファイル長を優先する
  const endOffset = Math.min(buf.length, Math.max(headerSize + dataSize, buf.length - 2))

  const defs = new Map<number, MessageDef>()
  const records: FitRecord[] = []
  let offset = headerSize
  let lastTimestampSec: number | undefined

  while (offset < endOffset) {
    const recordHeader = buf[offset]
    offset += 1

    const isCompressedTimestamp = (recordHeader & 0x80) !== 0
    if (isCompressedTimestamp) {
      const localMsgNum = (recordHeader >> 5) & 0x03
      const timeOffset = recordHeader & 0x1f
      if (lastTimestampSec !== undefined) {
        lastTimestampSec = (lastTimestampSec & ~0x1f) + timeOffset
        if (lastTimestampSec < timeOffset) lastTimestampSec += 0x20
      }
      const def = defs.get(localMsgNum)
      if (!def || offset + def.recordSize > buf.length) break
      if (def.globalMsgNum === 20) {
        const rec = decodeRecordFields(buf, offset, def, lastTimestampSec)
        if (rec) records.push(rec)
      }
      offset += def.recordSize
      continue
    }

    const isDefinition = (recordHeader & 0x40) !== 0
    const hasDevData = (recordHeader & 0x20) !== 0
    const localMsgNum = recordHeader & 0x0f

    if (isDefinition) {
      if (offset + 5 > buf.length) break
      const arch = buf[offset + 1]
      const littleEndian = arch === 0
      const globalMsgNum = littleEndian ? buf.readUInt16LE(offset + 2) : buf.readUInt16BE(offset + 2)
      const numFields = buf[offset + 4]
      offset += 5

      if (offset + numFields * 3 > buf.length) break
      const fields: FieldDef[] = []
      let recordSize = 0
      for (let i = 0; i < numFields; i++) {
        const fieldNum = buf[offset]
        const size = buf[offset + 1]
        const baseType = buf[offset + 2]
        fields.push({ fieldNum, size, baseType })
        recordSize += size
        offset += 3
      }

      const devFields: { size: number }[] = []
      if (hasDevData) {
        if (offset + 1 > buf.length) break
        const numDevFields = buf[offset]
        offset += 1
        if (offset + numDevFields * 3 > buf.length) break
        for (let i = 0; i < numDevFields; i++) {
          const size = buf[offset + 1]
          devFields.push({ size })
          recordSize += size
          offset += 3
        }
      }

      defs.set(localMsgNum, {
        littleEndian,
        globalMsgNum,
        fields,
        devFields,
        recordSize
      })
    } else {
      const def = defs.get(localMsgNum)
      if (!def || offset + def.recordSize > buf.length) break
      if (def.globalMsgNum === 20) {
        const rec = decodeRecordFields(buf, offset, def, lastTimestampSec)
        if (rec) {
          if (rec.timestampMs !== undefined) {
            lastTimestampSec = Math.floor(rec.timestampMs / 1000) - FIT_EPOCH_OFFSET_SEC
          }
          records.push(rec)
        }
      }
      offset += def.recordSize
    }
  }

  return records
}

function decodeRecordFields(
  buf: Buffer,
  startOffset: number,
  def: MessageDef,
  fallbackTsSec?: number
): FitRecord | null {
  let pos = startOffset
  const rec: FitRecord = {}
  const le = def.littleEndian

  let enhancedSpeed: number | undefined
  let enhancedAltitude: number | undefined

  for (const f of def.fields) {
    if (pos + f.size > buf.length) return null
    const val = readScalar(buf, pos, f.size, f.baseType, le)
    pos += f.size
    if (val === null) continue

    switch (f.fieldNum) {
      case 253: // timestamp (uint32, FIT seconds)
        rec.timestampMs = (val + FIT_EPOCH_OFFSET_SEC) * 1000
        break
      case 0: // position_lat (sint32)
        rec.positionLat = val
        break
      case 1: // position_long (sint32)
        rec.positionLong = val
        break
      case 2: // altitude (uint16, scale 5, offset 500)
        rec.altitudeM = val / 5 - 500
        break
      case 3: // heart_rate (uint8, bpm)
        if (val > 0 && val < 255) rec.heartRate = val
        break
      case 4: // cadence (uint8, rpm)
        if (val >= 0 && val < 255) rec.cadence = val
        break
      case 5: // distance (uint32, scale 100 -> m)
        rec.distance = val / 100
        break
      case 6: // speed (uint16, scale 1000 -> m/s)
        rec.speed = val / 1000
        break
      case 7: // power (uint16, watts)
        if (val >= 0 && val < 65535) rec.power = val
        break
      case 9: // grade (sint16, scale 100 -> %)
        rec.gradePct = val / 100
        break
      case 73: // enhanced_speed (uint32, scale 1000 -> m/s)
        enhancedSpeed = val / 1000
        break
      case 78: // enhanced_altitude (uint32, scale 5, offset 500)
        enhancedAltitude = val / 5 - 500
        break
    }
  }

  if (enhancedSpeed !== undefined) rec.speed = enhancedSpeed
  if (enhancedAltitude !== undefined) rec.altitudeM = enhancedAltitude
  if (rec.timestampMs === undefined && fallbackTsSec !== undefined) {
    rec.timestampMs = (fallbackTsSec + FIT_EPOCH_OFFSET_SEC) * 1000
  }

  const hasMetric =
    rec.power !== undefined ||
    rec.heartRate !== undefined ||
    rec.cadence !== undefined ||
    rec.speed !== undefined ||
    rec.distance !== undefined
  return hasMetric ? rec : null
}

function readScalar(
  buf: Buffer,
  pos: number,
  size: number,
  baseType: number,
  le: boolean
): number | null {
  const typeNum = baseType & 0x1f
  if (size === 1) {
    // sint8 (1) vs uint8/enum (0, 2, 10)
    if (typeNum === 1) {
      const v = buf.readInt8(pos)
      return v === 0x7f ? null : v
    }
    const v = buf.readUInt8(pos)
    return v === 0xff ? null : v
  }
  if (size === 2) {
    if (typeNum === 3) {
      const v = le ? buf.readInt16LE(pos) : buf.readInt16BE(pos)
      return v === 0x7fff ? null : v
    }
    const v = le ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos)
    return v === 0xffff ? null : v
  }
  if (size === 4) {
    if (typeNum === 5) {
      const v = le ? buf.readInt32LE(pos) : buf.readInt32BE(pos)
      return v === 0x7fffffff ? null : v
    }
    const v = le ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos)
    return v === 0xffffffff || v === 0 ? null : v
  }
  return null
}
