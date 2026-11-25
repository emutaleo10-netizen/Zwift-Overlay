import { Fragment } from 'react'
import type { GroupNode } from '@shared/types/metrics'
import { WidgetShell, type WidgetProps } from './WidgetShell'

function formatGap(sec: number): string {
  const sign = sec < 0 ? '-' : '+'
  const abs = Math.abs(Math.round(sec))
  if (abs >= 60) {
    const m = Math.floor(abs / 60)
    const s = abs % 60
    return `${sign}${m}m ${s}s`
  }
  return `${sign}${abs}s`
}

/**
 * 1枚目の画像（Mind the Gap）を忠実に再現したグループギャップウィジェット。
 * - 最上部に "11 ATHLETES" ピル、"+15 AHEAD"
 * - 中央に縦の黄緑コネクタ線で繋がれた円形ノード列（自分は青い発光サークル）
 * - 左側に自分基準のタイムギャップ（-1m 4s, -49s, -19s, -3s, +16s, +1m 1s）
 * - 右側に各ノードの W と kph
 * - 最下部に "+16 BEHIND"
 */
export function GroupsWidget({ config, metrics }: WidgetProps): React.JSX.Element {
  const groups = metrics?.world?.groups
  const nodes: GroupNode[] = groups?.nodes ?? []
  const scale = config.fontScale

  return (
    <WidgetShell config={config}>
      <div
        className="flex h-full w-full flex-col items-center justify-between px-3 py-3 select-none"
        style={{ fontSize: `${Math.round(13 * scale)}px` }}
      >
        {/* ヘッダーピル: 11 ATHLETES */}
        <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-1 text-[0.78em] font-bold tracking-wider text-white/90 uppercase shadow-inner">
          {groups?.totalAthletes ?? 11} ATHLETES
        </div>

        {/* +15 AHEAD */}
        <div className="mt-1 text-[0.75em] font-extrabold tracking-wider text-white uppercase">
          +{groups?.aheadCount ?? 15} AHEAD
        </div>

        {/* 縦タイムライン */}
        <div className="my-1 flex w-full flex-1 flex-col items-center justify-center overflow-hidden">
          {nodes.map((node, idx) => {
            // ギャップラベルは「自分以外のノード」について、自分より前ならノードの下側（自分寄り）、
            // 自分より後ろならノードの上側（自分寄り）のコネクタ横に表示する
            const prevNode = idx > 0 ? nodes[idx - 1] : null
            const gapLabel =
              idx === 0
                ? null
                : node.isSelf && prevNode
                  ? formatGap(prevNode.gapFromSelfSec)
                  : prevNode && prevNode.isSelf
                    ? formatGap(node.gapFromSelfSec)
                    : node.gapFromSelfSec < 0 && prevNode
                      ? formatGap(prevNode.gapFromSelfSec)
                      : formatGap(node.gapFromSelfSec)

            return (
              <Fragment key={node.id}>
                {/* ノード間のコネクタ線 + タイムギャップ表示 */}
                {idx > 0 && (
                  <div className="relative flex h-5 w-full items-center justify-center">
                    {/* 左側のタイムギャップ (-1m 4s ... ) */}
                    {gapLabel && (
                      <div className="absolute right-1/2 mr-3 flex items-center gap-1 whitespace-nowrap">
                        <span className="text-[1.05em] font-bold tracking-tight text-white">
                          {gapLabel}
                        </span>
                        <span className="text-[0.7em] tracking-widest text-white/40">···</span>
                      </div>
                    )}
                    {/* 中央の黄緑色縦ライン */}
                    <div
                      className="h-full w-[2.5px] rounded-full"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(163,230,53,0.85) 0%, rgba(190,242,100,0.95) 100%)'
                      }}
                    />
                  </div>
                )}

                {/* ノード本体（中央に丸、右にパワー＆速度） */}
                <div className="relative flex w-full items-center justify-center">
                  {node.isSelf ? (
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[4px] border-neutral-600/90 text-[1.15em] font-bold text-white shadow-[0_0_18px_rgba(14,165,233,0.65)]"
                      style={{
                        background:
                          'radial-gradient(circle at 50% 42%, #38bdf8 0%, #0284c7 58%, #1e3a8a 100%)'
                      }}
                    >
                      {node.label}
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3.5px] border-neutral-600/90 bg-neutral-200 text-[0.85em] font-bold tracking-tight text-neutral-900 shadow-md">
                      {node.label}
                    </div>
                  )}

                  {/* 右側のメトリクス (W / kph) */}
                  <div className="absolute left-1/2 ml-7 flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-[0.65em] tracking-widest text-white/35">···</span>
                    <div className="leading-tight">
                      <div className="text-[1.05em] font-bold text-white">
                        {node.power}
                        <span className="ml-0.5 text-[0.72em] font-normal text-white/75">w</span>
                      </div>
                      <div className="text-[0.8em] font-medium text-white/75">
                        {node.speedKph}
                        <span className="ml-0.5 text-[0.82em] font-normal text-white/55">kph</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Fragment>
            )
          })}
        </div>

        {/* +16 BEHIND */}
        <div className="text-[0.75em] font-extrabold tracking-wider text-white uppercase">
          +{groups?.behindCount ?? 16} BEHIND
        </div>
      </div>
    </WidgetShell>
  )
}
