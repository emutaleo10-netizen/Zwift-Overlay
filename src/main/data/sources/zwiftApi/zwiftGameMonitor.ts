import crypto from 'node:crypto'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import protobuf from 'protobufjs'
import { debugLog } from '../../../debugLogger'
import type { ZwiftPlayerState } from './zwiftProto'

/**
 * Zwift Relay TCP/UDP 通信およびプロフィールバッチ取得に必要な Protobuf スキーマ定義。
 * 外部ファイルパスに依存せずバンドル後やテスト環境でも確実に動作するようインラインでパースする。
 */
const ZWIFT_RELAY_PROTO = `
syntax = "proto3";

enum Sport {
  cycling = 0;
  running = 1;
  rowing = 2;
  sport3 = 3;
  sport4 = 4;
}

message PlayerState {
  int32 athleteId = 1;
  optional uint64 worldTime = 2;
  optional int32 distance = 3;
  optional int32 roadTime = 4;
  optional int32 laps = 5;
  optional int32 _speed = 6;
  optional int32 acceleration = 7;
  optional int32 roadPosition = 8;
  optional int32 _cadence = 9;
  optional int32 draft = 10;
  optional int32 heartrate = 11;
  optional int32 power = 12;
  optional int32 _heading = 13;
  optional int32 lean = 14;
  optional int32 climbing = 15;
  optional int32 time = 16;
  optional int32 animationState = 17;
  optional uint32 frameHue = 18;
  optional uint32 _flags1 = 19;
  optional uint32 _flags2 = 20;
  optional uint32 _progress = 21;
  optional int64 profileUpdatedAt = 22;
  optional bool justWatching = 23;
  optional int32 _mwHours = 24;
  optional float x = 25;
  optional float z = 26;
  optional float y = 27;
  optional int32 watchingAthleteId = 28;
  optional int32 eventSubgroupId = 29;
  optional Sport sport = 31;
  optional int32 timeGap = 33;
  optional float _eventDistance = 34;
  int32 courseId = 35;
  optional int32 routeCheckpointIndex = 36;
  optional int32 routeDecisionIndex = 37;
  optional bool canSteer = 38;
  optional uint32 routeId = 39;
  optional int32 pacerBotGroupSize = 40;
  optional bool activeSteer = 41;
  optional int32 rideOnStyle = 42;
  optional bool portal = 43;
  optional int32 portalGradientScale = 44;
  optional int32 portalElevationScale = 45;
  repeated int32 playerVFXs = 49;
  optional bool bigHeadActive = 50;
  optional int32 botId = 51;
}

message UDPServer {
  int32 realm = 1;
  int32 courseId = 2;
  string host = 3;
  int32 port = 4;
  float xBound = 5;
  float yBound = 6;
  float xBoundMin = 7;
  float yBoundMin = 8;
  int32 securePort = 9;
}

message UDPServerVODPool {
  int32 realm = 1;
  int32 courseId = 2;
  repeated UDPServer servers = 3;
  bool useFirstInBounds = 4;
}

message UDPConfigVOD {
  repeated UDPServerVODPool pools = 1;
  int32 port = 2;
  int64 maxPlayerStateAsOf = 3;
  int32 watchingAthleteId = 4;
  float watchingX = 5;
  float watchingY = 6;
  int32 securePort = 7;
  repeated UDPServerVODPool portalPools = 8;
}

message UDPConfig {
  repeated UDPServer servers = 1;
  int32 clientTimeout = 2;
  int32 reconnectionInterval = 3;
  int32 maxReconnectAttempts = 4;
}

message TCPServer {
  string host = 1;
  int32 port = 2;
  int32 realm = 3;
  int32 courseId = 4;
  int32 securePort = 5;
}

message TCPConfig {
  repeated TCPServer servers = 1;
  bool forceReconnect = 2;
}

message PartnersUrls {
  string todaysplanUrl = 1;
  string trainingpeaksUrl = 2;
}

message SessionInfo {
  string relayUrl = 1;
  PartnersUrls apis = 2;
  uint64 time = 3;
  TCPConfig tcpConfig = 4;
  int32 maxSegmentSubs = 5;
}

message LoginResponse {
  string sessionId = 1;
  SessionInfo session = 2;
  uint32 relaySessionId = 3;
  uint32 expiration = 4;
  bytes economyConfig = 5;
}

message AnalyticsEventProperty {
  string key = 1;
  string value = 2;
}

message AnalyticsEventProperties {
  repeated AnalyticsEventProperty entries = 2;
}

message LoginRequest {
  AnalyticsEventProperties properties = 1;
  bytes aesKey = 2;
  bool useComputedEconomyConfig = 3;
  bool recomputeEconomyConfig = 4;
  bool forceSimultaneousLogin = 5;
  uint32 xpTableVersion = 6;
}

message RelaySessionRenewRequest {
  uint32 relaySessionId = 1;
  bytes aesKey = 2;
}

message RelaySessionRenewResponse {
  uint32 relaySessionId = 1;
  uint32 expiration = 2;
}

message ServerToClient {
  int32 realm = 1;
  int32 athleteId = 2;
  uint64 worldTime = 3;
  int32 seqno = 4;
  int32 ackSeqno = 5;
  repeated PlayerState playerStates = 8;
  int32 athleteCount = 14;
  int64 latency = 17;
  int32 msgCount = 18;
  int32 msg = 19;
  bool multipleLogins = 20;
  UDPConfig udpConfig = 24;
  UDPConfigVOD udpConfigVOD = 25;
  int32 expungeReason = 26;
  UDPConfigVOD fullUDPConfigVOD = 27;
  repeated PlayerState blockPlayerStates = 28;
  TCPConfig tcpConfig = 29;
}

message ClientToServer {
  int32 realm = 1;
  int32 athleteId = 2;
  optional int64 worldTime = 3;
  int32 seqno = 4;
  int32 lastMessageReceived = 5;
  int64 lastMessageReceivedAt = 6;
  PlayerState state = 7;
  bool requestAuxiliaryControllerIpAddress = 11;
  int64 largestWorldAttributeSequenceNumber = 12;
  int64 largestWorldAttributeTimestamp = 13;
  bool _redacted = 14;
  repeated sint64 subscribeToSegments = 15;
  repeated sint64 unsubscribeFromSegments = 16;
}

message PlayerProfile {
  int64 id = 1;
  int32 worldId = 2;
  string emailAddress = 3;
  string firstName = 4;
  string lastName = 5;
  bool male = 6;
  int32 weight = 9;
  int32 ftp = 10;
  int32 countryCode = 34;
}

message PlayerProfiles {
  repeated PlayerProfile profiles = 1;
}
`

