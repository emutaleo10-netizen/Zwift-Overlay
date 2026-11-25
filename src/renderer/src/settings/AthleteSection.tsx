import { useEffect, useState } from 'react'
import { LIMITS } from '@shared/defaults'
import { POWER_ZONES } from '@shared/zones'
import type { AthleteSettings } from '@shared/types/settings'
import { useAppStore } from '@renderer/stores/appStore'
import { Section } from './ui'

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onCommit
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = (): void => {
    const n = Number(text)
    if (!Number.isFinite(n) || text.trim() === '') {
      setText(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-white/60">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-32 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-lg font-semibold text-white tabular-nums outline-none focus:border-orange-400"
        />
        <span className="text-white/50">{unit}</span>
      </div>
      <span className="text-xs text-white/35">
        {min}〜{max} {unit}
      </span>
    </label>
  )
}

export function AthleteSection({ athlete }: { athlete: AthleteSettings }): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const ftpWkg = athlete.weightKg > 0 ? athlete.ftp / athlete.weightKg : 0

  return (
    <Section title="アスリート" description="W/kg とパワーゾーンの計算に使用します。入力欄からフォーカスを外すと保存されます。">
      <div className="flex flex-wrap items-start gap-8">
        <NumberField
          label="FTP"
          unit="W"
          value={athlete.ftp}
          min={LIMITS.ftp[0]}
          max={LIMITS.ftp[1]}
          step={1}
          onCommit={(ftp) => void updateSettings({ athlete: { ftp: Math.round(ftp) } })}
        />
        <NumberField
          label="体重"
          unit="kg"
          value={athlete.weightKg}
          min={LIMITS.weightKg[0]}
          max={LIMITS.weightKg[1]}
          step={0.1}
          onCommit={(weightKg) => void updateSettings({ athlete: { weightKg } })}
        />
        <NumberField
          label="W' (無酸素仕事容量)"
          unit="J"
          value={athlete.wPrime ?? 20000}
          min={LIMITS.wPrime[0]}
          max={LIMITS.wPrime[1]}
          step={500}
          onCommit={(wPrime) => void updateSettings({ athlete: { wPrime: Math.round(wPrime) } })}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-white/60">FTP W/kg</span>
          <span className="py-2 text-lg font-semibold text-white tabular-nums">{ftpWkg.toFixed(2)} W/kg</span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1.5 text-center text-xs">
        {POWER_ZONES.map((z) => (
          <div key={z.index} className="overflow-hidden rounded-lg bg-black/30">
            <div className="h-1.5" style={{ backgroundColor: z.color }} />
            <div className="px-1 py-2">
              <div className="font-semibold text-white">Z{z.index}</div>
              <div className="truncate text-white/50">{z.name}</div>
              <div className="mt-1 text-white/80 tabular-nums">
                {Math.round(z.min * athlete.ftp)}
                {Number.isFinite(z.max) ? `–${Math.round(z.max * athlete.ftp) - 1}` : '+'} W
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
