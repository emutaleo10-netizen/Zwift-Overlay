import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'

export type PageName = 'overlay' | 'settings'

export const PRELOAD_PATH = join(__dirname, '../preload/index.js')

export function loadPage(win: BrowserWindow, page: PageName): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}/${page}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}
