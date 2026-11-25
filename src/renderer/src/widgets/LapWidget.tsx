import { fmtDuration, fmtInt } from '@renderer/lib/format'
import { scaledFont, WidgetShell, type WidgetProps } from './WidgetShell'

export function LapWidget({ config, metrics }: WidgetProps): React.JSX.Element {
  const lap = metrics?.currentLap
  const prev = metrics?.previousLap ?? null

  return (
    <WidgetShell config={config}>
      <div className="flex h-full flex-col justify-center gap-[4%] px-[6%]">
        <div className="flex items-baseline justify-between leading-none" style={{ fontSize: scaledFont(config, 13, 6) }}>
          <span className="font-semibold tracking-widest text-white/70">LAP {lap?.index ?? 1}</span>
          <span className="text-white/50">RIDE {fmtDuration(metrics?.rideElapsedMs ?? 0)}</span>
        </div>

        <div className="font-bold leading-none text-white" style={{ fontSize: scaledFont(config, 36, 18) }}>
          {fmtDuration(lap?.elapsedMs ?? 0)}
        </div>

        <div className="flex items-baseline gap-[1em] leading-none" style={{ fontSize: scaledFont(config, 15, 7) }}>
          <span>
            <span className="text-white/60">AVG </span>
            <span className="font-bold text-white">{fmtInt(lap?.avgPower)}</span>
            <span className="text-white/60"> W</span>
          </span>
          <span>
            <span className="text-white/60">HR </span>
            <span className="font-semibold text-white">{fmtInt(lap?.avgHeartRate)}</span>
          </span>
        </div>

        {prev && (
          <div className="leading-none text-white/50" style={{ fontSize: scaledFont(config, 11, 5.5) }}>
            前回 LAP {prev.index}: {fmtDuration(prev.elapsedMs)} / {fmtInt(prev.avgPower)} W
          </div>
        )}
      </div>
    </WidgetShell>
  )
}
