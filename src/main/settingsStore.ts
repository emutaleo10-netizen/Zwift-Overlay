import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { applySettingsPatch, normalizeSettings } from '@shared/settingsUtils'
import type { AppSettings, SettingsPatch } from '@shared/types/settings'
import { Emitter } from './data/DataSource'

interface StoreShape {
  settings: AppSettings
}

export interface SettingsChange {
  next: AppSettings
  prev: AppSettings
}

/**
 * electron-store のラッパー。
 * メモリ上の値を即時に更新・通知し、ディスクへの書き込みはデバウンスする
 * （スライダー操作やドラッグで書き込みが連発しないように）。
 */
export class SettingsStore {
  private readonly store: Store<StoreShape>
  private current: AppSettings
  private saveTimer: NodeJS.Timeout | null = null
  private readonly changes = new Emitter<SettingsChange>()

  constructor() {
    this.store = new Store<StoreShape>({
      name: 'config',
      defaults: { settings: DEFAULT_SETTINGS }
    })
    this.current = normalizeSettings(this.store.get('settings'))
  }

  get(): AppSettings {
    return this.current
  }

  get filePath(): string {
    return this.store.path
  }

  update(patch: SettingsPatch): AppSettings {
    const prev = this.current
    this.current = applySettingsPatch(prev, patch)
    this.scheduleSave()
    this.changes.emit({ next: this.current, prev })
    return this.current
  }

  onChange(cb: (c: SettingsChange) => void): () => void {
    return this.changes.on(cb)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.store.set('settings', this.current)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
  }
}
