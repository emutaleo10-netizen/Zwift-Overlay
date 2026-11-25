export function fmtInt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '--' : Math.round(v).toString()
}

export function fmtFixed(v: number | null | undefined, digits: number): string {
  return v == null || !Number.isFinite(v) ? '--' : v.toFixed(digits)
}

/** ミリ秒を m:ss / h:mm:ss に整形 */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
