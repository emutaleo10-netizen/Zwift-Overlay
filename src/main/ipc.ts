import dgram from 'node:dgram'
import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { IPC, type DebugLogInfo, type DetectedZwiftEnv, type DisplayInfo } from '@shared/types/ipc'
import type { OverlayMode, SettingsPatch } from '@shared/types/settings'
import type { DataHub } from './data/DataHub'
import { detectPlayerAndWorldFromLog } from './data/sources/zwiftApi/ZwiftApiDataSource'
import { detectZwiftDataDir } from './data/sources/zwiftLog/ZwiftLogDataSource'
import { parseZwiftUdpOptions } from './data/sources/zwiftUdp/ZwiftUdpDataSource'
import { debugLog } from './debugLogger'
import type { ModeController } from './modeController'
import type { SettingsStore } from './settingsStore'
import type { ShortcutManager } from './shortcuts'

export interface IpcDeps {
  settings: SettingsStore
  hub: DataHub
  mode: ModeController
  shortcuts: ShortcutManager
  openSettings: () => void
  resetLayout: () => void
  updateSettings: (patch: SettingsPatch) => void
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(IPC.settingsGet, () => d.settings.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => {
    d.updateSettings(patch)
    return d.settings.get()
  })
  ipcMain.handle(IPC.settingsOpen, () => d.openSettings())
  ipcMain.handle(IPC.layoutReset, () => d.resetLayout())

  ipcMain.handle(IPC.modeGet, () => d.mode.get())
  ipcMain.handle(IPC.modeSet, (_e, m: OverlayMode) => {
    if (m === 'locked' || m === 'edit') d.mode.set(m)
  })
  ipcMain.handle(IPC.modeToggle, () => d.mode.toggle())
  ipcMain.handle(IPC.overlaySetInteractive, (_e, interactive: boolean) => {
    d.mode.setHoverInteractive(Boolean(interactive))
  })

  ipcMain.handle(IPC.metricsLatest, () => d.hub.latest())
  ipcMain.handle(IPC.lapMark, () => d.hub.markLap())
  ipcMain.handle(IPC.rideReset, () => d.hub.resetRide())

  ipcMain.handle(IPC.shortcutsStatus, () => d.shortcuts.getStatus())
  ipcMain.handle(IPC.shortcutsSuspend, (_e, suspended: boolean) => d.shortcuts.setSuspended(!!suspended))

  ipcMain.handle(IPC.displaysList, (): DisplayInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((disp, i) => ({
      id: disp.id,
      label: disp.label || `ディスプレイ ${i + 1}`,
      width: disp.bounds.width,
      height: disp.bounds.height,
      primary: disp.id === primaryId
    }))
  })

  ipcMain.handle(IPC.udpSendTest, async () => {
    const opts = parseZwiftUdpOptions(d.settings.get().dataSource.options)
    const payload = JSON.stringify({
      timestamp: Date.now(),
      state: {
        watts: 245 + Math.round((Math.random() - 0.5) * 40),
        heartrate: 154 + Math.round((Math.random() - 0.5) * 8),
        cadence: 90 + Math.round((Math.random() - 0.5) * 6),
        speedKph: 36.8,
        altitude: 84,
        grade: 2.4
      },
      nearby: [
        { id: 'n1', label: 'HD', size: 1, gap: -64, watts: 190, kph: 34 },
        { id: 'n2', label: 'KP', size: 1, gap: -49, watts: 215, kph: 36 },
        { id: 'n3', label: 'WH', size: 1, gap: -19, watts: 205, kph: 35 },
        { id: 'n4', label: 'MS', size: 1, gap: -3, watts: 198, kph: 35 },
        { id: 'self', label: '5', size: 5, isSelf: true, gap: 0, watts: 245, kph: 37 },
        { id: 'n5', label: 'JP', size: 1, gap: 16, watts: 210, kph: 35 },
        { id: 'n6', label: 'MS', size: 1, gap: 61, watts: 230, kph: 38 }
      ],
      groups: { aheadCount: 15, behindCount: 16 }
    })
    await new Promise<void>((resolve, reject) => {
      const client = dgram.createSocket('udp4')
      client.send(Buffer.from(payload, 'utf8'), opts.port, opts.host, (err) => {
        client.close()
        if (err) reject(err)
        else resolve()
      })
    })
  })

  ipcMain.handle(IPC.zwiftDetectEnv, (): DetectedZwiftEnv => {
    const zwiftDir = detectZwiftDataDir()
    const { playerId, worldId, routeName } = detectPlayerAndWorldFromLog()
    return { zwiftDir, playerId, worldId, routeName }
  })

  ipcMain.handle(IPC.debugLogGet, (): DebugLogInfo => ({
    filePath: debugLog.filePath,
    entries: debugLog.getRecent()
  }))

  ipcMain.handle(IPC.debugLogClear, () => {
    debugLog.clear()
  })

  ipcMain.handle(IPC.debugLogOpenFile, () => {
    shell.showItemInFolder(debugLog.filePath)
  })

  debugLog.onEntry((entry) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC.debugLogEntry, entry)
    }
  })
}
