import type { AppSettings, WidgetConfig, WidgetType } from './types/settings'

export const WIDGET_LABELS: Record<WidgetType, string> = {
  power: 'パワー',
  power3s: '3秒平均パワー',
  power5s: '5秒ベストパワー (5s Best)',
  power1m: '1分ベストパワー (1m Best)',
  power5m: '5分ベストパワー (5m Best)',
  power20m: '20分ベストパワー (20m Best)',
  normalizedPower: 'Normalized Power (NP)',
  wkg: 'W/kg',
  heartRate: '心拍数',
  cadence: 'ケイデンス',
  powerZone: 'パワーゾーン',
  lap: 'ラップ / インターバル',
  groups: 'グループギャップ (Mind the Gap)',
  map: 'インタラクティブマップ',
  wbal: "W'bal タコメーター"
}

export const WIDGET_TYPES: readonly WidgetType[] = [
  'power',
  'power3s',
  'power5s',
  'power1m',
  'power5m',
  'power20m',
  'normalizedPower',
  'wkg',
  'heartRate',
  'cadence',
  'powerZone',
  'lap',
  'groups',
  'map',
  'wbal'
]

/** 既定レイアウトの基準解像度 */
export const DEFAULT_LAYOUT_BASE = { width: 1920, height: 1080 } as const

const LEFT_X = 0
const LEFT_W = 180
const OPT_X = 1180
const OPT_W = 220

export const DEFAULT_WIDGETS: readonly WidgetConfig[] = [
  // Zwift デフォルト表示で事足りる基本項目は初期状態 OFF（オプション扱い・Zwift UI を妨げない位置へ配置）
  { id: 'power', type: 'power', visible: false, x: OPT_X, y: 120, width: OPT_W, height: 90, bgOpacity: 0.55, fontScale: 1 },
  { id: 'power3s', type: 'power3s', visible: false, x: OPT_X, y: 220, width: OPT_W, height: 90, bgOpacity: 0.55, fontScale: 1 },
  // 添付レイアウト準拠のデフォルト ON 項目（左列: Best Effort / NP / W'bal、その右隣: Mind the Gap、右上: マップ）
  { id: 'power5s', type: 'power5s', visible: true, x: LEFT_X, y: 255, width: LEFT_W, height: 72, bgOpacity: 0.3, fontScale: 1 },
  { id: 'power1m', type: 'power1m', visible: true, x: LEFT_X, y: 334, width: LEFT_W, height: 72, bgOpacity: 0.3, fontScale: 1 },
  { id: 'power5m', type: 'power5m', visible: true, x: LEFT_X, y: 413, width: LEFT_W, height: 72, bgOpacity: 0.3, fontScale: 1 },
  { id: 'power20m', type: 'power20m', visible: true, x: LEFT_X, y: 492, width: LEFT_W, height: 72, bgOpacity: 0.3, fontScale: 1 },
  { id: 'normalizedPower', type: 'normalizedPower', visible: true, x: LEFT_X, y: 571, width: LEFT_W, height: 72, bgOpacity: 0.3, fontScale: 1 },
  { id: 'wkg', type: 'wkg', visible: false, x: OPT_X, y: 320, width: OPT_W, height: 90, bgOpacity: 0.55, fontScale: 1 },
  { id: 'heartRate', type: 'heartRate', visible: false, x: OPT_X, y: 420, width: OPT_W, height: 90, bgOpacity: 0.55, fontScale: 1 },
  { id: 'cadence', type: 'cadence', visible: false, x: OPT_X, y: 520, width: OPT_W, height: 90, bgOpacity: 0.55, fontScale: 1 },
  { id: 'powerZone', type: 'powerZone', visible: false, x: OPT_X, y: 620, width: OPT_W + 20, height: 80, bgOpacity: 0.55, fontScale: 1 },
  { id: 'lap', type: 'lap', visible: false, x: OPT_X, y: 710, width: OPT_W + 20, height: 135, bgOpacity: 0.55, fontScale: 1 },
  { id: 'groups', type: 'groups', visible: true, x: 282, y: 334, width: 220, height: 560, bgOpacity: 0.65, fontScale: 1 },
  { id: 'map', type: 'map', visible: true, x: 1440, y: 27, width: 468, height: 296, bgOpacity: 0.85, fontScale: 1 },
  { id: 'wbal', type: 'wbal', visible: true, x: LEFT_X, y: 675, width: 249, height: 212, bgOpacity: 0.45, fontScale: 1 }
]

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  athlete: { ftp: 200, weightKg: 60, wPrime: 20000 },
  dataSource: { id: 'zwift-api', options: { username: '', password: '', playerId: 0, pollMs: 1500 } },
  overlay: {
    displayId: null,
    gridSize: 10,
    layoutBase: { ...DEFAULT_LAYOUT_BASE },
    launchBehavior: 'ask',
    mapTrailMode: 'full',
    autoCloseWithZwift: true,
    quitOnSettingsClose: false,
    runAtLogin: true
  },
  shortcuts: {
    toggleMode: 'Ctrl+Alt+E',
    markLap: 'Ctrl+Alt+L',
    openSettings: 'Ctrl+Alt+S'
  },
  widgets: DEFAULT_WIDGETS.map((w) => ({ ...w }))
}

export const LIMITS = {
  ftp: [50, 700],
  weightKg: [30, 200],
  wPrime: [5000, 50000],
  bgOpacity: [0, 1],
  fontScale: [0.5, 3],
  gridSize: [1, 100],
  widgetMinWidth: 80,
  widgetMinHeight: 50
} as const
