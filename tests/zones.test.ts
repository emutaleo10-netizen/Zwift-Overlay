import { describe, expect, it } from 'vitest'
import { getZone, POWER_ZONES } from '@shared/zones'

describe('getZone', () => {
  it('FTP 比に応じたゾーンを返す', () => {
    expect(getZone(100, 200)?.index).toBe(1) // 50%
    expect(getZone(110, 200)?.index).toBe(2) // 55%
    expect(getZone(170, 200)?.index).toBe(3) // 85%
    expect(getZone(200, 200)?.index).toBe(4) // 100%
    expect(getZone(230, 200)?.index).toBe(5) // 115%
    expect(getZone(280, 200)?.index).toBe(6) // 140%
    expect(getZone(400, 200)?.index).toBe(7) // 200%
  })

  it('ratio を含める', () => {
    expect(getZone(250, 200)?.ratio).toBeCloseTo(1.25)
  })

  it('値が無い、または FTP が不正な場合は null', () => {
    expect(getZone(null, 200)).toBeNull()
    expect(getZone(200, 0)).toBeNull()
    expect(getZone(Number.NaN, 200)).toBeNull()
  })

  it('ゾーン定義が連続している', () => {
    for (let i = 1; i < POWER_ZONES.length; i++) {
      expect(POWER_ZONES[i].min).toBe(POWER_ZONES[i - 1].max)
    }
  })
})
