import type { DataSource, DataSourceContext, DataSourceFactory } from './DataSource'
import { MockDataSource, parseMockOptions } from './sources/mock/MockDataSource'
import { parseSauceWsOptions, SauceWsDataSource } from './sources/zwiftApi/SauceWsDataSource'
import { parseZwiftApiOptions, ZwiftApiDataSource } from './sources/zwiftApi/ZwiftApiDataSource'
import { parseZwiftFitReplayOptions, ZwiftFitReplayDataSource } from './sources/zwiftLog/ZwiftFitReplayDataSource'
import { parseZwiftLogOptions, ZwiftLogDataSource } from './sources/zwiftLog/ZwiftLogDataSource'
import { parseZwiftUdpOptions, ZwiftUdpDataSource } from './sources/zwiftUdp/ZwiftUdpDataSource'

interface SourceEntry {
  id: string
  displayName: string
  factory: DataSourceFactory
}

/**
 * 利用可能なデータソースの登録簿。
 */
const SOURCES: SourceEntry[] = [
  {
    id: 'zwift-api',
    displayName: 'Zwift ライブ通信 (Relay API / Sauce方式・遅延ゼロ)',
    factory: (options, ctx) => new ZwiftApiDataSource(parseZwiftApiOptions(options), ctx)
  },
  {
    id: 'zwift-udp',
    displayName: 'ローカル UDP 受信 (127.0.0.1:7878 / パケットブリッジ)',
    factory: (options, ctx) => new ZwiftUdpDataSource(parseZwiftUdpOptions(options), ctx)
  },
  {
    id: 'sauce-ws',
    displayName: 'Sauce4Zwift ローカル API 連携 (localhost:1080)',
    factory: (options, ctx) => new SauceWsDataSource(parseSauceWsOptions(options), ctx)
  },
  {
    id: 'zwift-log',
    displayName: 'Zwift ローカルファイル監視 (AppData\\Local\\Zwift: FIT + Log.txt)',
    factory: (options, ctx) => new ZwiftLogDataSource(parseZwiftLogOptions(options), ctx)
  },
  {
    id: 'zwift-fit-replay',
    displayName: 'Zwift 実ライド記録リプレイ (Activities\\*.fit 再生)',
    factory: (options, ctx) => new ZwiftFitReplayDataSource(parseZwiftFitReplayOptions(options), ctx)
  },
  {
    id: 'mock',
    displayName: 'モックデータ（シミュレーション）',
    factory: (options, ctx) => new MockDataSource(parseMockOptions(options), ctx)
  }
]

export function createDataSource(id: string, options: unknown, ctx: DataSourceContext): DataSource {
  const entry = SOURCES.find((s) => s.id === id) ?? SOURCES[0]
  return entry.factory(options, ctx)
}

export function listDataSources(): { id: string; displayName: string }[] {
  return SOURCES.map(({ id, displayName }) => ({ id, displayName }))
}
