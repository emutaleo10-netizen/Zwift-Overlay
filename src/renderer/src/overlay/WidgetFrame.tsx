import { Rnd } from 'react-rnd'
import type { ReactNode } from 'react'
import { LIMITS, WIDGET_LABELS } from '@shared/defaults'
import type { WidgetConfig } from '@shared/types/settings'

interface Props {
  config: WidgetConfig
  editing: boolean
  selected?: boolean
  onSelect?: () => void
  gridSize: number
  onCommit: (next: WidgetConfig) => void
  children: ReactNode
}

const snap = (v: number, g: number): number => Math.max(0, Math.round(v / g) * g)

/** react-rnd のラッパー。編集モードのときだけドラッグ・リサイズ可能 */
export function WidgetFrame({ config, editing, selected, onSelect, gridSize, onCommit, children }: Props): React.JSX.Element {
  const g = Math.max(1, gridSize)
  return (
    <Rnd
      size={{ width: config.width, height: config.height }}
      position={{ x: config.x, y: config.y }}
      bounds="parent"
      minWidth={LIMITS.widgetMinWidth}
      minHeight={LIMITS.widgetMinHeight}
      disableDragging={!editing}
      enableResizing={editing}
      cancel=".no-widget-drag"
      dragGrid={[g, g]}
      resizeGrid={[g, g]}
      className={editing ? 'group cursor-move' : ''}
      onMouseDown={() => {
        if (editing && onSelect) onSelect()
      }}
      onDragStart={() => {
        if (editing && onSelect) onSelect()
      }}
      onDragStop={(_e, d) => {
        if (d.x !== config.x || d.y !== config.y) onCommit({ ...config, x: snap(d.x, g), y: snap(d.y, g) })
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        onCommit({
          ...config,
          width: snap(ref.offsetWidth, g),
          height: snap(ref.offsetHeight, g),
          x: snap(pos.x, g),
          y: snap(pos.y, g)
        })
      }}
    >
      <div className="h-full w-full" style={{ containerType: 'size' }}>
        {children}
      </div>
      {editing && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 rounded-xl outline-2 ${
              selected
                ? 'outline-amber-400'
                : 'outline-sky-400/80 outline-dashed group-hover:outline-sky-300'
            }`}
          />
          <div
            className={`pointer-events-none absolute -top-6 left-0 rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white ${
              selected ? 'bg-amber-500/95' : 'bg-sky-500/90'
            }`}
          >
            {WIDGET_LABELS[config.type]} · X:{config.x} Y:{config.y} · {config.width}×{config.height}
          </div>
          <div className="pointer-events-none absolute right-0.5 bottom-0.5 h-3 w-3 border-r-2 border-b-2 border-sky-300" />
        </>
      )}
    </Rnd>
  )
}
