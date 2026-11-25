import { DEFAULT_SETTINGS, DEFAULT_WIDGETS, LIMITS, WIDGET_TYPES } from './defaults'
import type { AppSettings, SettingsPatch, WidgetConfig, WidgetType } from './types/settings'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function sanitizeWidget(raw: unknown, fallback: WidgetConfig): WidgetConfig {
  const r = isObj(raw) ? raw : {}
  return {
    id: fallback.id,
    type: fallback.type,
    visible: typeof r.visible === 'boolean' ? r.visible : fallback.visible,
    x: Math.round(num(r.x, fallback.x, 0)),
    y: Math.round(num(r.y, fallback.y, 0)),
    width: Math.round(num(r.width, fallback.width, LIMITS.widgetMinWidth)),
    height: Math.round(num(r.height, fallback.height, LIMITS.widgetMinHeight)),
    bgOpacity: num(r.bgOpacity, fallback.bgOpacity, LIMITS.bgOpacity[0], LIMITS.bgOpacity[1]),
    fontScale: num(r.fontScale, fallback.fontScale, LIMITS.fontScale[0], LIMITS.fontScale[1])
  }
}

/** 既知のウィジェット種別ごとに 1 つずつ揃える（不足分は既定値で補完） */
function sanitizeWidgets(raw: unknown, base: readonly WidgetConfig[]): WidgetConfig[] {
  const list = Array.isArray(raw) ? raw : []
  return WIDGET_TYPES.map((type: WidgetType) => {
    const fallback = base.find((w) => w.type === type) ?? DEFAULT_WIDGETS.find((w) => w.type === type)!
    const found = list.find((w) => isObj(w) && w.type === type)
    return sanitizeWidget(found ?? fallback, fallback)
  })
}

/** 保存済み JSON（不正値を含みうる）から完全な AppSettings を復元する */
export function normalizeSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS
  const r = isObj(raw) ? raw : {}
  const athlete = isObj(r.athlete) ? r.athlete : {}
  const overlay = isObj(r.overlay) ? r.overlay : {}
  const base = isObj(overlay.layoutBase) ? overlay.layoutBase : {}
  const shortcuts = isObj(r.shortcuts) ? r.shortcuts : {}
  const ds = isObj(r.dataSource) ? r.dataSource : {}

  return {
    schemaVersion: 1,
    athlete: {
      ftp: Math.round(num(athlete.ftp, d.athlete.ftp, ...LIMITS.ftp)),
      weightKg: Math.round(num(athlete.weightKg, d.athlete.weightKg, ...LIMITS.weightKg) * 10) / 10,
      wPrime: Math.round(num(athlete.wPrime, d.athlete.wPrime ?? 20000, ...LIMITS.wPrime))
    },
    dataSource: {
      id: str(ds.id, d.dataSource.id),
      options: isObj(ds.options) ? ds.options : { ...d.dataSource.options }
    },
    overlay: {
      displayId: typeof overlay.displayId === 'number' ? overlay.displayId : null,
      gridSize: Math.round(num(overlay.gridSize, d.overlay.gridSize, ...LIMITS.gridSize)),
      layoutBase: {
        width: num(base.width, d.overlay.layoutBase.width, 1),
        height: num(base.height, d.overlay.layoutBase.height, 1)
      },
      launchBehavior:
        overlay.launchBehavior === 'ask' || overlay.launchBehavior === 'auto' || overlay.launchBehavior === 'always'
          ? overlay.launchBehavior
          : (d.overlay.launchBehavior ?? 'ask'),
      mapTrailMode:
        overlay.mapTrailMode === 'full' ||
        overlay.mapTrailMode === '5m' ||
        overlay.mapTrailMode === '3m' ||
        overlay.mapTrailMode === 'off'
          ? overlay.mapTrailMode
          : (d.overlay.mapTrailMode ?? 'full'),
      autoCloseWithZwift:
        typeof overlay.autoCloseWithZwift === 'boolean'
          ? overlay.autoCloseWithZwift
          : (d.overlay.autoCloseWithZwift ?? true),
      quitOnSettingsClose:
        typeof overlay.quitOnSettingsClose === 'boolean'
          ? overlay.quitOnSettingsClose
          : (d.overlay.quitOnSettingsClose ?? false),
      runAtLogin: typeof overlay.runAtLogin === 'boolean' ? overlay.runAtLogin : (d.overlay.runAtLogin ?? true)
    },
    shortcuts: {
      toggleMode: str(shortcuts.toggleMode, d.shortcuts.toggleMode),
      markLap: str(shortcuts.markLap, d.shortcuts.markLap),
      openSettings: str(shortcuts.openSettings, d.shortcuts.openSettings)
    },
    widgets: sanitizeWidgets(r.widgets, d.widgets)
  }
}

export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const merged = {
    ...current,
    athlete: { ...current.athlete, ...patch.athlete },
    dataSource: patch.dataSource ?? current.dataSource,
    overlay: { ...current.overlay, ...patch.overlay },
    shortcuts: { ...current.shortcuts, ...patch.shortcuts },
    widgets: patch.widgets ?? current.widgets
  }
  return normalizeSettings(merged)
}

/** ディスプレイサイズの変化に合わせてウィジェット座標を比例補正し、画面内に収める */
export function rescaleWidgets(
  widgets: readonly WidgetConfig[],
  from: { width: number; height: number },
  to: { width: number; height: number }
): WidgetConfig[] {
  const sx = to.width / from.width
  const sy = to.height / from.height
  return widgets.map((w) => {
    const width = Math.min(to.width, Math.max(LIMITS.widgetMinWidth, Math.round(w.width * sx)))
    const height = Math.min(to.height, Math.max(LIMITS.widgetMinHeight, Math.round(w.height * sy)))
    return {
      ...w,
      width,
      height,
      x: Math.min(to.width - width, Math.max(0, Math.round(w.x * sx))),
      y: Math.min(to.height - height, Math.max(0, Math.round(w.y * sy)))
    }
  })
}
