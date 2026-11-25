import { BrowserWindow, type NativeImage } from 'electron'
import { loadPage, PRELOAD_PATH } from './load'

export function createSettingsWindow(icon: NativeImage): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Zwift Overlay 設定',
    icon,
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenu(null)
  win.once('ready-to-show', () => win.show())
  loadPage(win, 'settings')
  return win
}
