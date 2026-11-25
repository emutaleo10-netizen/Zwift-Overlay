import { BrowserWindow, screen, type Display } from 'electron'
import { loadPage, PRELOAD_PATH } from './load'

export function resolveDisplay(displayId: number | null): Display {
  if (displayId != null) {
    const found = screen.getAllDisplays().find((d) => d.id === displayId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

/**
 * ディスプレイ全体を覆う透過・最前面・クリックスルーのオーバーレイ。
 * タスクバーも含めた bounds を使う（Zwift のボーダーレス全画面に合わせるため）。
 */
export function createOverlayWindow(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    title: 'Zwift Overlay',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  fitOverlayToDisplay(win, display)
  loadPage(win, 'overlay')
  return win
}

/**
 * マルチディスプレイ環境で解像度や DPI スケールが異なるモニタ間でも
 * Windows の WM_DPICHANGED によるサイズ縮小バグを回避し、確実にモニタ全体へフィットさせる。
 */
export function fitOverlayToDisplay(win: BrowserWindow, display: Display): void {
  if (win.isDestroyed()) return
  const bounds = { ...display.bounds }
  const apply = (): void => {
    if (win.isDestroyed()) return
    win.setResizable(true)
    win.setBounds(bounds)
    win.setBounds(bounds)
    win.setResizable(false)
  }
  apply()
  setTimeout(apply, 120)
}
