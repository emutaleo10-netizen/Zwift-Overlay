import { WidgetShell, type WidgetProps } from './WidgetShell'

const CX = 100
const CY = 94
const RADIUS = 68
const START_DEG = 150
const SWEEP_DEG = 240

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  }
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg)
  const end = polarToCartesian(cx, cy, r, endDeg)
  const sweep = Math.max(0, endDeg - startDeg)
  const largeArcFlag = sweep > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

function getWBalColor(pct: number): string {
  if (pct > 50) return '#22c55e' // 緑：50%超
  if (pct > 20) return '#eab308' // 黄：20%超50%以下
  return '#ef4444' // 赤：20%以下
}

/**
 * W'bal（無酸素仕事容量の残量）をレーシングタコメーター式に表示するウィジェット。
 * - 240度アークゲージ + 目盛り + ゾーンカラーバンド + 回転ニードル
 * - 中央に残量 %、下部に残り kJ / 最大 kJ と現在の消費・回復ステータスを表示
 */
export function WBalWidget({ config, metrics, settings }: WidgetProps): React.JSX.Element {
  const fallbackCap = settings.athlete.wPrime ?? 20000
  const wBal = metrics?.wBal
  const pct = wBal ? Math.max(0, Math.min(100, wBal.pct)) : 100
  const joules = wBal ? wBal.joules : fallbackCap
  const capacityJ = wBal ? wBal.capacityJ : fallbackCap

  const power = metrics?.power
  const ftp = settings.athlete.ftp
  const isDepleting = power != null && power > ftp
  const isRecovering = power != null && power < ftp && pct < 99.5

  const color = getWBalColor(pct)
  const endDeg = START_DEG + (pct / 100) * SWEEP_DEG
  // ニードルは真上 (270度 = 50%) を 0度基準として -120度(0%) 〜 +120度(100%) に回転
  const needleDeg = -120 + (pct / 100) * 240

  // 目盛り生成 (0%〜100% を 10% 刻み、25% ごとに大目盛り)
  const ticks: { x1: number; y1: number; x2: number; y2: number; major: boolean; label?: string; lx?: number; ly?: number }[] = []
  for (let i = 0; i <= 20; i++) {
    const p = i * 5
    const deg = START_DEG + (p / 100) * SWEEP_DEG
    const major = p % 25 === 0
    const outer = polarToCartesian(CX, CY, RADIUS + 2, deg)
    const inner = polarToCartesian(CX, CY, RADIUS - (major ? 10 : 5), deg)
    const lblPos = major ? polarToCartesian(CX, CY, RADIUS - 20, deg) : undefined
    ticks.push({
      x1: outer.x,
      y1: outer.y,
      x2: inner.x,
      y2: inner.y,
      major,
      label: major ? `${p}` : undefined,
      lx: lblPos?.x,
      ly: lblPos?.y
    })
  }

  return (
    <WidgetShell config={config} accent={color}>
      <div className="hud-text flex h-full w-full flex-col justify-between px-3.5 py-2.5 select-none">
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.72em] font-semibold tracking-wider text-white/65 uppercase">
            W&apos;bal Gauge
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[0.62em] font-bold tracking-wider uppercase"
            style={{
              backgroundColor: isDepleting
                ? 'rgba(239, 68, 68, 0.25)'
                : isRecovering
                  ? 'rgba(16, 185, 129, 0.22)'
                  : 'rgba(255, 255, 255, 0.08)',
              color: isDepleting ? '#fca5a5' : isRecovering ? '#6ee7b7' : 'rgba(255,255,255,0.7)'
            }}
          >
            {isDepleting ? 'BURN' : isRecovering ? 'RECOVER' : 'READY'}
          </span>
        </div>

        {/* タコメーター SVG */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <svg viewBox="0 0 200 155" className="h-full w-full max-h-[165px]">
            <defs>
              <filter id="wbal-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* 背景トラックアーク (0% -> 100%) */}
            <path
              d={describeArc(CX, CY, RADIUS, START_DEG, START_DEG + SWEEP_DEG)}
              fill="none"
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth="11"
              strokeLinecap="round"
            />

            {/* レッドゾーン薄帯 (0% -> 20%) */}
            <path
              d={describeArc(CX, CY, RADIUS, START_DEG, START_DEG + SWEEP_DEG * 0.2)}
              fill="none"
              stroke="rgba(239, 68, 68, 0.28)"
              strokeWidth="11"
              strokeLinecap="butt"
            />

            {/* アクティブ残量アーク */}
            {pct > 0.5 && (
              <path
                d={describeArc(CX, CY, RADIUS, START_DEG, endDeg)}
                fill="none"
                stroke={color}
                strokeWidth="11"
                strokeLinecap="round"
                filter="url(#wbal-glow)"
                style={{ transition: 'stroke 300ms ease' }}
              />
            )}

            {/* 目盛り線と数値ラベル */}
            {ticks.map((t, idx) => (
              <g key={idx}>
                <line
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke={t.major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)'}
                  strokeWidth={t.major ? '2' : '1'}
                />
                {t.label && t.lx !== undefined && t.ly !== undefined && (
                  <text
                    x={t.lx}
                    y={t.ly + 3}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.55)"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {t.label}
                  </text>
                )}
              </g>
            ))}

            {/* タコメーター針（回転） */}
            <g
              transform={`translate(${CX}, ${CY}) rotate(${needleDeg.toFixed(1)})`}
              style={{ transition: 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            >
              {/* 針の影 */}
              <polygon points="0,-58 -3.5,10 3.5,10" fill="rgba(0,0,0,0.5)" transform="translate(0, 2)" />
              {/* 針本体 */}
              <polygon points="0,-58 -3,8 3,8" fill="#f8fafc" />
              <polygon points="0,-58 -1.8,-22 1.8,-22" fill={color} />
              {/* センターキャップ */}
              <circle r="8" fill="#1e293b" stroke="#f8fafc" strokeWidth="2.5" />
              <circle r="3" fill={color} />
            </g>

            {/* 下部中央デジタル数値 (%) */}
            <text
              x={CX}
              y={CY + 34}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="24"
              fontWeight="900"
              className="tabular-nums"
            >
              {wBal ? `${Math.round(pct)}%` : '--%'}
            </text>

            {/* kJ 残量表示 */}
            <text
              x={CX}
              y={CY + 51}
              textAnchor="middle"
              fill="rgba(255,255,255,0.68)"
              fontSize="11"
              fontWeight="600"
              className="tabular-nums"
            >
              {(joules / 1000).toFixed(1)} / {(capacityJ / 1000).toFixed(1)} kJ
            </text>
          </svg>
        </div>
      </div>
    </WidgetShell>
  )
}
