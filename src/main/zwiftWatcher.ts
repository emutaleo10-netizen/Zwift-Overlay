import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import type { ZwiftLaunchBehavior } from '@shared/types/settings'
import { debugLog } from './debugLogger'

const STARTUP_LNK_NAME = 'Zwift Overlay.lnk'

function getStartupShortcutPath(): string {
  return path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    STARTUP_LNK_NAME
  )
}

function getDesktopShortcutPath(): string {
  return path.join(app.getPath('desktop'), STARTUP_LNK_NAME)
}

/**
 * Windows スタートアップフォルダおよびデスクトップにショートカット (.lnk) を作成・同期する。
 */
export function syncWindowsShortcuts(runAtLogin: boolean): void {
  if (process.platform !== 'win32') return
  try {
    const appPath = app.getAppPath()
    const target = process.execPath
    const isPackaged = app.isPackaged
    const baseArgs = isPackaged ? '' : `"${appPath}"`
    const trayArgs = isPackaged ? '--tray' : `"${appPath}" --tray`

    const desktopLnk = getDesktopShortcutPath()
    if (!fs.existsSync(desktopLnk)) {
      shell.writeShortcutLink(desktopLnk, 'create', {
        target,
        args: baseArgs,
        cwd: appPath,
        description: 'Zwift Overlay HUD'
      })
      debugLog.info('Shortcut', `Created Desktop shortcut: ${desktopLnk}`)
    }

    const startupLnk = getStartupShortcutPath()
    if (runAtLogin) {
      shell.writeShortcutLink(startupLnk, fs.existsSync(startupLnk) ? 'update' : 'create', {
        target,
        args: trayArgs,
        cwd: appPath,
        description: 'Zwift Overlay Background Watcher'
      })
      debugLog.info('Shortcut', `Synced Startup shortcut: ${startupLnk}`)
    } else if (fs.existsSync(startupLnk)) {
      fs.unlinkSync(startupLnk)
      debugLog.info('Shortcut', `Removed Startup shortcut: ${startupLnk}`)
    }
  } catch (err) {
    debugLog.warn('Shortcut', `Failed to sync Windows shortcuts: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 現在 Zwift ゲーム本体 (ZwiftApp.exe) が起動しているかを高速にチェックする。
 * 注意: ZwiftLauncher.exe は Zwift 終了後も常時タスクトレイに残るため、
 * 終了判定は必ず ZwiftApp.exe の有無で行う。
 */
export function checkZwiftRunning(): Promise<{ appRunning: boolean }> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ appRunning: false })
  }
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq ZwiftApp.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ appRunning: false })
          return
        }
        const appRunning = stdout.toLowerCase().includes('"zwiftapp.exe"')
        resolve({ appRunning })
      }
    )
  })
}

export interface ZwiftWatcherCallbacks {
  getBehavior: () => ZwiftLaunchBehavior
  setBehavior: (b: ZwiftLaunchBehavior) => void
  getAutoCloseWithZwift: () => boolean
  showOverlay: () => void
  hideOverlay: () => void
  onZwiftClosed: () => void
  isOverlayVisible: () => boolean
}

/**
 * バックグラウンドで Zwift 本体 (ZwiftApp.exe) の起動・終了を監視するウォッチャー。
 * - ZwiftApp.exe が起動したときに「Zwift Overlay を起動しますか？」と確認ダイアログ（または自動表示）を出す。
 * - ZwiftApp.exe が終了したときにオーバーレイも自動的にオフ（非表示 / 待機状態）にする。
 */
export class ZwiftProcessWatcher {
  private timer: NodeJS.Timeout | null = null
  private checking = false
  private promptShowing = false
  private handledCurrentSession = false
  private wasAppRunning = false

  constructor(private readonly cb: ZwiftWatcherCallbacks) {}

  async start(initialTrayMode: boolean): Promise<void> {
    if (this.timer) return
    const behavior = this.cb.getBehavior()
    const { appRunning } = await checkZwiftRunning()

    if (appRunning) {
      this.wasAppRunning = true
      if (initialTrayMode && behavior === 'ask') {
        void this.promptUserToLaunch()
      } else {
        this.handledCurrentSession = true
        this.cb.showOverlay()
      }
    } else {
      this.wasAppRunning = false
      if (behavior === 'always' && !initialTrayMode) {
        this.cb.showOverlay()
      } else if (initialTrayMode || behavior === 'ask' || behavior === 'auto') {
        this.cb.hideOverlay()
      }
    }

    // 2.5秒周期で ZwiftApp.exe の起動・終了を高速監視
    this.timer = setInterval(() => {
      void this.tick()
    }, 2500)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onBehaviorChanged(behavior: ZwiftLaunchBehavior): void {
    if (behavior === 'always') {
      this.cb.showOverlay()
    }
  }

  private async tick(): Promise<void> {
    if (this.checking || this.promptShowing) return
    this.checking = true
    try {
      const { appRunning } = await checkZwiftRunning()

      // ZwiftApp.exe が終了した瞬間を検出
      if (!appRunning) {
        if (this.wasAppRunning) {
          this.wasAppRunning = false
          this.handledCurrentSession = false
          if (this.cb.getAutoCloseWithZwift()) {
            debugLog.info('ZwiftWatcher', 'ZwiftApp.exe closed; automatically turning off overlay')
            this.cb.onZwiftClosed()
          }
        }
        return
      }

      // ZwiftApp.exe が新たに起動した瞬間を検出
      if (!this.wasAppRunning && appRunning) {
        this.wasAppRunning = true
        if (this.cb.isOverlayVisible()) {
          this.handledCurrentSession = true
          return
        }
        const behavior = this.cb.getBehavior()
        if (behavior === 'auto' || behavior === 'always') {
          this.handledCurrentSession = true
          debugLog.info('ZwiftWatcher', 'ZwiftApp.exe started; auto-showing overlay')
          this.cb.showOverlay()
        } else if (behavior === 'ask') {
          await this.promptUserToLaunch()
        }
      }
    } finally {
      this.checking = false
    }
  }

  private async promptUserToLaunch(): Promise<void> {
    if (this.promptShowing || this.handledCurrentSession) return
    this.promptShowing = true
    this.handledCurrentSession = true

    let promptWin: BrowserWindow | null = null
    try {
      promptWin = new BrowserWindow({
        width: 1,
        height: 1,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true
      })
      promptWin.setAlwaysOnTop(true, 'screen-saver')

      const res = await dialog.showMessageBox(promptWin, {
        type: 'question',
        title: 'Zwift Overlay',
        message: 'Zwift の起動を検出しました。\nZwift Overlay を起動（表示）しますか？',
        detail:
          '「起動する」を選ぶとオーバーレイを表示して Zwift への接続を開始します。\n（Zwift 終了時にはオーバーレイも自動的にオフになります）',
        buttons: ['起動する（はい）', '今回は起動しない（いいえ）', '今後は毎回自動で起動する'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })

      if (res.response === 0) {
        debugLog.info('ZwiftWatcher', 'User accepted launch prompt; showing overlay')
        this.cb.showOverlay()
      } else if (res.response === 2) {
        debugLog.info('ZwiftWatcher', 'User selected always auto-launch; updating setting and showing overlay')
        this.cb.setBehavior('auto')
        this.cb.showOverlay()
      } else {
        debugLog.info('ZwiftWatcher', 'User declined launch prompt for this session')
        this.cb.hideOverlay()
      }
    } catch (err) {
      debugLog.warn('ZwiftWatcher', `Prompt error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (promptWin && !promptWin.isDestroyed()) {
        promptWin.destroy()
      }
      this.promptShowing = false
    }
  }
}
