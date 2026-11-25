import { globalShortcut } from 'electron'
import type { ShortcutStatus } from '@shared/types/ipc'
import type { ShortcutAction, ShortcutSettings } from '@shared/types/settings'

const ACTIONS: ShortcutAction[] = ['toggleMode', 'markLap', 'openSettings']

/**
 * グローバルショートカットの登録・再登録。
 * 設定画面でキーを録音している間は一時停止できる（録音中のキーが横取りされないように）。
 */
export class ShortcutManager {
  private shortcuts: ShortcutSettings | null = null
  private suspended = false
  private status: ShortcutStatus

  constructor(
    private readonly handlers: Record<ShortcutAction, () => void>,
    private readonly onStatusChange: (s: ShortcutStatus) => void
  ) {
    this.status = Object.fromEntries(
      ACTIONS.map((a) => [a, { accelerator: '', registered: false }])
    ) as ShortcutStatus
  }

  apply(shortcuts: ShortcutSettings): ShortcutStatus {
    this.shortcuts = shortcuts
    return this.register()
  }

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return
    this.suspended = suspended
    if (suspended) {
      globalShortcut.unregisterAll()
    } else {
      this.register()
    }
  }

  getStatus(): ShortcutStatus {
    return this.status
  }

  dispose(): void {
    globalShortcut.unregisterAll()
  }

  private register(): ShortcutStatus {
    globalShortcut.unregisterAll()
    const sc = this.shortcuts
    if (!sc) return this.status
    const next = {} as ShortcutStatus
    const used = new Map<string, ShortcutAction>()

    for (const action of ACTIONS) {
      const accelerator = sc[action].trim()
      if (!accelerator) {
        next[action] = { accelerator, registered: false, error: '未設定' }
        continue
      }
      const dup = used.get(accelerator.toLowerCase())
      if (dup) {
        next[action] = { accelerator, registered: false, error: '他の操作と重複しています' }
        continue
      }
      if (this.suspended) {
        next[action] = { accelerator, registered: false, error: '録音中のため一時停止中' }
        continue
      }
      try {
        const ok = globalShortcut.register(accelerator, this.handlers[action])
        next[action] = ok
          ? { accelerator, registered: true }
          : { accelerator, registered: false, error: '他のアプリが使用中のため登録できません' }
        if (ok) used.set(accelerator.toLowerCase(), action)
      } catch {
        next[action] = { accelerator, registered: false, error: '無効なキーの組み合わせです' }
      }
    }
    this.status = next
    this.onStatusChange(next)
    return next
  }
}
