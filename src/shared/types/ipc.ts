import type { MetricsSnapshot } from './metrics'
import type { AppSettings, OverlayMode, SettingsPatch, ShortcutAction } from './settings'

export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  settingsOpen: 'settings:open',
  layoutReset: 'layout:reset',
  modeGet: 'mode:get',
  modeSet: 'mode:set',
  modeToggle: 'mode:toggle',
  modeChanged: 'mode:changed',
  overlaySetInteractive: 'overlay:set-interactive',
  metricsUpdate: 'metrics:update',
  metricsLatest: 'metrics:latest',
  lapMark: 'lap:mark',
  rideReset: 'ride:reset',
  shortcutsStatus: 'shortcuts:status',
  shortcutsStatusChanged: 'shortcuts:status-changed',
  shortcutsSuspend: 'shortcuts:suspend',
  displaysList: 'displays:list',
  udpSendTest: 'udp:send-test',
  zwiftDetectEnv: 'zwift:detect-env',
  debugLogGet: 'debug:get',
  debugLogClear: 'debug:clear',
  debugLogOpenFile: 'debug:open-file',
  debugLogEntry: 'debug:entry'
} as const

export interface DebugLogInfo {
  filePath: string
  entries: { timestamp: string; level: string; tag: string; message: string }[]
}

export interface DetectedZwiftEnv {
  zwiftDir: string
  playerId: number | null
  worldId: number
  routeName?: string
}

export interface ShortcutEntryStatus {
  accelerator: string
  registered: boolean
  error?: string
}

export type ShortcutStatus = Record<ShortcutAction, ShortcutEntryStatus>

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

export type Unsubscribe = () => void

/** preload が window.overlayApi として公開する型付き API */
export interface OverlayApi {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  onSettingsChanged(cb: (s: AppSettings) => void): Unsubscribe
  openSettings(): Promise<void>
  resetLayout(): Promise<void>

  getMode(): Promise<OverlayMode>
  setMode(mode: OverlayMode): Promise<void>
  toggleMode(): Promise<void>
  onModeChanged(cb: (m: OverlayMode) => void): Unsubscribe
  setOverlayInteractive(interactive: boolean): Promise<void>

  getLatestMetrics(): Promise<MetricsSnapshot>
  onMetrics(cb: (m: MetricsSnapshot) => void): Unsubscribe
  markLap(): Promise<void>
  resetRide(): Promise<void>

  getShortcutStatus(): Promise<ShortcutStatus>
  onShortcutStatusChanged(cb: (s: ShortcutStatus) => void): Unsubscribe
  setShortcutsSuspended(suspended: boolean): Promise<void>

  listDisplays(): Promise<DisplayInfo[]>
  sendTestUdpPacket(): Promise<void>
  detectZwiftEnv(): Promise<DetectedZwiftEnv>

  getDebugLogs(): Promise<DebugLogInfo>
  clearDebugLogs(): Promise<void>
  openDebugLogFile(): Promise<void>
  onDebugLogEntry(cb: (entry: { timestamp: string; level: string; tag: string; message: string }) => void): Unsubscribe
}
