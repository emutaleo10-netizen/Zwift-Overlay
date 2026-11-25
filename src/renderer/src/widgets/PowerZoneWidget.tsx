import { POWER_ZONES } from '@shared/zones'
import { scaledFont, WidgetShell, type WidgetProps } from './WidgetShell'

/** ゲージの右端（FTP 比） */
const GAUGE_MAX = 1.8

export function PowerZoneWidget({ config, metrics }: WidgetProps): React.JSX.Element {
  const zone = metrics?.zone ?? null
  const ratio = zone?.ratio ?? null
  const markerPos = ratio == null ? null : (Math.min(ratio, GAUGE_MAX) / GAUGE_MAX) * 100

  return (
    <WidgetShell config={config}>
      <div className="flex h-full flex-col justify-center gap-[8%] px-[5%]">
        <div className="flex items-baseline justify-between leading-none" style={{ fontSize: scaledFont(config, 24, 7) }}>
          <span className="font-bold" style={{ color: zone?.color ?? 'rgb(255 255 255 / 0.4)' }}>
            {zone ? `Z${zone.index} ${zone.name}` : 'ZONE --'}
          </span>
          <span className="font-semibold text-white/80">
            {ratio == null ? '--' : `${Math.round(ratio * 100)}%`}
            <span className="ml-1 text-white/50" style={{ fontSize: '0.7em' }}>
              FTP
            </span>
          </span>
        </div>

        <div className="relative h-[30%]">
          <div className="flex h-full gap-[2px] overflow-hidden rounded-md">
            {POWER_ZONES.map((z) => {
              const span = Math.min(z.max, GAUGE_MAX) - z.min
              const active = zone?.index === z.index
              return (
                <div
                  key={z.index}
                  className="h-full transition-opacity duration-300"
                  style={{ flexGrow: span, flexBasis: 0, backgroundColor: z.color, opacity: active ? 1 : 0.3 }}
                />
              )
            })}
          </div>
          {markerPos != null && (
            <div
              className="absolute -top-[25%] -bottom-[25%] w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,0.9)] transition-[left] duration-300 ease-out"
              style={{ left: `${markerPos}%` }}
            />
          )}
        </div>
      </div>
    </WidgetShell>
  )
}
