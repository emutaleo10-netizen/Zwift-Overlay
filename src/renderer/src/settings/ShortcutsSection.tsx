import { useEffect, useState } from 'react'
import type { ShortcutStatus } from '@shared/types/ipc'
import type { ShortcutAction, ShortcutSettings } from '@shared/types/settings'
import { useAppStore } from '@renderer/stores/appStore'
import { Section } from './ui'

const LABELS: Record<ShortcutAction, string> = {
  toggleMode: 'ロック / 編集モードの切替',
  markLap: 'ラップを切る',
  openSettings: '設定画面を開く'
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'])

/** KeyboardEvent.code → Electron Accelerator のキー名 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  const map: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Backquote: '`',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec'
  }
  return map[code] ?? null
}

export function acceleratorFromEvent(e: KeyboardEvent): { accelerator?: string; error?: string } {
  if (MODIFIER_KEYS.has(e.key)) return {}
  const key = keyFromCode(e.code)
  if (!key) return { error: 'このキーは使用できません' }
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const isFn = /^F\d+$/.test(key)
  if (mods.length === 0 && !isFn) return { error: 'Ctrl / Alt / Shift のいずれかと組み合わせてください' }
  return { accelerator: [...mods, key].join('+') }
}

function Recorder({
  action,
  value,
  status
}: {
  action: ShortcutAction
  value: string
  status: ShortcutStatus | null
}): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    void window.overlayApi.setShortcutsSuspended(true)
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false)
        return
      }
      const r = acceleratorFromEvent(e)
      if (r.error) setHint(r.error)
      if (r.accelerator) {
        setRecording(false)
        setHint(null)
        void updateSettings({ shortcuts: { [action]: r.accelerator } as Partial<ShortcutSettings> })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void window.overlayApi.setShortcutsSuspended(false)
    }
  }, [recording, action, updateSettings])

  const st = status?.[action]
  const failed = st && !st.registered && st.accelerator === value && !recording

  return (
    <div className="flex items-center gap-4 py-3">
      <span className="w-56 shrink-0 text-sm text-white">{LABELS[action]}</span>
      <button
        type="button"
        onClick={() => {
          setHint(null)
          setRecording((r) => !r)
        }}
        className={`min-w-48 rounded-lg border px-3 py-1.5 text-left font-mono text-sm transition-colors ${
          recording
            ? 'animate-pulse border-orange-400 bg-orange-500/10 text-orange-200'
            : 'border-white/15 bg-black/30 text-white hover:border-white/30'
        }`}
      >
        {recording ? 'キーを押してください…（Esc で取消）' : value || '未設定'}
      </button>
      <span className="text-xs">
        {recording && hint && <span className="text-yellow-300">{hint}</span>}
        {failed && <span className="text-red-300">{st?.error}</span>}
        {st?.registered && st.accelerator === value && !recording && <span className="text-emerald-300">登録済み</span>}
      </span>
    </div>
  )
}

export function ShortcutsSection({
  shortcuts,
  status
}: {
  shortcuts: ShortcutSettings
  status: ShortcutStatus | null
}): React.JSX.Element {
  return (
    <Section
      title="グローバルショートカット"
      description="Zwift の操作中でも有効です。ボタンをクリックしてから新しいキーの組み合わせを押してください。"
    >
      <div className="divide-y divide-white/5">
        {(Object.keys(LABELS) as ShortcutAction[]).map((a) => (
          <Recorder key={a} action={a} value={shortcuts[a]} status={status} />
        ))}
      </div>
    </Section>
  )
}
