import { describe, expect, it } from 'vitest'
import { parseUdpPayload } from '../src/main/data/sources/zwiftUdp/udpParser'
import { parseZwiftLogLine } from '../src/main/data/sources/zwiftLog/ZwiftLogDataSource'
import { parseFitRecords } from '../src/main/data/sources/zwiftLog/fitParser'
import { decodeDropInWorldListProtobuf, decodePlayerStateProtobuf } from '../src/main/data/sources/zwiftApi/zwiftProto'

describe('parseUdpPayload', () => {
  it('フラットな JSON ペイロードを RawSample に変換する', () => {
    const sample = parseUdpPayload(
      JSON.stringify({
        power: 255,
        heartRate: 158,
        cadence: 92,
        speedKph: 36,
        distance: 1500
      }),
      1000
    )
    expect(sample).not.toBeNull()
    expect(sample?.power).toBe(255)
    expect(sample?.heartRate).toBe(158)
    expect(sample?.cadence).toBe(92)
    expect(sample?.speed).toBeCloseTo(10)
    expect(sample?.distance).toBe(1500)
  })

  it('Zwift ブリッジ互換のネスト形式（state / nearby / groups）を解析する', () => {
    const sample = parseUdpPayload(
      JSON.stringify({
        state: { watts: 280, heartrate: 165, rpm: 95, kph: 39.6, altitude: 112, grade: 4.2 },
        nearby: [
          { id: 'a1', label: 'KP', gap: -12, watts: 260, kph: 38 },
          { id: 'me', label: '3', size: 3, isSelf: true, gap: 0, watts: 280, kph: 40 },
          { id: 'a2', label: 'JP', gap: 8, watts: 245, kph: 37 }
        ],
        groups: { aheadCount: 10, behindCount: 14 }
      }),
      2000
    )
    expect(sample?.power).toBe(280)
    expect(sample?.heartRate).toBe(165)
    expect(sample?.cadence).toBe(95)
    expect(sample?.world?.altitudeM).toBe(112)
    expect(sample?.world?.gradePct).toBeCloseTo(4.2)
    expect(sample?.world?.groups.aheadCount).toBe(10)
    expect(sample?.world?.groups.behindCount).toBe(14)
    expect(sample?.world?.groups.nodes.length).toBe(3)
    expect(sample?.world?.groups.nodes[1].isSelf).toBe(true)
  })

  it('不正な JSON や空データは null を返す', () => {
    expect(parseUdpPayload('not-json')).toBeNull()
    expect(parseUdpPayload('{}')).toBeNull()
  })
})

describe('parseZwiftLogLine', () => {
  it('Zwift 実ログの FE-C SIM GRADE と FPS 座標行を解析する', () => {
    const g = parseZwiftLogLine('[0:26:23] FE-C SIM GRADE 0.045')
    expect(g.gradePct).toBeCloseTo(4.5)

    const pos = parseZwiftLogLine('[0:26:24] FPS 52.54, 12481, 13518, -4897')
    expect(pos.worldPos).toEqual({ x: 12481, z: 13518, y: -4897 })
  })

  it('カスタムログ行からパワー・心拍・ケイデンスを抽出する', () => {
    const p = parseZwiftLogLine('[21:05:12] Telemetry: Power=242 HeartRate=151 Cadence=89 SpeedKph=36.0')
    expect(p.power).toBe(242)
    expect(p.heartRate).toBe(151)
    expect(p.cadence).toBe(89)
    expect(p.speed).toBeCloseTo(10)
  })
})

describe('parseFitRecords', () => {
  it('FIT バイナリから Record (Global Message 20) のパワー・心拍・ケイデンス・速度・標高をデコードする', () => {
    // 最小の有効な FIT バイナリ (Header 14B + Definition Message + Data Record)
    const header = Buffer.alloc(14)
    header[0] = 14
    header[1] = 0x20
    header.writeUInt32LE(30, 4)
    header.write('.FIT', 8, 'ascii')

    // Definition for local msg 0 -> Global Msg 20 (Record), 4 fields:
    // field 7 (power, uint16), field 3 (heart_rate, uint8), field 4 (cadence, uint8), field 6 (speed, uint16)
    const def = Buffer.from([
      0x40, // definition header, local 0
      0x00, // reserved
      0x00, // little endian
      20, 0x00, // global msg 20 (Record)
      4, // 4 fields
      7, 2, 0x84, // power: 2 bytes, uint16
      3, 1, 0x02, // heart_rate: 1 byte, uint8
      4, 1, 0x02, // cadence: 1 byte, uint8
      6, 2, 0x84 // speed: 2 bytes, uint16 (mm/s)
    ])

    const data = Buffer.alloc(1 + 6)
    data[0] = 0x00 // data header, local 0
    data.writeUInt16LE(265, 1) // 265 W
    data.writeUInt8(162, 3) // 162 bpm
    data.writeUInt8(94, 4) // 94 rpm
    data.writeUInt16LE(10500, 5) // 10.5 m/s

    const fit = Buffer.concat([header, def, data])
    const records = parseFitRecords(fit)
    expect(records.length).toBe(1)
    expect(records[0].power).toBe(265)
    expect(records[0].heartRate).toBe(162)
    expect(records[0].cadence).toBe(94)
    expect(records[0].speed).toBeCloseTo(10.5)
  })
})

