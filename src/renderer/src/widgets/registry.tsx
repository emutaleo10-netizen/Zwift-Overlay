import { getZone } from '@shared/zones'
import type { WidgetType } from '@shared/types/settings'
import { fmtFixed, fmtInt } from '@renderer/lib/format'
import { GroupsWidget } from './GroupsWidget'
import { LapWidget } from './LapWidget'
import { MapWidget } from './MapWidget'
import { MetricWidget } from './MetricWidget'
import { PowerZoneWidget } from './PowerZoneWidget'
import { WBalWidget } from './WBalWidget'
import type { WidgetProps } from './WidgetShell'

type WidgetComponent = (props: WidgetProps) => React.JSX.Element

/** widgetType → 描画コンポーネント。新しいウィジェットはここに追加する */
export const WIDGET_COMPONENTS: Record<WidgetType, WidgetComponent> = {
  power: (p) => (
    <MetricWidget
      {...p}
      label="Power"
      value={fmtInt(p.metrics?.power)}
      unit="W"
      accent={getZone(p.metrics?.power, p.settings.athlete.ftp)?.color}
    />
  ),
  power3s: (p) => (
    <MetricWidget {...p} label="3s Power" value={fmtInt(p.metrics?.power3s)} unit="W" accent={p.metrics?.zone?.color} />
  ),
  power5s: (p) => (
    <MetricWidget
      {...p}
      label="5s Best"
      value={fmtInt(p.metrics?.power5s)}
      unit="W"
      accent={getZone(p.metrics?.power5s, p.settings.athlete.ftp)?.color}
    />
  ),
  power1m: (p) => (
    <MetricWidget
      {...p}
      label="1m Best"
      value={fmtInt(p.metrics?.power1m)}
      unit="W"
      accent={getZone(p.metrics?.power1m, p.settings.athlete.ftp)?.color}
    />
  ),
  power5m: (p) => (
    <MetricWidget
      {...p}
      label="5m Best"
      value={fmtInt(p.metrics?.power5m)}
      unit="W"
      accent={getZone(p.metrics?.power5m, p.settings.athlete.ftp)?.color}
    />
  ),
  power20m: (p) => (
    <MetricWidget
      {...p}
      label="20m Best"
      value={fmtInt(p.metrics?.power20m)}
      unit="W"
      accent={getZone(p.metrics?.power20m, p.settings.athlete.ftp)?.color}
    />
  ),
  normalizedPower: (p) => (
    <MetricWidget
      {...p}
      label="Norm. Power"
      value={fmtInt(p.metrics?.normalizedPower)}
      unit="W"
      accent={getZone(p.metrics?.normalizedPower, p.settings.athlete.ftp)?.color}
    />
  ),
  wkg: (p) => (
    <MetricWidget {...p} label="W/kg" value={fmtFixed(p.metrics?.wkg, 1)} unit="W/kg" accent={p.metrics?.zone?.color} />
  ),
  heartRate: (p) => (
    <MetricWidget {...p} label="Heart Rate" value={fmtInt(p.metrics?.heartRate)} unit="bpm" accent="#f43f5e" />
  ),
  cadence: (p) => (
    <MetricWidget {...p} label="Cadence" value={fmtInt(p.metrics?.cadence)} unit="rpm" accent="#22d3ee" />
  ),
  powerZone: PowerZoneWidget,
  lap: LapWidget,
  groups: GroupsWidget,
  map: MapWidget,
  wbal: WBalWidget
}
