import { app, BrowserWindow, screen } from 'electron'
import { DEFAULT_LAYOUT_BASE, DEFAULT_WIDGETS } from '@shared/defaults'
import { rescaleWidgets } from '@shared/settingsUtils'
import { IPC } from '@shared/types/ipc'
import type { AppSettings, SettingsPatch } from '@shared/types/settings'
import { DataHub } from './data/DataHub'
import { MetricsEngine } from './data/MetricsEngine'
import { createDataSource } from './data/registry'
import { registerIpc } from './ipc'
import { ModeController } from './modeController'
import { SettingsStore } from './settingsStore'
import { ShortcutManager } from './shortcuts'
import { AppTray, createAppIcon } from './tray'
import { createOverlayWindow, fitOverlayToDisplay, resolveDisplay } from './windows/overlayWindow'
import { createSettingsWindow } from './windows/settingsWindow'
import { syncWindowsShortcuts, ZwiftProcessWatcher } from './zwiftWatcher'

let overlayWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let quitting = false
let closingSettingsForZwift = false
let overlayVisible = true

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(main).catch((err) => {
    console.error('[main] failed to start', err)
    app.quit()
  })
}

async function main(): Promise<void> {
  app.setAppUserModelId('com.zwiftoverlay.app')
  const icon = createAppIcon()

  const settings = new SettingsStore()
  const engine = new MetricsEngine(() => settings.get().athlete)
  const hub = new DataHub(engine)

  const mode = new ModeController(
    () => overlayWin,
    (m) => {
      broadcast(IPC.modeChanged, m)
      tray.refresh(m)
    }
  )

  const openSettings = (): void => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      if (settingsWin.isMinimized()) settingsWin.restore()
      settingsWin.show()
      settingsWin.focus()
      return
    }
    settingsWin = createSettingsWindow(icon)
    settingsWin.on('closed', () => {
      settingsWin = null
      shortcuts.setSuspended(false)
      const closedByZwift = closingSettingsForZwift
      closingSettingsForZwift = false
      if (!quitting && !closedByZwift && (settings.get().overlay.quitOnSettingsClose ?? false)) {
        app.quit()
      }
    })
  }

  const shortcuts = new ShortcutManager(
    {
      toggleMode: () => mode.toggle(),
      markLap: () => hub.markLap(),
      openSettings
    },
    (status) => broadcast(IPC.shortcutsStatusChanged, status)
  )

  const showOverlay = (): void => {
    overlayVisible = true
    if (!hub.hasActiveSource()) {
      hub.resetRide()
      startSource(settings.get())
    }
    if (overlayWin && !overlayWin.isDestroyed()) {
      const display = resolveDisplay(settings.get().overlay.displayId)
      fitOverlayToDisplay(overlayWin, display)
      overlayWin.showInactive()
      mode.apply()
    }
    tray.refresh()
  }

  const hideOverlay = (): void => {
    overlayVisible = false
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.hide()
    }
    tray.refresh()
  }

  const tray = new AppTray(icon, {
    toggleOverlayVisible: () => {
      if (overlayVisible) hideOverlay()
      else showOverlay()
    },
    isOverlayVisible: () => overlayVisible,
    toggleMode: () => mode.toggle(),
    markLap: () => hub.markLap(),
    resetRide: () => hub.resetRide(),
    openSettings,
    quit: () => app.quit()
  })

  // ---- オーバーレイとレイアウト補正 ----
  const overlaySize = (): { width: number; height: number } => {
    const d = resolveDisplay(settings.get().overlay.displayId)
    return { width: d.bounds.width, height: d.bounds.height }
  }

  /** 保存時の解像度と現在の解像度が違えばウィジェット座標を比例補正する */
  const syncLayoutToDisplay = (): void => {
    const s = settings.get()
    const size = overlaySize()
    const base = s.overlay.layoutBase
    if (base.width === size.width && base.height === size.height) return
    settings.update({
      widgets: rescaleWidgets(s.widgets, base, size),
      overlay: { layoutBase: size }
    })
  }

  const placeOverlay = (): void => {
    const display = resolveDisplay(settings.get().overlay.displayId)
    if (overlayWin && !overlayWin.isDestroyed()) {
      fitOverlayToDisplay(overlayWin, display)
    } else {
      overlayWin = createOverlayWindow(display)
      overlayWin.once('ready-to-show', () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          fitOverlayToDisplay(overlayWin, resolveDisplay(settings.get().overlay.displayId))
          if (overlayVisible) {
            overlayWin.showInactive()
            mode.apply()
          }
        }
      })
      overlayWin.on('closed', () => {
        overlayWin = null
        if (!quitting) placeOverlay()
      })
      overlayWin.webContents.on('did-finish-load', () => {
        if (overlayWin && !overlayWin.isDestroyed()) {
          fitOverlayToDisplay(overlayWin, resolveDisplay(settings.get().overlay.displayId))
        }
        mode.apply()
      })
    }
    syncLayoutToDisplay()
    mode.apply()
  }

  // ---- 設定変更の反映 ----
  const updateSettings = (patch: SettingsPatch): void => {
    // ウィジェット配置を保存するときは、その時点のディスプレイサイズを基準として記録する
    const p: SettingsPatch = patch.widgets
      ? { ...patch, overlay: { ...patch.overlay, layoutBase: overlaySize() } }
      : patch
    settings.update(p)
  }

  const startSource = (s: AppSettings): void => {
    void hub.useSource(
      createDataSource(s.dataSource.id, s.dataSource.options, { getAthlete: () => settings.get().athlete })
    )
  }

  const zwiftWatcher = new ZwiftProcessWatcher({
    getBehavior: () => settings.get().overlay.launchBehavior ?? 'ask',
    setBehavior: (launchBehavior) => settings.update({ overlay: { launchBehavior } }),
    getAutoCloseWithZwift: () => settings.get().overlay.autoCloseWithZwift ?? true,
    showOverlay,
    hideOverlay,
    onZwiftClosed: () => {
      hideOverlay()
      void hub.pauseSource()
      if (settingsWin && !settingsWin.isDestroyed()) {
        closingSettingsForZwift = true
        settingsWin.close()
      }
    },
    isOverlayVisible: () => overlayVisible
  })

  settings.onChange(({ next, prev }) => {
    broadcast(IPC.settingsChanged, next)
    if (JSON.stringify(next.shortcuts) !== JSON.stringify(prev.shortcuts)) shortcuts.apply(next.shortcuts)
    if (JSON.stringify(next.dataSource) !== JSON.stringify(prev.dataSource)) startSource(next)
    if (next.overlay.displayId !== prev.overlay.displayId) placeOverlay()
    if (next.overlay.runAtLogin !== prev.overlay.runAtLogin) {
      syncWindowsShortcuts(next.overlay.runAtLogin ?? true)
    }
    if (next.overlay.launchBehavior !== prev.overlay.launchBehavior) {
      zwiftWatcher.onBehaviorChanged(next.overlay.launchBehavior ?? 'ask')
    }
  })

  const resetLayout = (): void => {
    const size = overlaySize()
    settings.update({
      widgets: rescaleWidgets(DEFAULT_WIDGETS, DEFAULT_LAYOUT_BASE, size),
      overlay: { layoutBase: size }
    })
  }

  registerIpc({ settings, hub, mode, shortcuts, openSettings, resetLayout, updateSettings })

  hub.onSnapshot((snap) => broadcast(IPC.metricsUpdate, snap))

  // ---- 起動 ----
  const isTrayBoot = process.argv.includes('--tray')
  syncWindowsShortcuts(settings.get().overlay.runAtLogin ?? true)
  placeOverlay()
  shortcuts.apply(settings.get().shortcuts)
  startSource(settings.get())
  void zwiftWatcher.start(isTrayBoot)

  screen.on('display-metrics-changed', placeOverlay)
  screen.on('display-added', placeOverlay)
  screen.on('display-removed', placeOverlay)

  // Zwift 側がフォーカスを得たときに Z オーダーで負けないよう定期的に最前面を再主張する
  const topmostTimer = setInterval(() => {
    if (overlayVisible && overlayWin && !overlayWin.isDestroyed() && mode.get() === 'locked') {
      overlayWin.setAlwaysOnTop(true, 'screen-saver')
      overlayWin.moveTop()
    }
  }, 5000)

  app.on('second-instance', () => {
    showOverlay()
    openSettings()
  })
  // オーバーレイは常駐するため、全ウィンドウを閉じても終了しない（終了はトレイから）
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => {
    quitting = true
    clearInterval(topmostTimer)
    zwiftWatcher.stop()
    settings.flush()
    shortcuts.dispose()
    tray.destroy()
    void hub.stop()
  })

  // --tray 起動（Windows スタートアップ待機）以外のときは設定画面を開く
  if (process.argv.includes('--settings') || (!app.isPackaged && !isTrayBoot)) openSettings()
}