describe('decodePlayerStateProtobuf', () => {
  it('Zwift PlayerState の Protobuf バイナリパケットをデコードする', () => {
    // Varint エンコードヘルパー
    const varint = (n: number): number[] => {
      const out: number[] = []
      let v = n >>> 0
      while (v >= 0x80) {
        out.push((v & 0x7f) | 0x80)
        v >>>= 7
      }
      out.push(v)
      return out
    }
    const tagVarint = (fieldNum: number, val: number): number[] => [
      ...varint((fieldNum << 3) | 0),
      ...varint(val)
    ]

    // Player ID = 1556628 (field 1)
    // Distance = 12345 m (field 3)
    // Speed = 36,000,000 mm/h = 36.0 km/h = 10.0 m/s (field 6)
    // Cadence = 1,500,000 uHz = 90 rpm (field 9)
    // HeartRate = 158 bpm (field 11)
    // Power = 275 W (field 12)
    const payload = Buffer.from([
      ...tagVarint(1, 1556628),
      ...tagVarint(3, 12345),
      ...tagVarint(6, 36_000_000),
      ...tagVarint(9, 1_500_000),
      ...tagVarint(11, 158),
      ...tagVarint(12, 275)
    ])

    const state = decodePlayerStateProtobuf(payload)
    expect(state).not.toBeNull()
    expect(state?.id).toBe(1556628)
    expect(state?.distanceM).toBe(12345)
    expect(state?.speedKph).toBeCloseTo(36.0)
    expect(state?.speedMs).toBeCloseTo(10.0)
    expect(state?.cadenceRpm).toBe(90)
    expect(state?.heartRateBpm).toBe(158)
    expect(state?.powerWatts).toBe(275)
  })

  it('DropInWorldList Protobuf から周囲の Zwifter 一覧をデコードする', () => {
    const varint = (n: number): number[] => {
      const out: number[] = []
      let v = n >>> 0
      while (v >= 0x80) {
        out.push((v & 0x7f) | 0x80)
        v >>>= 7
      }
      out.push(v)
      return out
    }
    const tagVarint = (fieldNum: number, val: number): number[] => [
      ...varint((fieldNum << 3) | 0),
      ...varint(val)
    ]
    const tagBytes = (fieldNum: number, bytes: Buffer): number[] => [
      ...varint((fieldNum << 3) | 2),
      ...varint(bytes.length),
      ...bytes
    ]

    // DropInPlayer: athleteId=999 (f1), firstName="Taro" (f2), lastName="Zwift" (f3), power=240 (f18), speed=35,000,000 (f19)
    const playerBuf = Buffer.from([
      ...tagVarint(1, 999),
      ...tagBytes(2, Buffer.from('Taro', 'utf8')),
      ...tagBytes(3, Buffer.from('Zwift', 'utf8')),
      ...tagVarint(18, 240),
      ...tagVarint(19, 35_000_000)
    ])

    // DropInWorld: name="Watopia" (f2), courseId=6 (f3), others=playerBuf (f10)
    const worldBuf = Buffer.from([
      ...tagBytes(2, Buffer.from('Watopia', 'utf8')),
      ...tagVarint(3, 6),
      ...tagBytes(10, playerBuf)
    ])

    // DropInWorldList: worlds=worldBuf (f1)
    const listBuf = Buffer.from([...tagBytes(1, worldBuf)])

    const worlds = decodeDropInWorldListProtobuf(listBuf)
    expect(worlds.length).toBe(1)
    expect(worlds[0].courseId).toBe(6)
    expect(worlds[0].players.length).toBe(1)
    expect(worlds[0].players[0].athleteId).toBe(999)
    expect(worlds[0].players[0].firstName).toBe('Taro')
    expect(worlds[0].players[0].powerWatts).toBe(240)
    expect(worlds[0].players[0].speedKph).toBeCloseTo(35)
  })
})
