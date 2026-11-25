import type { BrowserWindow } from 'electron'
import type { OverlayMode } from '@shared/types/settings'

/**
 * ロックモード（クリックスルー）と編集モード（ドラッグ・リサイズ可）の切替。
 */
export class ModeController {
  private mode: OverlayMode = 'locked'
  private hoverInteractive = false

  constructor(
    private readonly getOverlay: () => BrowserWindow | null,
    private readonly onChange: (mode: OverlayMode) => void
  ) {}

  get(): OverlayMode {
    return this.mode
  }

  set(mode: OverlayMode): void {
    if (this.mode === mode) return
    this.mode = mode
    if (mode === 'edit') {
      this.hoverInteractive = false
    }
    this.apply()
    this.onChange(mode)
  }

  toggle(): void {
    this.set(this.mode === 'locked' ? 'edit' : 'locked')
  }

  /**
   * ロックモード中にインタラクティブウィジェット（マップ等）へマウスが乗ったときだけ
   * クリックスルーを一時解除してマウス操作を受け付ける。
   */
  setHoverInteractive(interactive: boolean): void {
    if (this.hoverInteractive === interactive) return
    this.hoverInteractive = interactive
    if (this.mode === 'locked') {
      const win = this.getOverlay()
      if (!win || win.isDestroyed()) return
      if (interactive) {
        win.setIgnoreMouseEvents(false)
      } else {
        win.setIgnoreMouseEvents(true, { forward: true })
      }
    }
  }

  /** 現在のモードをウィンドウに反映（ウィンドウ再生成時にも呼ぶ） */
  apply(): void {
    const win = this.getOverlay()
    if (!win || win.isDestroyed()) return
    if (this.mode === 'edit') {
      win.setIgnoreMouseEvents(false)
      win.setFocusable(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.focus()
    } else {
      if (this.hoverInteractive) {
        win.setIgnoreMouseEvents(false)
      } else {
        win.setIgnoreMouseEvents(true, { forward: true })
      }
      win.setFocusable(false)
      win.blur()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}
