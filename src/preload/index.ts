import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type OverlayApi } from '@shared/types/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: OverlayApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  onSettingsChanged: (cb) => subscribe(IPC.settingsChanged, cb),
  openSettings: () => ipcRenderer.invoke(IPC.settingsOpen),
  resetLayout: () => ipcRenderer.invoke(IPC.layoutReset),

  getMode: () => ipcRenderer.invoke(IPC.modeGet),
  setMode: (mode) => ipcRenderer.invoke(IPC.modeSet, mode),
  toggleMode: () => ipcRenderer.invoke(IPC.modeToggle),
  onModeChanged: (cb) => subscribe(IPC.modeChanged, cb),
  setOverlayInteractive: (interactive) => ipcRenderer.invoke(IPC.overlaySetInteractive, interactive),

  getLatestMetrics: () => ipcRenderer.invoke(IPC.metricsLatest),
  onMetrics: (cb) => subscribe(IPC.metricsUpdate, cb),
  markLap: () => ipcRenderer.invoke(IPC.lapMark),
  resetRide: () => ipcRenderer.invoke(IPC.rideReset),

  getShortcutStatus: () => ipcRenderer.invoke(IPC.shortcutsStatus),
  onShortcutStatusChanged: (cb) => subscribe(IPC.shortcutsStatusChanged, cb),
  setShortcutsSuspended: (suspended) => ipcRenderer.invoke(IPC.shortcutsSuspend, suspended),

  listDisplays: () => ipcRenderer.invoke(IPC.displaysList),
  sendTestUdpPacket: () => ipcRenderer.invoke(IPC.udpSendTest),
  detectZwiftEnv: () => ipcRenderer.invoke(IPC.zwiftDetectEnv),

  getDebugLogs: () => ipcRenderer.invoke(IPC.debugLogGet),
  clearDebugLogs: () => ipcRenderer.invoke(IPC.debugLogClear),
  openDebugLogFile: () => ipcRenderer.invoke(IPC.debugLogOpenFile),
  onDebugLogEntry: (cb) => subscribe(IPC.debugLogEntry, cb)
}

contextBridge.exposeInMainWorld('overlayApi', api)
