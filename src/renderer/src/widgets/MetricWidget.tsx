import { scaledFont, WidgetShell, type WidgetProps } from './WidgetShell'

interface MetricWidgetProps extends WidgetProps {
  label: string
  value: string
  unit: string
  accent?: string | null
}

/** 単一の数値を大きく表示する汎用ウィジェット */
export function MetricWidget({ config, label, value, unit, accent }: MetricWidgetProps): React.JSX.Element {
  const empty = value === '--'
  return (
    <WidgetShell config={config} accent={accent}>
      <div className="flex h-full flex-col justify-center pr-[6%] pl-[9%]">
        <div
          className="font-semibold tracking-widest text-white/70 uppercase"
          style={{ fontSize: scaledFont(config, 17, 8) }}
        >
          {label}
        </div>
        <div className="flex items-baseline gap-[0.15em] leading-none">
          <span
            className={`font-bold ${empty ? 'text-white/40' : 'text-white'}`}
            style={{ fontSize: scaledFont(config, 56, 30) }}
          >
            {value}
          </span>
          <span className="font-semibold text-white/60" style={{ fontSize: scaledFont(config, 20, 10) }}>
            {unit}
          </span>
        </div>
      </div>
    </WidgetShell>
  )
}
