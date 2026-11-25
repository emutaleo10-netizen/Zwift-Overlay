/** ソースが提供しうるメトリクスの種類 */
export type MetricKey = 'power' | 'heartRate' | 'cadence' | 'speed' | 'distance' | 'world'

/** ワールド内のグループ/ライダーノード（Groups ウィジェット用） */
export interface GroupNode {
  id: string
  /** 1人ならイニシャル（"HD"等）、集団なら人数文字列や代表ラベル */
  label: string
  /** 集団の人数（1なら単独ライダー） */
  size: number
  /** 自分が含まれるノードか */
  isSelf: boolean
  /** 直前のノードとの時間差（秒）。先頭ノードは 0 */
  gapFromPrevSec: number
  /** 自分基準の相対時間差（秒）。前方は負（-19s）、後方は正（+16s） */
  gapFromSelfSec: number
  /** W */
  power: number
  /** km/h */
  speedKph: number
}

export interface GroupsSummary {
  totalAthletes: number
  aheadCount: number
  behindCount: number
  nodes: GroupNode[]
}

/** マップ上のライダーマーカー座標（0〜1000 の正規化ワールド座標 + 実ワールド座標） */
export interface MapEntity {
  id: string
  label: string
  x: number
  y: number
  isSelf: boolean
  /** Zwift ワールド生座標 (cm) */
  rawX?: number
  rawY?: number
  power?: number
}

export interface TrailPoint {
  x: number
  y: number
  altitudeM: number
  /** 記録時刻（epoch ms） */
  ts?: number
  /** Zwift ワールド生座標 (cm) */
  rawX?: number
  rawY?: number
}

export interface WorldState {
  /** コース進行度 0〜1（周回） */
  routeProgress: number
  /** 自車の正規化ワールド座標 (0〜1000) */
  x: number
  y: number
  /** Zwift ワールド生座標 (cm) */
  rawX?: number
  rawY?: number
  /** Zwift courseId (例: 6 = Watopia, 17 = Scotland) */
  courseId?: number
  /** 現在走行中の Zwift routeId */
  routeId?: number
  /** 現在の累積走行距離 (m) */
  distanceM?: number
  /** 進行方向（ラジアン） */
  headingRad: number
  /** 標高 (m) */
  altitudeM: number
  /** 勾配 (%) 例: 4.5, -2.1 */
  gradePct: number
  /** 周囲のライダー座標 */
  entities: MapEntity[]
  /** グループギャップ情報 */
  groups: GroupsSummary
  /** 実走行座標の軌跡（設定されていれば実測GPS/3Dマップモードで描画） */
  trail?: TrailPoint[]
  /** ワールド名やルート名 */
  worldName?: string
}

/**
 * データソースが送る生サンプル。
 * 取得できない値は undefined のままにする（0 と「不明」を区別するため）。
 */
export interface RawSample {
  /** 計測時刻（epoch ms） */
  timestamp: number
  /** W */
  power?: number
  /** bpm */
  heartRate?: number
  /** rpm */
  cadence?: number
  /** m/s */
  speed?: number
  /** m（累積） */
  distance?: number
  /** ワールド座標・集団・勾配情報 */
  world?: WorldState
}

export type SourceStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'error'; message: string }
  | { state: 'stopped' }

export interface ZoneInfo {
  /** 1 始まり */
  index: number
  name: string
  color: string
  /** power / FTP */
  ratio: number
}

export interface LapState {
  /** 1 始まり */
  index: number
  elapsedMs: number
  avgPower: number | null
  avgHeartRate: number | null
  avgCadence: number | null
}

export interface WBalState {
  /** 現在の W'bal 残量 (J) */
  joules: number
  /** アスリートの W' 容量 (J) */
  capacityJ: number
  /** 残量パーセンテージ (0〜100) */
  pct: number
}

/** UI が受け取る唯一のデータ形式 */
export interface MetricsSnapshot {
  timestamp: number
  power: number | null
  power3s: number | null
  power5s: number | null
  power1m: number | null
  power5m: number | null
  power20m: number | null
  normalizedPower: number | null
  wkg: number | null
  heartRate: number | null
  cadence: number | null
  speed: number | null
  zone: ZoneInfo | null
  wBal: WBalState | null
  rideElapsedMs: number
  currentLap: LapState
  previousLap: LapState | null
  world: WorldState | null
  source: { id: string; name: string; status: SourceStatus }
}
