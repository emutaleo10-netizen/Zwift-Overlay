import type { MetricsSnapshot } from '@shared/types/metrics'
import type { ShortcutStatus } from '@shared/types/ipc'
import { StatusDot } from '@renderer/components/StatusDot'

interface Props {
  metrics: MetricsSnapshot | null
  shortcutStatus: ShortcutStatus | null
}

export function EditToolbar({ metrics, shortcutStatus }: Props): React.JSX.Element {
  const api = window.overlayApi
  const toggleKey = shortcutStatus?.toggleMode.accelerator
  return (
    <div className="absolute top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/15 bg-slate-900/90 px-4 py-2.5 text-sm text-white shadow-2xl backdrop-blur">
      <span className="font-bold text-sky-300">編集モード</span>
      <span className="text-white/60">ウィジェットをドラッグで移動、右下をつまんでリサイズ</span>
      {metrics && <StatusDot status={metrics.source.status} label={metrics.source.name} />}
      <div className="mx-1 h-5 w-px bg-white/20" />
      <button className="rounded-lg bg-white/10 px-3 py-1 hover:bg-white/20" onClick={() => void api.markLap()}>
        ラップ
      </button>
      <button className="rounded-lg bg-white/10 px-3 py-1 hover:bg-white/20" onClick={() => void api.openSettings()}>
        設定
      </button>
      <button
        className="rounded-lg bg-orange-500 px-3 py-1 font-semibold hover:bg-orange-400"
        onClick={() => void api.setMode('locked')}
      >
        ロック（Esc{toggleKey ? ` / ${toggleKey}` : ''}）
      </button>
    </div>
  )
}
