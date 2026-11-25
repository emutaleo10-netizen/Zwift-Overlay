import type { CSSProperties, ReactNode } from 'react'
import type { MetricsSnapshot } from '@shared/types/metrics'
import type { AppSettings, WidgetConfig } from '@shared/types/settings'

export interface WidgetProps {
  config: WidgetConfig
  metrics: MetricsSnapshot | null
  settings: AppSettings
}

/**
 * ウィジェットの外枠。親（WidgetFrame）が container-type: size を持つので、
 * 子要素は cqh / cqw 単位で枠サイズに追従してスケールする。
 */
export function WidgetShell({
  config,
  children,
  accent
}: {
  config: WidgetConfig
  children: ReactNode
  accent?: string | null
}): React.JSX.Element {
  const style: CSSProperties = { backgroundColor: `rgb(10 12 18 / ${config.bgOpacity})` }
  return (
    <div className="hud-text relative h-full w-full overflow-hidden rounded-xl" style={style}>
      {accent && (
        <div
          className="absolute top-0 bottom-0 left-0 w-[4%] min-w-1 transition-colors duration-500"
          style={{ backgroundColor: accent }}
        />
      )}
      {children}
    </div>
  )
}

/** fontScale を掛けた、枠サイズ連動のフォントサイズ */
export function scaledFont(config: WidgetConfig, cqh: number, cqwCap: number): string {
  return `calc(min(${cqh}cqh, ${cqwCap}cqw) * ${config.fontScale})`
}
