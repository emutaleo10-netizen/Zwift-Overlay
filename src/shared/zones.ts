import type { ZoneInfo } from './types/metrics'

export interface PowerZoneDef {
  index: number
  name: string
  /** FTP 比の下限（含む） */
  min: number
  /** FTP 比の上限（含まない）。最終ゾーンは Infinity */
  max: number
  color: string
}

/** Coggan の 7 ゾーン */
export const POWER_ZONES: readonly PowerZoneDef[] = [
  { index: 1, name: 'Active Recovery', min: 0, max: 0.55, color: '#9ca3af' },
  { index: 2, name: 'Endurance', min: 0.55, max: 0.76, color: '#3b82f6' },
  { index: 3, name: 'Tempo', min: 0.76, max: 0.91, color: '#22c55e' },
  { index: 4, name: 'Threshold', min: 0.91, max: 1.06, color: '#eab308' },
  { index: 5, name: 'VO2max', min: 1.06, max: 1.21, color: '#f97316' },
  { index: 6, name: 'Anaerobic', min: 1.21, max: 1.51, color: '#ef4444' },
  { index: 7, name: 'Neuromuscular', min: 1.51, max: Infinity, color: '#a855f7' }
]

export function getZone(power: number | null | undefined, ftp: number): ZoneInfo | null {
  if (power == null || !Number.isFinite(power) || !(ftp > 0)) return null
  const ratio = Math.max(0, power) / ftp
  const def = POWER_ZONES.find((z) => ratio >= z.min && ratio < z.max) ?? POWER_ZONES[POWER_ZONES.length - 1]
  return { index: def.index, name: def.name, color: def.color, ratio }
}
