import type { ReactNode } from 'react'

export function Section({
  title,
  description,
  actions,
  children
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-white/50">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
}): React.JSX.Element {
  const styles = {
    default: 'bg-white/10 hover:bg-white/20 text-white',
    primary: 'bg-orange-500 hover:bg-orange-400 text-white font-semibold',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-200'
  }[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-orange-500' : 'bg-white/20'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}
