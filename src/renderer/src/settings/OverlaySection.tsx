import { useEffect, useState } from 'react'
import type { DetectedZwiftEnv, DisplayInfo } from '@shared/types/ipc'
import type { MetricsSnapshot } from '@shared/types/metrics'
import type { AppSettings } from '@shared/types/settings'
import { StatusDot } from '@renderer/components/StatusDot'
import { fmtDuration, fmtFixed, fmtInt } from '@renderer/lib/format'
import { useAppStore } from '@renderer/stores/appStore'
import { Button, Section } from './ui'

export function OverlaySection({ settings }: { settings: AppSettings }): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const mode = useAppStore((s) => s.mode)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])

  useEffect(() => {
    void window.overlayApi.listDisplays().then(setDisplays)
  }, [])

  return (
    <Section
      title="オーバーレイ"
      description="Zwift は「ボーダーレスウィンドウ」または「ウィンドウ」モードで起動してください（排他的フルスクリーンでは重ねて表示できません）。"
      actions={
        <Button variant="primary" onClick={() => void window.overlayApi.toggleMode()}>
          {mode === 'locked' ? '編集モードにする' : 'ロックする'}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/60">表示するディスプレイ</span>
          <select
            value={settings.overlay.displayId ?? ''}
            onChange={(e) =>
              void updateSettings({ overlay: { displayId: e.target.value === '' ? null : Number(e.target.value) } })
            }
            className="rounded-lg border border-white/15 bg-[#121826] px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
          >
            <option value="">プライマリディスプレイ</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}（{d.width}×{d.height}
                {d.primary ? '・プライマリ' : ''}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/60">グリッド間隔（編集時のスナップ）</span>
          <select
            value={settings.overlay.gridSize}
            onChange={(e) => void updateSettings({ overlay: { gridSize: Number(e.target.value) } })}
            className="rounded-lg border border-white/15 bg-[#121826] px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
          >
            {[1, 5, 10, 20].map((g) => (
              <option key={g} value={g}>
                {g === 1 ? 'スナップなし' : `${g} px`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/60">Zwift 起動時の動作</span>
          <select
            value={settings.overlay.launchBehavior ?? 'ask'}
            onChange={(e) =>
              void updateSettings({
                overlay: { launchBehavior: e.target.value as 'ask' | 'auto' | 'always' }
              })
            }
            className="rounded-lg border border-white/15 bg-[#121826] px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
          >
            <option value="ask">Zwift 起動時にオーバーレイを起動するか確認する (Ask)</option>
            <option value="auto">Zwift 起動時に自動でオーバーレイを表示する</option>
            <option value="always">常にオーバーレイを表示する（Zwift 未起動時も表示）</option>
          </select>
        </label>

        <span className="pb-2 text-sm text-white/50">
          現在:{' '}
          <span className={mode === 'edit' ? 'text-sky-300' : 'text-emerald-300'}>
            {mode === 'edit' ? '編集モード' : 'ロック中（クリックスルー）'}
          </span>
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-3">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={settings.overlay.autoCloseWithZwift ?? true}
            onChange={(e) => void updateSettings({ overlay: { autoCloseWithZwift: e.target.checked } })}
            className="h-4 w-4 rounded accent-orange-500"
          />
          <div>
            <div className="text-sm font-medium text-white">
              Zwift アプリ（ZwiftApp.exe）終了時にオーバーレイも自動的にオフにする
            </div>
            <div className="text-xs text-white/50">
              ON にすると、ライドを終えて Zwift 本体を閉じた瞬間にオーバーレイと設定ウィンドウを自動的にオフ（非表示の待機状態）に切り替えます。
            </div>
          </div>
        </label>

        <div className="border-t border-white/10 pt-2.5">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={settings.overlay.quitOnSettingsClose ?? false}
              onChange={(e) => void updateSettings({ overlay: { quitOnSettingsClose: e.target.checked } })}
              className="h-4 w-4 rounded accent-orange-500"
            />
            <div>
              <div className="text-sm font-medium text-white">
                設定ウィンドウを閉じたときにアプリ（Electron）自体も終了する
              </div>
              <div className="text-xs text-white/50">
                ON にすると、設定ウィンドウの × ボタンで閉じたときにオーバーレイごとアプリを完全に終了します（OFF の場合はシステムトレイに常駐してオーバーレイを継続します）。
              </div>
            </div>
          </label>
        </div>

        <div className="border-t border-white/10 pt-2.5">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={settings.overlay.runAtLogin ?? true}
              onChange={(e) => void updateSettings({ overlay: { runAtLogin: e.target.checked } })}
              className="h-4 w-4 rounded accent-orange-500"
            />
            <div>
              <div className="text-sm font-medium text-white">
                Windows ログオン時にバックグラウンド（システムトレイ）で自動待機する（PowerShell 起動不要）
              </div>
              <div className="text-xs text-white/50">
                ON にすると Windows スタートアップとデスクトップにショートカットが作成され、普段は画面に何も出さずトレイで静かに待機し、Zwift を立ち上げた瞬間に「Zwift Overlay を起動しますか？」と確認ダイアログを表示します。
              </div>
            </div>
          </label>
        </div>
      </div>
    </Section>
  )
}

export function DataSourceSection({
  settings,
  metrics
}: {
  settings: AppSettings
  metrics: MetricsSnapshot | null
}): React.JSX.Element {
  const api = window.overlayApi
  const updateSettings = useAppStore((s) => s.updateSettings)
  const ds = settings.dataSource
  const opts = ds.options ?? {}

  const [envInfo, setEnvInfo] = useState<DetectedZwiftEnv | null>(null)
  const [host, setHost] = useState(typeof opts.host === 'string' ? opts.host : '127.0.0.1')
  const [port, setPort] = useState(typeof opts.port === 'number' ? String(opts.port) : '7878')
  const [sauceUrl, setSauceUrl] = useState(typeof opts.baseUrl === 'string' ? opts.baseUrl : 'http://127.0.0.1:1080')
  const [zwiftDir, setZwiftDir] = useState(
    typeof opts.zwiftDir === 'string'
      ? opts.zwiftDir
      : typeof opts.logPath === 'string'
        ? opts.logPath
        : ''
  )
  const [username, setUsername] = useState(typeof opts.username === 'string' ? opts.username : '')
  const [password, setPassword] = useState(typeof opts.password === 'string' ? opts.password : '')
  const [playerId, setPlayerId] = useState(
    typeof opts.playerId === 'number' && opts.playerId > 0 ? String(opts.playerId) : ''
  )

  const [logFilePath, setLogFilePath] = useState('')
  const [logEntries, setLogEntries] = useState<{ timestamp: string; level: string; tag: string; message: string }[]>(
    []
  )
  const [showLogs, setShowLogs] = useState(true)

  useEffect(() => {
    void window.overlayApi.detectZwiftEnv().then(setEnvInfo)
    void window.overlayApi.getDebugLogs().then((info) => {
      setLogFilePath(info.filePath)
      setLogEntries(info.entries.slice(-60))
    })
    return window.overlayApi.onDebugLogEntry((entry) => {
      setLogEntries((prev) => [...prev.slice(-59), entry])
    })
  }, [])

  useEffect(() => {
    setHost(typeof opts.host === 'string' ? opts.host : '127.0.0.1')
    setPort(typeof opts.port === 'number' ? String(opts.port) : '7878')
    setSauceUrl(typeof opts.baseUrl === 'string' ? opts.baseUrl : 'http://127.0.0.1:1080')
    setZwiftDir(
      typeof opts.zwiftDir === 'string'
        ? opts.zwiftDir
        : typeof opts.logPath === 'string'
          ? opts.logPath
          : ''
    )
    setUsername(typeof opts.username === 'string' ? opts.username : '')
    setPassword(typeof opts.password === 'string' ? opts.password : '')
    setPlayerId(typeof opts.playerId === 'number' && opts.playerId > 0 ? String(opts.playerId) : '')
  }, [opts.host, opts.port, opts.baseUrl, opts.zwiftDir, opts.logPath, opts.username, opts.password, opts.playerId])

  const changeSource = (id: string): void => {
    if (id === 'zwift-api') {
      void updateSettings({
        dataSource: {
          id,
          options: {
            username: username.trim(),
            password,
            playerId: Number(playerId) || (envInfo?.playerId ?? 0),
            pollMs: 1500
          }
        }
      })
    } else if (id === 'sauce-ws') {
      void updateSettings({
        dataSource: {
          id,
          options: { baseUrl: sauceUrl || 'http://127.0.0.1:1080', pollMs: 250 }
        }
      })
    } else if (id === 'zwift-udp') {
      void updateSettings({
        dataSource: {
          id,
          options: { host: host || '127.0.0.1', port: Number(port) || 7878 }
        }
      })
    } else if (id === 'zwift-log') {
      void updateSettings({
        dataSource: {
          id,
          options: { zwiftDir, pollMs: 500 }
        }
      })
    } else if (id === 'zwift-fit-replay') {
      void updateSettings({
        dataSource: {
          id,
          options: { zwiftDir, intervalMs: 1000 }
        }
      })
    } else {
      void updateSettings({
        dataSource: {
          id: 'mock',
          options: { intervalMs: 1000 }
        }
      })
    }
  }

  const commitApiConfig = (): void => {
    void updateSettings({
      dataSource: {
        id: 'zwift-api',
        options: {
          username: username.trim(),
          password,
          playerId: Number(playerId) || 0,
          pollMs: 1500
        }
      }
    })
  }

  const commitSauceConfig = (): void => {
    void updateSettings({
      dataSource: {
        id: 'sauce-ws',
        options: {
          baseUrl: sauceUrl.trim() || 'http://127.0.0.1:1080',
          pollMs: 250
        }
      }
    })
  }

  const commitUdpConfig = (): void => {
    const p = Math.min(65535, Math.max(1024, Math.round(Number(port) || 7878)))
    setPort(String(p))
    void updateSettings({
      dataSource: {
        id: 'zwift-udp',
        options: { host: host.trim() || '127.0.0.1', port: p }
      }
    })
  }

  const commitZwiftDirConfig = (): void => {
    void updateSettings({
      dataSource: {
        id: ds.id,
        options: { zwiftDir: zwiftDir.trim(), pollMs: 500, intervalMs: 1000 }
      }
    })
  }

  const cells: [string, string][] = [
    ['パワー', `${fmtInt(metrics?.power)} W`],
    ['3秒平均', `${fmtInt(metrics?.power3s)} W`],
    ['5秒ベスト', `${fmtInt(metrics?.power5s)} W`],
    ['1分ベスト', `${fmtInt(metrics?.power1m)} W`],
    ['5分ベスト', `${fmtInt(metrics?.power5m)} W`],
    ['20分ベスト', `${fmtInt(metrics?.power20m)} W`],
    ['NP', `${fmtInt(metrics?.normalizedPower)} W`],
    ['W/kg', fmtFixed(metrics?.wkg, 2)],
    ['心拍', `${fmtInt(metrics?.heartRate)} bpm`],
    ['ケイデンス', `${fmtInt(metrics?.cadence)} rpm`],
    ['ライド時間', fmtDuration(metrics?.rideElapsedMs ?? 0)]
  ]

  return (
    <Section
      title="データソース / ライド"
      description="Zwift ライブ通信（Sauce 方式の Relay API / Protobuf 取得）でリアルタイムの走行データと周囲ライダー情報を取得します。"
      actions={
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => void api.markLap()}>ラップ</Button>
          <Button variant="danger" onClick={() => void api.resetRide()}>
            ライドをリセット
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-white/60">データ取得モード</span>
          <select
            value="zwift-api"
            onChange={(e) => changeSource(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#121826] px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
          >
            <option value="zwift-api">方式B-1: Zwift ライブ通信 (Relay API / Sauce方式・遅延ゼロ)</option>
          </select>
        </label>

        {true && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">観戦用 Zwift メールアドレス</span>
              <input
                type="email"
                placeholder="monitor@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={commitApiConfig}
                onKeyDown={(e) => e.key === 'Enter' && commitApiConfig()}
                className="w-56 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">パスワード</span>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={commitApiConfig}
                onKeyDown={(e) => e.key === 'Enter' && commitApiConfig()}
                className="w-40 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">
                対象 Player ID（空欄で自動: {envInfo?.playerId ?? '未検出'}）
              </span>
              <input
                type="number"
                placeholder={envInfo?.playerId ? String(envInfo.playerId) : '123456'}
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                onBlur={commitApiConfig}
                onKeyDown={(e) => e.key === 'Enter' && commitApiConfig()}
                className="w-36 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white tabular-nums outline-none focus:border-orange-400"
              />
            </label>
            <Button variant="primary" onClick={commitApiConfig}>
              接続する
            </Button>
          </>
        )}

        {ds.id === 'sauce-ws' && (
          <label className="flex min-w-64 flex-1 flex-col gap-1.5">
            <span className="text-sm text-white/60">Sauce4Zwift ローカル URL</span>
            <input
              type="text"
              value={sauceUrl}
              onChange={(e) => setSauceUrl(e.target.value)}
              onBlur={commitSauceConfig}
              onKeyDown={(e) => e.key === 'Enter' && commitSauceConfig()}
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
            />
          </label>
        )}

        {ds.id === 'zwift-udp' && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">待受ホスト</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                onBlur={commitUdpConfig}
                onKeyDown={(e) => e.key === 'Enter' && commitUdpConfig()}
                className="w-36 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-white/60">UDP ポート</span>
              <input
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onBlur={commitUdpConfig}
                onKeyDown={(e) => e.key === 'Enter' && commitUdpConfig()}
                className="w-28 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white tabular-nums outline-none focus:border-orange-400"
              />
            </label>
            <Button onClick={() => void api.sendTestUdpPacket()}>テストパケットを送信</Button>
          </>
        )}

        {(ds.id === 'zwift-log' || ds.id === 'zwift-fit-replay') && (
          <label className="flex min-w-72 flex-1 flex-col gap-1.5">
            <span className="text-sm text-white/60">
              Zwift データフォルダ（自動検出: {envInfo?.zwiftDir ?? 'AppData\\Local\\Zwift'}）
            </span>
            <input
              type="text"
              placeholder={envInfo?.zwiftDir ?? 'C:\\Users\\<User>\\AppData\\Local\\Zwift'}
              value={zwiftDir}
              onChange={(e) => setZwiftDir(e.target.value)}
              onBlur={commitZwiftDirConfig}
              onKeyDown={(e) => e.key === 'Enter' && commitZwiftDirConfig()}
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-orange-400"
            />
          </label>
        )}
      </div>

      {ds.id === 'zwift-api' && (
        <div className="mb-3 rounded-lg border border-white/10 bg-black/25 px-3.5 py-2.5 text-xs text-white/65">
          <div>
            Sauce for Zwift と同じ方式です。観戦用（Monitor）のサブアカウント（課金不要の無料アカウントでOK。※メインと同じアカウントを使うと Zwift 側の同時ログイン制限で片方が切断されることがあるため別アカウント推奨）で Zwift 公式 Relay サーバーへ認証し、メインアカウント（自動検出 Player ID: <code className="text-emerald-300">{envInfo?.playerId ?? '未検出'}</code>）の <code className="text-sky-300">PlayerState</code> と周囲の <code className="text-sky-300">DropIn</code> ライダー情報をリアルタイム取得します。
          </div>
        </div>
      )}

      <div className="mb-3 text-sm">
        {metrics ? <StatusDot status={metrics.source.status} label={metrics.source.name} /> : '読み込み中…'}
        {metrics?.source.status.state === 'error' && (
          <span className="ml-2 text-xs text-red-300">({metrics.source.status.message})</span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-2">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-black/30 px-3 py-2">
            <div className="text-xs text-white/50">{k}</div>
            <div className="font-semibold text-white tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {/* デバッグログパネル */}
      <div className="mt-4 rounded-xl border border-white/10 bg-black/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white/80">デバッグログ</span>
            {logFilePath && <code className="text-[11px] text-white/45">{logFilePath}</code>}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowLogs((v) => !v)}>{showLogs ? 'ログを隠す' : 'ログを表示'}</Button>
            <Button onClick={() => void api.openDebugLogFile()}>ログフォルダを開く</Button>
            <Button
              onClick={() => {
                void api.clearDebugLogs()
                setLogEntries([])
              }}
            >
              クリア
            </Button>
          </div>
        </div>

        {showLogs && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-black/50 p-2 font-mono text-[11px] leading-relaxed">
            {logEntries.length === 0 ? (
              <div className="text-white/35">ログはまだありません</div>
            ) : (
              logEntries.map((e, idx) => (
                <div
                  key={idx}
                  className={
                    e.level === 'ERROR'
                      ? 'text-red-300'
                      : e.level === 'WARN'
                        ? 'text-amber-300'
                        : e.level === 'INFO'
                          ? 'text-sky-200'
                          : 'text-white/65'
                  }
                >
                  <span className="text-white/40">{e.timestamp}</span> [{e.level}] [{e.tag}] {e.message}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