const protoRoot = protobuf.parse(ZWIFT_RELAY_PROTO, { keepCase: true }).root
const PB_LoginRequest = protoRoot.lookupType('LoginRequest')
const PB_LoginResponse = protoRoot.lookupType('LoginResponse')
const PB_ClientToServer = protoRoot.lookupType('ClientToServer')
const PB_ServerToClient = protoRoot.lookupType('ServerToClient')
const PB_PlayerProfiles = protoRoot.lookupType('PlayerProfiles')

const REALM = 1
const RELAY_BASE = 'https://us-or-rly101.zwift.com'
const HALF_CIRCLE = 1e6 * Math.PI
const CADENCE_MAX = (240 * 1e6) / 60

class WorldTimer {
  private readonly epoch = 1414016074400
  private offset = 0

  now(): number {
    return Date.now() + this.offset - this.epoch
  }

  serverNow(): number {
    return Date.now() + this.offset
  }

  setOffset(ms: number): void {
    this.offset = Math.round(ms)
  }
}

const worldTimer = new WorldTimer()

const DEVICE_TYPES = { game: 1, companion: 2 } as const
const CHANNEL_TYPES = { udpClient: 1, udpServer: 2, tcpClient: 3, tcpServer: 4 } as const
const HEADER_FLAGS = { seqno: 1, connId: 2, relayId: 4 } as const

class RelayIV {
  seqno = 0
  readonly connId: number
  private readonly defaultBuf: Buffer

  constructor(opts: {
    deviceType: keyof typeof DEVICE_TYPES
    channelType: keyof typeof CHANNEL_TYPES
    connId: number
  }) {
    this.connId = opts.connId || 0
    this.defaultBuf = Buffer.alloc(12, 0)
    this.defaultBuf.writeUInt16BE(DEVICE_TYPES[opts.deviceType], 2)
    this.defaultBuf.writeUInt16BE(CHANNEL_TYPES[opts.channelType], 4)
    this.defaultBuf.writeUInt16BE(this.connId, 6)
  }

  toBuffer(seqno = this.seqno): Buffer {
    const ivBuf = Buffer.from(this.defaultBuf)
    ivBuf.writeUInt32BE(seqno >>> 0, 8)
    return ivBuf
  }
}

interface RelaySession {
  aesKey: Buffer
  relayId: number
  athleteId: number
  tcpServers: { host: string; securePort: number }[]
  expires: number
}

interface NormalizedUDPServer {
  host: string
  securePort: number
  xBound: number
  yBound: number
  isDirect: boolean
}

interface NormalizedUDPPool {
  realm: number
  courseId: number
  useFirstInBounds: boolean
  servers: NormalizedUDPServer[]
}

function toNumberField(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber()
  }
  return Number(v) || 0
}

