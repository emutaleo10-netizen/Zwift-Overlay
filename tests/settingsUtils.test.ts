import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, WIDGET_TYPES } from '@shared/defaults'
import { applySettingsPatch, normalizeSettings, rescaleWidgets } from '@shared/settingsUtils'

describe('settingsUtils', () => {
  it('壊れた設定でも既定値で補完する', () => {
    const s = normalizeSettings({ athlete: { ftp: 'abc', weightKg: 9999 }, widgets: 'x' })
    expect(s.athlete.ftp).toBe(DEFAULT_SETTINGS.athlete.ftp)
    expect(s.athlete.weightKg).toBe(200)
    expect(s.widgets.map((w) => w.type)).toEqual(WIDGET_TYPES)
  })

  it('部分パッチをマージし、範囲外の値を丸める', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { athlete: { ftp: 1000 }, shortcuts: { markLap: 'F9' } })
    expect(s.athlete.ftp).toBe(700)
    expect(s.athlete.weightKg).toBe(DEFAULT_SETTINGS.athlete.weightKg)
    expect(s.shortcuts.markLap).toBe('F9')
    expect(s.shortcuts.toggleMode).toBe(DEFAULT_SETTINGS.shortcuts.toggleMode)
  })

  it('解像度変更時にウィジェット座標を比例補正する', () => {
    const [w] = rescaleWidgets(
      [{ ...DEFAULT_SETTINGS.widgets[0], x: 960, y: 540, width: 200, height: 100 }],
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }
    )
    expect(w.x).toBe(1280)
    expect(w.y).toBe(720)
    expect(w.width).toBe(267)
    expect(w.height).toBe(133)
  })
})
