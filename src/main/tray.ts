import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { OverlayMode } from '@shared/types/settings'

/** 外部アセット不要のアプリアイコン（オレンジの円に白い稲妻風マーク）を描画する */
export function createAppIcon(size = 32): NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const r = size / 2 - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      if (d > r) continue
      // 稲妻: 中央付近の斜めの帯
      const u = (x - c) / r
      const v = (y - c) / r
      const bolt =
        (v < 0 && v > -0.75 && u > -0.05 - (v + 0.75) * 0.4 && u < 0.3 - (v + 0.75) * 0.4) ||
        (v >= 0 && v < 0.75 && u > -0.3 + v * 0.4 - 0.05 && u < 0.05 + v * 0.4)
      const alpha = Math.round(255 * Math.min(1, r - d + 0.5))
      // BGRA
      if (bolt) {
        buf[i] = 255
        buf[i + 1] = 255
        buf[i + 2] = 255
      } else {
        buf[i] = 0x16
        buf[i + 1] = 0x73
        buf[i + 2] = 0xf9
      }
      buf[i + 3] = alpha
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

export interface TrayHandlers {
  toggleOverlayVisible: () => void
  isOverlayVisible: () => boolean
  toggleMode: () => void
  markLap: () => void
  resetRide: () => void
  openSettings: () => void
  quit: () => void
}

export class AppTray {
  private readonly tray: Tray
  private currentMode: OverlayMode = 'locked'

  constructor(
    icon: NativeImage,
    private readonly handlers: TrayHandlers
  ) {
    this.tray = new Tray(icon)
    this.tray.setToolTip('Zwift Overlay (バックグラウンド待機中 / クリックで設定)')
    this.tray.on('click', () => handlers.openSettings())
    this.refresh('locked')
  }

  refresh(mode: OverlayMode = this.currentMode): void {
    this.currentMode = mode
    const h = this.handlers
    const visible = h.isOverlayVisible()
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: visible ? 'オーバーレイを隠す（待機状態にする）' : 'オーバーレイを表示する',
          click: h.toggleOverlayVisible
        },
        { type: 'separator' },
        {
          label: mode === 'locked' ? '編集モードにする' : 'ロックする（クリックスルー）',
          enabled: visible,
          click: h.toggleMode
        },
        { label: 'ラップ', enabled: visible, click: h.markLap },
        { label: 'ライドをリセット', enabled: visible, click: h.resetRide },
        { type: 'separator' },
        { label: '設定を開く', click: h.openSettings },
        { type: 'separator' },
        { label: '終了', click: h.quit }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