export function convertPBPlayerState(msg: Record<string, unknown>): ZwiftPlayerState | null {
  const id = toNumberField(msg.athleteId)
  if (!id) return null
  const worldTime = msg.worldTime != null ? toNumberField(msg.worldTime) : undefined
  const distanceM = Math.max(0, toNumberField(msg.distance))
  const roadTime = Math.max(0, toNumberField(msg.roadTime))
  const laps = Math.max(0, toNumberField(msg.laps))
  const rawSpeed = Math.max(0, toNumberField(msg._speed))
  const speedKph = rawSpeed > 1000 ? rawSpeed / 1e6 : rawSpeed
  const speedMs = speedKph / 3.6
  const rawCad = Math.max(0, toNumberField(msg._cadence))
  const cadenceRpm = rawCad > 0 && rawCad < CADENCE_MAX ? Math.round(rawCad * 6e-5) : 0
  const heartRateBpm = Math.max(0, toNumberField(msg.heartrate))
  const powerWatts = Math.max(0, toNumberField(msg.power))
  const rawHeading = toNumberField(msg._heading)
  const headingDeg = (((rawHeading + HALF_CIRCLE) / (2 * HALF_CIRCLE)) * 360) % 360
  const headingRad = (headingDeg * Math.PI) / 180
  const climbingM = toNumberField(msg.climbing)
  const elapsedSec = Math.max(0, toNumberField(msg.time))

  const flags1 = toNumberField(msg._flags1) >>> 0
  const flags2 = toNumberField(msg._flags2) >>> 0
  const reverse = flags1 ? !(flags1 & 0b100) : undefined
  const roadId = flags2 ? (flags2 >>> 8) & 0xffff : undefined

  const x = typeof msg.x === 'number' ? msg.x : undefined
  const z = typeof msg.z === 'number' ? msg.z : undefined
  const y = typeof msg.y === 'number' ? msg.y : undefined
  let altitudeM: number | undefined
  if (z !== undefined && Number.isFinite(z)) {
    altitudeM = z > 5000 ? (z - 9000) / 200 : z / 100
  }

  const watchingRiderId = msg.watchingAthleteId != null ? toNumberField(msg.watchingAthleteId) : undefined
  const groupId = msg.eventSubgroupId != null ? toNumberField(msg.eventSubgroupId) : undefined
  const courseId = msg.courseId != null ? toNumberField(msg.courseId) : undefined
  const routeId = msg.routeId != null ? toNumberField(msg.routeId) || undefined : undefined

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

let tcpConnCounter = 0
let udpConnCounter = 0

abstract class NetChannel extends EventEmitter {
  readonly host: string
  readonly port: number
  readonly connId: number
  readonly relayId: number
  readonly aesKey: Buffer
  readonly athleteId: number
  protected sendSeqno = 1
  protected readonly sendIV: RelayIV
  protected readonly recvIV: RelayIV
  recvCount = 0
  sendCount = 0
  isShutdown = false
  isEstablished = false

  constructor(opts: {
    host: string
    port: number
    protocol: 'tcp' | 'udp'
    session: RelaySession
    connId: number
  }) {
    super()
    this.host = opts.host
    this.port = opts.port
    this.connId = opts.connId
    this.relayId = opts.session.relayId
    this.aesKey = opts.session.aesKey
    this.athleteId = opts.session.athleteId
    this.sendIV = new RelayIV({
      deviceType: 'game',
      channelType: `${opts.protocol}Client`,
      connId: this.connId
    })
    this.recvIV = new RelayIV({
      deviceType: 'game',
      channelType: `${opts.protocol}Server`,
      connId: this.connId
    })
  }

  protected decrypt(data: Buffer): Buffer {
    const iv = this.recvIV
    const flags = data.readUInt8(0)
    let headerOfft = 1
    if (flags & HEADER_FLAGS.relayId) {
      const relayId = data.readUInt32BE(headerOfft)
      if (relayId !== this.relayId) throw new Error('Bad Relay ID')
      headerOfft += 4
    }
    if (flags & HEADER_FLAGS.connId) {
      const connId = data.readUInt16BE(headerOfft)
      if (connId !== this.connId) throw new Error('Bad Conn ID')
      headerOfft += 2
    }
    let seqno = iv.seqno
    if (flags & HEADER_FLAGS.seqno) {
      seqno = data.readUInt32BE(headerOfft)
      headerOfft += 4
    }
    const ivBuf = iv.toBuffer(seqno)
    const decipher = crypto.createDecipheriv('aes-128-gcm', this.aesKey, ivBuf, { authTagLength: 4 })
    decipher.setAAD(data.subarray(0, headerOfft))
    decipher.setAuthTag(data.subarray(data.length - 4))
    const plain = Buffer.concat([
      decipher.update(data.subarray(headerOfft, data.length - 4)),
      decipher.final()
    ])
    iv.seqno = seqno + 1
    return plain
  }

  protected encrypt(aad: Buffer, data: Buffer): Buffer {
    const iv = this.sendIV
    const cipher = crypto.createCipheriv('aes-128-gcm', this.aesKey, iv.toBuffer(), { authTagLength: 4 })
    cipher.setAAD(aad)
    const cb1 = cipher.update(data)
    const cb2 = cipher.final()
    const authTag = cipher.getAuthTag()
    iv.seqno += 1
    return Buffer.concat([cb1, cb2, authTag])
  }

  protected encodeHeader(opts: { hello?: boolean; forceSeq?: boolean }): Buffer {
    const iv = this.sendIV
    let flags = 0
    let headerOfft = 1
    const header = Buffer.allocUnsafe(11)
    if (opts.hello) {
      flags |= HEADER_FLAGS.relayId | HEADER_FLAGS.connId
      header.writeUInt32BE(this.relayId >>> 0, headerOfft)
      header.writeUInt16BE(iv.connId & 0xffff, headerOfft + 4)
      headerOfft += 6
    }
    if ((opts.hello && iv.seqno) || opts.forceSeq) {
      flags |= HEADER_FLAGS.seqno
      header.writeUInt32BE((iv.seqno || 0) >>> 0, headerOfft)
      headerOfft += 4
    }
    header.writeUInt8(flags, 0)
    return header.subarray(0, headerOfft)
  }

  protected makeDataPBAndBuffer(props: Record<string, unknown>): { seqno: number; buf: Buffer } {
    const seqno = this.sendSeqno++
    const payload = { ...props, seqno }
    const pb = PB_ClientToServer.fromObject(payload)
    const buf = Buffer.from(PB_ClientToServer.encode(pb).finish())
    return { seqno, buf }
  }

  abstract shutdown(reason?: string): void
}

class TCPChannel extends NetChannel {
  private sock: net.Socket | null = null
  private pendingBuf: Buffer | null = null
  private pendingSize: number | null = null

  constructor(opts: { host: string; port: number; session: RelaySession }) {
    super({
      ...opts,
      protocol: 'tcp',
      connId: tcpConnCounter++ % 0xffff
    })
  }

  async establish(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = new net.Socket()
      this.sock = sock
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error('TCP connect timeout'))
      }, 10000)

      sock.once('connect', () => {
        clearTimeout(timer)
        sock.setNoDelay(true)
        sock.setKeepAlive(true, 15000)
        resolve()
      })
      sock.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      sock.once('close', () => {
        clearTimeout(timer)
        reject(new Error('TCP closed during connect'))
      })
      sock.connect(this.port, this.host)
    })

    if (!this.sock || this.isShutdown) throw new Error('TCP channel shutdown')

    this.sock.on('data', (chunk) => this.onData(chunk))
    this.sock.on('close', () => this.shutdown('close'))
    this.sock.on('error', () => this.shutdown('error'))

    // Handshake: UDP サーバープール (udpConfigVOD) が返るのを待機
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('TCP handshake timeout'))
      }, 10000)

      const onPacket = (packet: Record<string, unknown>): void => {
        if (packet.udpConfigVOD) {
          cleanup()
          resolve()
        }
      }
      const onShutdown = (): void => {
        cleanup()
        reject(new Error('TCP shutdown during handshake'))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        this.off('inPacket', onPacket)
        this.off('shutdown', onShutdown)
      }

      this.on('inPacket', onPacket)
      this.on('shutdown', onShutdown)

      void this.sendPacket(
        {
          athleteId: this.athleteId,
          worldTime: 0,
          largestWorldAttributeTimestamp: 0
        },
        { hello: true }
      ).catch((err) => {
        cleanup()
        reject(err)
      })
    })

    this.isEstablished = true
  }

  async sendPacket(props: Record<string, unknown>, opts: { hello?: boolean } = {}): Promise<number> {
    if (!this.sock || this.isShutdown) throw new Error('TCP socket unavailable')
    const { seqno, buf: dataBuf } = this.makeDataPBAndBuffer(props)
    const headerBuf = this.encodeHeader({ hello: opts.hello })
    const prefixBuf = Buffer.from([2, opts.hello ? 0 : 1])
    const plainBuf = Buffer.concat([prefixBuf, dataBuf])
    const cipherBuf = this.encrypt(headerBuf, plainBuf)
    const sizeBuf = Buffer.allocUnsafe(2)
    sizeBuf.writeUInt16BE(headerBuf.byteLength + cipherBuf.byteLength, 0)
    const wireBuf = Buffer.concat([sizeBuf, headerBuf, cipherBuf])
    await new Promise<void>((resolve, reject) => {
      this.sock!.write(wireBuf, (err) => (err ? reject(err) : resolve()))
    })
    this.sendCount += 1
    return seqno
  }

  private onData(data: Buffer): void {
    try {
      for (let offt = 0; offt < data.byteLength; ) {
        let size: number
        if (this.pendingSize !== null) {
          size = this.pendingSize
        } else {
          if (data.byteLength - offt < 2) {
            this.pendingBuf = Buffer.from(data.subarray(offt))
            return
          }
          size = data.readUInt16BE(offt)
          offt += 2
        }

        const pendingLen = this.pendingBuf ? this.pendingBuf.byteLength : 0
        if (data.byteLength - offt + pendingLen < size) {
          const copy = Buffer.from(data.subarray(offt))
          offt += copy.byteLength
          this.pendingBuf = this.pendingBuf ? Buffer.concat([this.pendingBuf, copy]) : copy
          this.pendingSize = size
        } else {
          let completeBuf: Buffer
          if (this.pendingBuf) {
            const need = size - this.pendingBuf.byteLength
            completeBuf = Buffer.concat([this.pendingBuf, data.subarray(offt, offt + need)])
            offt += need
            this.pendingBuf = null
            this.pendingSize = null
          } else {
            completeBuf = data.subarray(offt, offt + size)
            offt += size
          }
          this.recvCount += 1
          const plainBuf = this.decrypt(completeBuf)
          const stc = PB_ServerToClient.decode(plainBuf) as unknown as Record<string, unknown>
          this.emit('inPacket', stc, this)
        }
      }
    } catch (err) {
      debugLog.warn('ZwiftRelay', `TCP decode error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  shutdown(reason = 'requested'): void {
    if (this.isShutdown) return
    this.isShutdown = true
    if (this.sock) {
      this.sock.removeAllListeners()
      this.sock.destroy()
      this.sock = null
    }
    this.emit('shutdown', { reason })
    this.removeAllListeners()
  }
}

class UDPChannel extends NetChannel {
  private sock: dgram.Socket | null = null
  readonly courseId: number

  constructor(opts: { host: string; port: number; courseId: number; session: RelaySession }) {
    super({
      ...opts,
      protocol: 'udp',
      connId: udpConnCounter++ % 0xffff
    })
    this.courseId = opts.courseId
  }

  async establish(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const sock = dgram.createSocket('udp4')
      this.sock = sock
      const timer = setTimeout(() => {
        sock.close()
        reject(new Error('UDP connect timeout'))
      }, 8000)

      sock.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      sock.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      sock.connect(this.port, this.host)
    })

    if (!this.sock || this.isShutdown) throw new Error('UDP channel shutdown')

    this.sock.on('message', (buf) => this.onData(buf))
    this.sock.on('close', () => this.shutdown('close'))
    this.sock.on('error', () => this.shutdown('error'))

    // Handshake: hello パケットを送信してサーバーからの応答と worldTime 同期を確立
    let synced = false
    const onSyncPacket = (packet: Record<string, unknown>): void => {
      const pktWt = toNumberField(packet.worldTime)
      if (pktWt > 0) {
        const localWt = worldTimer.now()
        const diff = pktWt - localWt
        if (Math.abs(diff) > 50) {
          worldTimer.setOffset(diff)
        }
        synced = true
      }
    }

    this.on('inPacket', onSyncPacket)
    try {
      for (let i = 0; i < 20 && !synced && !this.isShutdown; i++) {
        await this.sendPacket(
          {
            athleteId: this.athleteId,
            realm: REALM,
            worldTime: 0
          },
          { hello: true }
        )
        await new Promise((r) => setTimeout(r, 80))
      }
    } finally {
      this.off('inPacket', onSyncPacket)
    }

    if (!synced) {
      throw new Error('UDP handshake timeout')
    }

    this.isEstablished = true
  }

  async sendPacket(props: Record<string, unknown>, opts: { hello?: boolean } = {}): Promise<number> {
    if (!this.sock || this.isShutdown) throw new Error('UDP socket unavailable')
    const { seqno, buf: dataBuf } = this.makeDataPBAndBuffer(props)
    const prefixBuf = Buffer.from([1])
    const headerBuf = this.encodeHeader({ hello: opts.hello, forceSeq: true })
    const plainBuf = Buffer.concat([prefixBuf, dataBuf])
    const cipherBuf = this.encrypt(headerBuf, plainBuf)
    const wireBuf = Buffer.concat([headerBuf, cipherBuf])
    await new Promise<void>((resolve, reject) => {
      this.sock!.send(wireBuf, (err) => (err ? reject(err) : resolve()))
    })
    this.sendCount += 1
    return seqno
  }

  async sendPlayerState(watchingAthleteId: number, watchingState?: ZwiftPlayerState | null): Promise<void> {
    const worldTime = Math.round(worldTimer.now())
    await this.sendPacket({
      athleteId: this.athleteId,
      realm: REALM,
      worldTime,
      state: {
        athleteId: this.athleteId,
        worldTime,
        justWatching: true,
        watchingAthleteId,
        courseId: this.courseId,
        x: watchingState?.x ?? 0,
        y: watchingState?.y ?? 0,
        z: watchingState?.z ?? 0,
        eventSubgroupId: watchingState?.groupId ?? 0
      }
    })
  }

  private onData(buf: Buffer): void {
    try {
      this.recvCount += 1
      const plain = this.decrypt(buf)
      const stc = PB_ServerToClient.decode(plain) as unknown as Record<string, unknown>
      this.emit('inPacket', stc, this)
    } catch (err) {
      debugLog.debug('ZwiftRelay', `UDP decode warning: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  shutdown(reason = 'requested'): void {
    if (this.isShutdown) return
    this.isShutdown = true
    if (this.sock) {
      this.sock.removeAllListeners()
      try {
        this.sock.close()
      } catch {
        // ignore
      }
      this.sock = null
    }
    this.emit('shutdown', { reason })
    this.removeAllListeners()
  }
}

export interface AthleteProfileLite {
  id: number
  firstName: string
  lastName: string
  initials: string
}

export function makeAthleteInitials(firstName: string, lastName: string, fallbackId: number): string {
  const f = (firstName || '').trim()
  const l = (lastName || '').trim()
  const fChar = f.replace(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '').slice(0, 1)
  const lChar = l.replace(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '').slice(0, 1)
  const init = (fChar + lChar).toUpperCase()
  return init.length > 0 ? init : String(fallbackId).slice(-2)
}

/**
 * `/api/profiles?id=...&id=...` から複数ライダーのプロフィール（イニシャル・名前）を一括取得する。
 */
export async function fetchAthleteProfilesBatch(
  accessToken: string,
  ids: number[]
): Promise<AthleteProfileLite[]> {
  if (ids.length === 0) return []
  const query = new URLSearchParams(ids.slice(0, 40).map((id): [string, string] => ['id', String(id)]))
  const res = await fetch(`${RELAY_BASE}/api/profiles?${query.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/x-protobuf-lite',
      Platform: 'OSX',
      Source: 'Game Client',
      'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
    },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) return []
  const buf = Buffer.from(await res.arrayBuffer())
  const decoded = PB_PlayerProfiles.decode(buf) as unknown as {
    profiles?: Record<string, unknown>[]
  }
  const list = decoded.profiles ?? []
  return list.map((p) => {
    const id = toNumberField(p.id)
    const firstName = typeof p.firstName === 'string' ? p.firstName : ''
    const lastName = typeof p.lastName === 'string' ? p.lastName : ''
    return {
      id,
      firstName,
      lastName,
      initials: makeAthleteInitials(firstName, lastName, id)
    }
  })
}

/**
 * Sauce for Zwift の GameMonitor と同一のプロトコルで Zwift Relay TCP/UDP ストリームを確立し、
 * 監視対象ライダーおよび周囲の全 Zwifter のリアルタイム PlayerState を受信するクラス。
 */
export class ZwiftGameMonitor extends EventEmitter {
  private monitorAthleteId = 0
  private watchingAthleteId: number
  private courseId = 6
  private session: RelaySession | null = null
  private tcpChannel: TCPChannel | null = null
  private udpChannel: UDPChannel | null = null
  private readonly udpPools = new Map<string, NormalizedUDPPool>()
  private broadcastTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false
  private connecting = false
  private lastWatchingState: ZwiftPlayerState | null = null

  constructor(
    private readonly getAccessToken: () => string | null,
    targetPlayerId: number
  ) {
    super()
    this.watchingAthleteId = targetPlayerId
  }

  updateWatchingState(state: ZwiftPlayerState): void {
    const prevCourse = this.courseId
    this.lastWatchingState = state
    if (state.courseId && state.courseId !== prevCourse) {
      this.courseId = state.courseId
      if (this.session && this.udpPools.size > 0) {
        void this.ensureUDPChannel()
      }
    } else if (this.session && !this.udpChannel && this.udpPools.size > 0) {
      void this.ensureUDPChannel()
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.disconnect()
  }

  private disconnect(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer)
    this.broadcastTimer = null
    if (this.udpChannel) {
      this.udpChannel.shutdown('disconnect')
      this.udpChannel = null
    }
    if (this.tcpChannel) {
      this.tcpChannel.shutdown('disconnect')
      this.tcpChannel = null
    }
    this.session = null
  }

  private scheduleReconnect(delayMs = 5000): void {
    if (this.stopped || this.reconnectTimer) return
    this.disconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) {
        void this.connect()
      }
    }, delayMs)
  }

  private async fetchMonitorProfileId(token: string): Promise<number> {
    if (this.monitorAthleteId > 0) return this.monitorAthleteId
    const res = await fetch(`${RELAY_BASE}/api/profiles/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Platform: 'OSX',
        Source: 'Game Client',
        'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
      },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      throw new Error(`/api/profiles/me failed (${res.status})`)
    }
    const data = (await res.json()) as { id?: number }
    if (!data.id) throw new Error('Monitor profile id missing')
    this.monitorAthleteId = data.id
    return data.id
  }

  private async loginRelaySession(token: string, monitorAthleteId: number): Promise<RelaySession> {
    const aesKey = crypto.randomBytes(16)
    const reqBuf = Buffer.from(PB_LoginRequest.encode(PB_LoginRequest.fromObject({ aesKey })).finish())
    const t1 = worldTimer.serverNow()
    const res = await fetch(`${RELAY_BASE}/api/users/login`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-protobuf-lite; version=2.0',
        Accept: 'application/x-protobuf-lite',
        Platform: 'OSX',
        Source: 'Game Client',
        'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
      },
      body: reqBuf,
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) {
      throw new Error(`/api/users/login failed (${res.status})`)
    }
    const t2 = worldTimer.serverNow()
    const buf = Buffer.from(await res.arrayBuffer())
    const login = PB_LoginResponse.decode(buf) as unknown as {
      relaySessionId: number
      expiration: number
      session?: {
        time?: unknown
        tcpConfig?: { servers?: { host?: string; securePort?: number; realm?: number; courseId?: number }[] }
      }
    }

    const serverTimeSec = toNumberField(login.session?.time)
    if (serverTimeSec > 0) {
      const serverTimeMs = serverTimeSec * 1000
      const tMean = t1 + (t2 - t1) / 2
      const tOffset = serverTimeMs - tMean
      if (Math.abs(tOffset) > 60000) {
        worldTimer.setOffset(tOffset)
      }
    }

    const rawServers = login.session?.tcpConfig?.servers ?? []
    const tcpServers = rawServers
      .filter((s) => (!s.realm || s.realm === REALM) && !s.courseId && s.host)
      .map((s) => ({ host: s.host!, securePort: s.securePort || 3025 }))

    return {
      aesKey,
      relayId: login.relaySessionId,
      athleteId: monitorAthleteId,
      tcpServers,
      expires: Date.now() + (login.expiration || 60) * 60 * 1000
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return
    const token = this.getAccessToken()
    if (!token) {
      this.scheduleReconnect(2000)
      return
    }

    this.connecting = true
    try {
      const monitorId = await this.fetchMonitorProfileId(token)
      const session = await this.loginRelaySession(token, monitorId)
      if (session.tcpServers.length === 0) {
        throw new Error('No Zwift TCP relay servers returned')
      }

      const server = session.tcpServers[0]
      debugLog.info(
        'ZwiftRelay',
        `Connecting TCP relay to ${server.host}:${server.securePort} (relayId=${session.relayId}, monitorId=${monitorId})`
      )

      let establishedCh: TCPChannel | null = null
      for (let attempt = 1; attempt <= 4 && !this.stopped; attempt++) {
        await new Promise((r) => setTimeout(r, 120 * attempt))
        const ch = new TCPChannel({
          host: server.host,
          port: server.securePort,
          session
        })
        ch.on('inPacket', (pkt: Record<string, unknown>) => this.onInPacket(pkt))
        try {
          await ch.establish()
          establishedCh = ch
          break
        } catch (err) {
          ch.shutdown('handshake-retry')
          if (attempt === 4) throw err
        }
      }

      if (!establishedCh || this.stopped) return
      this.session = session
      this.tcpChannel = establishedCh
      establishedCh.on('shutdown', ({ reason }: { reason: string }) => {
        debugLog.warn('ZwiftRelay', `TCP relay shutdown (${reason}), scheduling reconnect`)
        if (!this.stopped) this.scheduleReconnect(4000)
      })

      debugLog.info('ZwiftRelay', `TCP relay session established (${server.host}:${server.securePort})`)

      if (this.udpPools.size > 0) {
        await this.ensureUDPChannel()
      }

      this.broadcastTimer = setInterval(() => {
        void this.broadcastWatchingState()
      }, 1000)
    } catch (err) {
      debugLog.warn(
        'ZwiftRelay',
        `GameMonitor connect warning: ${err instanceof Error ? err.message : String(err)}`
      )
      this.scheduleReconnect(5000)
    } finally {
      this.connecting = false
    }
  }

  private onInPacket(pb: Record<string, unknown>): void {
    if (pb.udpConfigVOD) {
      this.updateUDPConfig(pb.udpConfigVOD as Record<string, unknown>)
      void this.ensureUDPChannel()
    }

    const rawStates = Array.isArray(pb.playerStates) ? (pb.playerStates as Record<string, unknown>[]) : []
    if (rawStates.length > 0) {
      const states: ZwiftPlayerState[] = []
      for (const rs of rawStates) {
        const s = convertPBPlayerState(rs)
        if (s && s.id !== this.monitorAthleteId) {
          states.push(s)
          if (s.id === this.watchingAthleteId) {
            this.lastWatchingState = s
            if (s.courseId) this.courseId = s.courseId
          }
        }
      }
      if (states.length > 0) {
        this.emit('playerStates', states)
      }
    }
  }

  private updateUDPConfig(config: Record<string, unknown>): void {
    const pools = Array.isArray(config.pools) ? (config.pools as Record<string, unknown>[]) : []
    if (pools.length === 0) return
    this.udpPools.clear()
    for (const p of pools) {
      const realm = toNumberField(p.realm)
      const courseId = toNumberField(p.courseId)
      const useFirstInBounds = Boolean(p.useFirstInBounds)
      const rawServers = Array.isArray(p.servers) ? (p.servers as Record<string, unknown>[]) : []
      const servers: NormalizedUDPServer[] = rawServers
        .filter((s) => typeof s.host === 'string' && s.host.length > 0)
        .map((s) => ({
          host: s.host as string,
          securePort: toNumberField(s.securePort) || 3024,
          xBound: typeof s.xBound === 'number' ? s.xBound : 0,
          yBound: typeof s.yBound === 'number' ? s.yBound : 0,
          isDirect: realm === REALM && courseId > 0
        }))
      if (servers.length > 0) {
        this.udpPools.set(`${realm}-${courseId}`, {
          realm,
          courseId,
          useFirstInBounds,
          servers
        })
      }
    }
    debugLog.info('ZwiftRelay', `Received ${this.udpPools.size} UDP server pools from TCP relay`)
  }

  private findBestUDPServer(): NormalizedUDPServer | null {
    const courseId = this.lastWatchingState?.courseId || this.courseId || 6
    const xCoord = this.lastWatchingState?.x ?? 0
    const yCoord = this.lastWatchingState?.y ?? 0
    const pool = this.udpPools.get(`${REALM}-${courseId}`) ?? this.udpPools.get('0-0')
    if (!pool || pool.servers.length === 0) return null

    if (pool.useFirstInBounds) {
      for (const s of pool.servers) {
        if (xCoord <= s.xBound && yCoord <= s.yBound) {
          return s
        }
      }
      return pool.servers[pool.servers.length - 1]
    }
    if (pool.servers.length === 1) return pool.servers[0]

    let closest = pool.servers[0]
    let closestDelta = Infinity
    for (const s of pool.servers) {
      const dx = s.xBound - xCoord
      const dy = s.yBound - yCoord
      const delta = dx * dx + dy * dy
      if (!Number.isNaN(delta) && delta < closestDelta) {
        closestDelta = delta
        closest = s
      }
    }
    return closest
  }

  private async ensureUDPChannel(): Promise<void> {
    if (this.stopped || !this.session) return
    const best = this.findBestUDPServer()
    if (!best) return

    const courseId = this.lastWatchingState?.courseId || this.courseId || 6
    if (
      this.udpChannel &&
      !this.udpChannel.isShutdown &&
      this.udpChannel.host === best.host &&
      this.udpChannel.port === best.securePort &&
      this.udpChannel.courseId === courseId
    ) {
      return
    }

    const old = this.udpChannel
    const ch = new UDPChannel({
      host: best.host,
      port: best.securePort,
      courseId,
      session: this.session
    })
    this.udpChannel = ch
    if (old) old.shutdown('switch-server')

    ch.on('inPacket', (pkt: Record<string, unknown>) => this.onInPacket(pkt))
    ch.on('shutdown', ({ reason }: { reason: string }) => {
      if (this.udpChannel === ch && !this.stopped) {
        this.udpChannel = null
        debugLog.debug('ZwiftRelay', `UDP channel closed (${reason}), will re-establish`)
        setTimeout(() => {
          if (!this.stopped) void this.ensureUDPChannel()
        }, 2000)
      }
    })

    try {
      debugLog.info('ZwiftRelay', `Connecting UDP relay to ${best.host}:${best.securePort} (courseId=${courseId})`)
      await ch.establish()
      await ch.sendPlayerState(this.watchingAthleteId, this.lastWatchingState)
      debugLog.info('ZwiftRelay', `UDP relay established (${best.host}:${best.securePort}, courseId=${courseId})`)
    } catch (err) {
      debugLog.warn(
        'ZwiftRelay',
        `UDP relay establish failed (${best.host}:${best.securePort}): ${err instanceof Error ? err.message : String(err)}`
      )
      ch.shutdown('establish-error')
    }
  }

  private async broadcastWatchingState(): Promise<void> {
    if (this.stopped || !this.udpChannel || !this.udpChannel.isEstablished || this.udpChannel.isShutdown) {
      if (!this.stopped && this.session && !this.udpChannel && this.udpPools.size > 0) {
        void this.ensureUDPChannel()
      }
      return
    }
    try {
      await this.udpChannel.sendPlayerState(this.watchingAthleteId, this.lastWatchingState)
    } catch (err) {
      debugLog.debug('ZwiftRelay', `UDP sendPlayerState error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
