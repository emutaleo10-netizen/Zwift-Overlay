import { DEFAULT_WIDGETS, LIMITS, WIDGET_LABELS } from '@shared/defaults'
import type { WidgetConfig } from '@shared/types/settings'
import { useAppStore } from '@renderer/stores/appStore'
import { Button, Section, Toggle } from './ui'

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-white/50">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-11 shrink-0 text-right text-xs text-white/80 tabular-nums">{format(value)}</span>
    </label>
  )
}

function PixelField({
  label,
  value,
  min = 0,
  max = 7680,
  onChange
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (next: number) => void
}): React.JSX.Element {
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v)))
  return (
    <div className="flex items-center gap-1">
      <span className="w-4 text-right text-[11px] font-semibold text-white/45">{label}</span>
      <div className="flex items-center overflow-hidden rounded-md border border-white/15 bg-black/35">
        <button
          type="button"
          title="-1px"
          onClick={() => onChange(clamp(value - 1))}
          className="px-1.5 py-1 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white"
        >
          -
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(clamp(n))
          }}
          className="w-14 bg-transparent py-1 text-center text-xs font-semibold text-white tabular-nums outline-none"
        />
        <button
          type="button"
          title="+1px"
          onClick={() => onChange(clamp(value + 1))}
          className="px-1.5 py-1 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white"
        >
          +
        </button>
      </div>
    </div>
  )
}

export function WidgetsSection({ widgets }: { widgets: WidgetConfig[] }): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const setWidgetsLocal = useAppStore((s) => s.setWidgetsLocal)
  const mapTrailMode = useAppStore((s) => s.settings?.overlay.mapTrailMode ?? 'full')

  const patchWidget = (id: string, patch: Partial<WidgetConfig>): void => {
    const next = widgets.map((w) => (w.id === id ? { ...w, ...patch } : w))
    setWidgetsLocal(next)
    void updateSettings({ widgets: next })
  }

  const applyToAll = (patch: Partial<WidgetConfig>): void => {
    const next = widgets.map((w) => ({ ...w, ...patch }))
    setWidgetsLocal(next)
    void updateSettings({ widgets: next })
  }

  return (
    <Section
      title="ウィジェット"
      description="表示の ON/OFF、位置 (X/Y) とサイズ (W/H) の 1px 単位の微調整、背景の不透明度、文字サイズを設定します（編集モード中は矢印キーでも 1px 単位で移動できます）。"
      actions={
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => void window.overlayApi.setMode('edit')}>配置を編集</Button>
          <Button variant="danger" onClick={() => void window.overlayApi.resetLayout()}>
            配置をリセット
          </Button>
        </div>
      }
    >
      <div className="divide-y divide-white/5">
        {widgets.map((w) => {
          const def = DEFAULT_WIDGETS.find((d) => d.type === w.type)
          return (
            <div key={w.id} className="flex flex-col gap-2.5 py-3">
              <div className="flex items-center gap-4">
                <Toggle
                  checked={w.visible}
                  onChange={(visible) => patchWidget(w.id, { visible })}
                  label={WIDGET_LABELS[w.type]}
                />
                <span className={`w-44 shrink-0 text-sm font-medium ${w.visible ? 'text-white' : 'text-white/40'}`}>
                  {WIDGET_LABELS[w.type]}
                </span>
                <Slider
                  label="背景の不透明度"
                  value={w.bgOpacity}
                  min={LIMITS.bgOpacity[0]}
                  max={LIMITS.bgOpacity[1]}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(bgOpacity) => patchWidget(w.id, { bgOpacity })}
                />
                <Slider
                  label="文字サイズ"
                  value={w.fontScale}
                  min={LIMITS.fontScale[0]}
                  max={LIMITS.fontScale[1]}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(fontScale) => patchWidget(w.id, { fontScale })}
                />
                <button
                  type="button"
                  className="shrink-0 text-xs text-white/40 hover:text-white/80"
                  onClick={() =>
                    def &&
                    patchWidget(w.id, {
                      x: def.x,
                      y: def.y,
                      width: def.width,
                      height: def.height,
                      bgOpacity: def.bgOpacity,
                      fontScale: def.fontScale
                    })
                  }
                >
                  既定値
                </button>
              </div>

              {/* 位置 (X, Y) とサイズ (W, H) の 1px 微調整行 */}
              <div className="flex flex-wrap items-center gap-4 pl-12">
                <span className="text-xs text-white/40">位置・サイズ微調整 (px):</span>
                <PixelField label="X" value={w.x} min={0} max={7680} onChange={(x) => patchWidget(w.id, { x })} />
                <PixelField label="Y" value={w.y} min={0} max={4320} onChange={(y) => patchWidget(w.id, { y })} />
                <PixelField
                  label="W"
                  value={w.width}
                  min={LIMITS.widgetMinWidth}
                  max={3840}
                  onChange={(width) => patchWidget(w.id, { width })}
                />
                <PixelField
                  label="H"
                  value={w.height}
                  min={LIMITS.widgetMinHeight}
                  max={2160}
                  onChange={(height) => patchWidget(w.id, { height })}
                />
              </div>

              {w.type === 'map' && (
                <div className="flex flex-wrap items-center gap-3 pl-12">
                  <span className="text-xs text-white/40">走行軌跡表示:</span>
                  <select
                    value={mapTrailMode}
                    onChange={(e) =>
                      void updateSettings({
                        overlay: { mapTrailMode: e.target.value as 'full' | '5m' | '3m' | 'off' }
                      })
                    }
                    className="rounded-md border border-white/15 bg-[#121826] px-2.5 py-1 text-xs text-white outline-none focus:border-orange-400"
                  >
                    <option value="full">ライド全体を表示</option>
                    <option value="5m">直近 5 分のみ表示</option>
                    <option value="3m">直近 3 分のみ表示</option>
                    <option value="off">軌跡を表示しない</option>
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex gap-2 border-t border-white/5 pt-3">
        <span className="self-center text-xs text-white/40">一括設定:</span>
        <Button onClick={() => applyToAll({ visible: true })}>すべて表示</Button>
        <Button onClick={() => applyToAll({ bgOpacity: 0 })}>背景を透明に</Button>
        <Button onClick={() => applyToAll({ bgOpacity: 0.55 })}>背景を標準に</Button>
      </div>
    </Section>
  )
}
