import { useEffect } from 'react'
import { useAppStore } from '@renderer/stores/appStore'
import { AthleteSection } from './AthleteSection'
import { DataSourceSection, OverlaySection } from './OverlaySection'
import { ShortcutsSection } from './ShortcutsSection'
import { WidgetsSection } from './WidgetsSection'

export function SettingsApp(): React.JSX.Element {
  const { settings, metrics, shortcutStatus, connect } = useAppStore()
  useEffect(() => connect(), [connect])

  if (!settings) {
    return <div className="flex h-full items-center justify-center text-white/50">読み込み中…</div>
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b0f17]/90 px-8 py-4 backdrop-blur">
        <h1 className="text-lg font-bold text-white">
          Zwift Overlay <span className="font-normal text-white/40">設定</span>
        </h1>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-6">
        <AthleteSection athlete={settings.athlete} />
        <OverlaySection settings={settings} />
        <WidgetsSection widgets={settings.widgets} />
        <ShortcutsSection shortcuts={settings.shortcuts} status={shortcutStatus} />
        <DataSourceSection settings={settings} metrics={metrics} />
      </main>
    </div>
  )
}
