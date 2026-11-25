export type WidgetType =
  | 'power'
  | 'power3s'
  | 'power5s'
  | 'power1m'
  | 'power5m'
  | 'power20m'
  | 'normalizedPower'
  | 'wkg'
  | 'heartRate'
  | 'cadence'
  | 'powerZone'
  | 'lap'
  | 'groups'
  | 'map'
  | 'wbal'

export interface WidgetConfig {
  id: string
  type: WidgetType
  visible: boolean
  /** ディスプレイ左上基準の DIP 座標 */
  x: number
  y: number
  width: number
  height: number
  /** 背景の不透明度 0〜1 */
  bgOpacity: number
  /** フォント倍率 0.5〜3 */
  fontScale: number
}

export interface AthleteSettings {
  ftp: number
  weightKg: number
  /** W' (無酸素仕事容量, J) 既定 20000 J (20 kJ) */
  wPrime?: number
}

export interface ShortcutSettings {
  toggleMode: string
  markLap: string
  openSettings: string
}

export type ShortcutAction = keyof ShortcutSettings

export interface DataSourceSettings {
  id: string
  options: Record<string, unknown>
}

export type ZwiftLaunchBehavior = 'ask' | 'auto' | 'always'
export type MapTrailMode = 'full' | '5m' | '3m' | 'off'

export interface OverlaySettings {
  /** null の場合はプライマリディスプレイ */
  displayId: number | null
  gridSize: number
  /** ウィジェット座標を保存したときのディスプレイサイズ（解像度変更時の補正用） */
  layoutBase: { width: number; height: number }
  /** Zwift 起動検出時の動作: 'ask'=確認ダイアログ, 'auto'=自動表示, 'always'=常時表示 */
  launchBehavior?: ZwiftLaunchBehavior
  /** マップの走行軌跡表示モード: 'full'=ライド全体, '5m'=直近5分, '3m'=直近3分, 'off'=非表示 */
  mapTrailMode?: MapTrailMode
  /** Zwift アプリ (ZwiftApp.exe) 終了時にオーバーレイも自動的にオフにするか */
  autoCloseWithZwift?: boolean
  /** 設定ウィンドウを閉じたときにアプリ（Electron）自体も終了するか */
  quitOnSettingsClose?: boolean
  /** Windows ログオン時にバックグラウンド常駐を開始するか */
  runAtLogin?: boolean
}

export interface AppSettings {
  schemaVersion: 1
  athlete: AthleteSettings
  dataSource: DataSourceSettings
  overlay: OverlaySettings
  shortcuts: ShortcutSettings
  widgets: WidgetConfig[]
}

export interface SettingsPatch {
  athlete?: Partial<AthleteSettings>
  dataSource?: DataSourceSettings
  overlay?: Partial<OverlaySettings>
  shortcuts?: Partial<ShortcutSettings>
  widgets?: WidgetConfig[]
}

export type OverlayMode = 'locked' | 'edit'
