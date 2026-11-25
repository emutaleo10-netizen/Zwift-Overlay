import { create } from 'zustand'
import type { ShortcutStatus } from '@shared/types/ipc'
import type { MetricsSnapshot } from '@shared/types/metrics'
import type { AppSettings, OverlayMode, SettingsPatch, WidgetConfig } from '@shared/types/settings'

const api = (): typeof window.overlayApi => window.overlayApi

interface AppState {
  settings: AppSettings | null
  mode: OverlayMode
  metrics: MetricsSnapshot | null
  shortcutStatus: ShortcutStatus | null
  /** main プロセスとの購読を開始し、解除関数を返す */
  connect: () => () => void
  updateSettings: (patch: SettingsPatch) => Promise<void>
  /** ドラッグ中などの楽観的更新用（保存は updateSettings で行う） */
  setWidgetsLocal: (widgets: WidgetConfig[]) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  mode: 'locked',
  metrics: null,
  shortcutStatus: null,

  connect: () => {
    const a = api()
    void Promise.all([a.getSettings(), a.getMode(), a.getLatestMetrics(), a.getShortcutStatus()]).then(
      ([settings, mode, metrics, shortcutStatus]) => set({ settings, mode, metrics, shortcutStatus })
    )
    const unsubs = [
      a.onSettingsChanged((settings) => set({ settings })),
      a.onModeChanged((mode) => set({ mode })),
      a.onMetrics((metrics) => set({ metrics })),
      a.onShortcutStatusChanged((shortcutStatus) => set({ shortcutStatus }))
    ]
    return () => unsubs.forEach((u) => u())
  },

  updateSettings: async (patch) => {
    const settings = await api().updateSettings(patch)
    set({ settings })
  },

  setWidgetsLocal: (widgets) => {
    const s = get().settings
    if (s) set({ settings: { ...s, widgets } })
  }
}))
