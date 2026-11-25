import type { SourceStatus } from '@shared/types/metrics'

const COLORS: Record<SourceStatus['state'], string> = {
  idle: 'bg-gray-400',
  connecting: 'bg-yellow-400 animate-pulse',
  connected: 'bg-emerald-400',
  error: 'bg-red-500',
  stopped: 'bg-gray-500'
}

const TEXT: Record<SourceStatus['state'], string> = {
  idle: '待機中',
  connecting: '接続中',
  connected: '受信中',
  error: 'エラー',
  stopped: '停止'
}

export function StatusDot({ status, label }: { status: SourceStatus; label?: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-white/80" title={status.state === 'error' ? status.message : undefined}>
      <span className={`h-2 w-2 rounded-full ${COLORS[status.state]}`} />
      {label ? `${label}: ` : ''}
      {TEXT[status.state]}
    </span>
  )
}
