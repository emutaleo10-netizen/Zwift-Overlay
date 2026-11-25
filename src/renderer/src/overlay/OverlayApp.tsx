import { useCallback, useEffect, useState } from 'react'
import { LIMITS } from '@shared/defaults'
import type { WidgetConfig } from '@shared/types/settings'
import { useAppStore } from '@renderer/stores/appStore'
import { WIDGET_COMPONENTS } from '@renderer/widgets/registry'
import { EditToolbar } from './EditToolbar'
import { WidgetFrame } from './WidgetFrame'

export function OverlayApp(): React.JSX.Element | null {
  const { settings, mode, metrics, shortcutStatus, connect, updateSettings, setWidgetsLocal } = useAppStore()
  const editing = mode === 'edit'
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => connect(), [connect])

  const commitWidget = useCallback(
    (next: WidgetConfig) => {
      const current = useAppStore.getState().settings
      if (!current) return
      const widgets = current.widgets.map((w) => (w.id === next.id ? next : w))
      setWidgetsLocal(widgets)
      void updateSettings({ widgets })
    },
    [setWidgetsLocal, updateSettings]
  )

  // 編集モード中は Esc でロック、矢印キーで選択中ウィジェットを 1px 単位（Shift で 10px 単位、Alt でサイズ 1px 単位）で微調整
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void window.overlayApi.setMode('locked')
        return
      }
      if (!selectedId) return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const current = useAppStore.getState().settings
      const target = current?.widgets.find((w) => w.id === selectedId)
      if (!target) return

      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0

      if (e.altKey) {
        commitWidget({
          ...target,
          width: Math.max(LIMITS.widgetMinWidth, target.width + dx),
          height: Math.max(LIMITS.widgetMinHeight, target.height + dy)
        })
      } else {
        commitWidget({
          ...target,
          x: Math.max(0, target.x + dx),
          y: Math.max(0, target.y + dy)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commitWidget, editing, selectedId])

  if (!settings) return null
  const gridSize = settings.overlay.gridSize

  return (
    <div className="relative h-full w-full" onMouseDown={() => editing && setSelectedId(null)}>
      {editing && (
        <div
          className="edit-grid absolute inset-0 bg-black/30"
          style={{ backgroundSize: `${gridSize * 5}px ${gridSize * 5}px` }}
        />
      )}

      {settings.widgets
        .filter((w) => w.visible)
        .map((w) => {
          const Component = WIDGET_COMPONENTS[w.type]
          return (
            <WidgetFrame
              key={w.id}
              config={w}
              editing={editing}
              selected={selectedId === w.id}
              onSelect={() => setSelectedId(w.id)}
              gridSize={gridSize}
              onCommit={commitWidget}
            >
              <Component config={w} metrics={metrics} settings={settings} />
            </WidgetFrame>
          )
        })}

      {editing && <EditToolbar metrics={metrics} shortcutStatus={shortcutStatus} />}
    </div>
  )
}
