import type { GroupNode, MapEntity, WorldState } from '@shared/types/metrics'
import type { AthleteSettings } from '@shared/types/settings'
import { sampleRouteByDistance, WORLD_TOTAL_DISTANCE_M } from '@shared/worldRoute'

export interface WorkoutStep {
  label: string
  durationSec: number
  /** FTP 比の目標強度 */
  ratio: number
}

export interface SimOutput {
  power: number
  heartRate: number
  cadence: number
  speed: number
  distance: number
  world: WorldState
}

interface NpcSpec {
  id: string
  label: string
  size: number
  isSelf: boolean
  /** 初期タイムギャップ（秒、負=前方、正=後方） */
  gapSec: number
  /** 基本パワー比率 */
  baseRatio: number
  ouPower: number
  power: number
  speedKph: number
}

function buildDefaultScenario(): WorkoutStep[] {
  const steps: WorkoutStep[] = [
    { label: 'Warm up', durationSec: 240, ratio: 0.5 },
    { label: 'Warm up', durationSec: 120, ratio: 0.65 },
    { label: 'Sweet spot', durationSec: 480, ratio: 0.9 },
    { label: 'Recovery', durationSec: 180, ratio: 0.55 }
  ]
  for (let i = 0; i < 5; i++) {
    steps.push({ label: `VO2 #${i + 1}`, durationSec: 180, ratio: 1.15 })
    steps.push({ label: 'Rest', durationSec: 120, ratio: 0.5 })
  }
  steps.push({ label: 'Endurance', durationSec: 420, ratio: 0.7 })
  steps.push({ label: 'Cool down', durationSec: 240, ratio: 0.45 })
  return steps
}

export const DEFAULT_SCENARIO: readonly WorkoutStep[] = buildDefaultScenario()

/** シード付き疑似乱数（mulberry32） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const REST_HR = 62
const MAX_HR = 188

export interface RideSimulatorOptions {
  seed?: number
  scenario?: readonly WorkoutStep[]
  getAthlete: () => AthleteSettings
}

/**
 * 実ライドらしい挙動を再現するシミュレーター。
 * - パワー: ワークアウトの目標値へ数秒で追従 + Ornstein-Uhlenbeck ノイズ + 時折のスプリント / 惰性走行
 * - 心拍: 強度に対する 1 次遅れ応答 + カーディアックドリフト
 * - ケイデンス: 強度と弱い相関 + ノイズ
 * - 速度: 平地・勾配の簡易物理モデル
 * - ワールド: コース周回座標・標高・勾配と、前後の集団ギャップ（Mind the Gap）
 */
export class RideSimulator {
  private readonly rand: () => number
  private readonly scenario: readonly WorkoutStep[]
  private readonly getAthlete: () => AthleteSettings

  private t = 0
  private stepIdx = 0
  private stepElapsed = 0
  private ratio = 0.4
  private ouPower = 0
  private ouCad = 0
  private hr = 75
  private speed = 0
  private distance = 0
  private sprintLeft = 0
  private coastLeft = 0
  private readonly groups: NpcSpec[]

  constructor(opts: RideSimulatorOptions) {
    this.rand = mulberry32(opts.seed ?? Date.now())
    this.scenario = opts.scenario ?? DEFAULT_SCENARIO
    this.getAthlete = opts.getAthlete
    this.groups = [
      { id: 'g-hd', label: 'HD', size: 1, isSelf: false, gapSec: -64, baseRatio: 0.52, ouPower: 0, power: 110, speedKph: 26 },
      { id: 'g-kp', label: 'KP', size: 1, isSelf: false, gapSec: -49, baseRatio: 0.72, ouPower: 0, power: 139, speedKph: 36 },
      { id: 'g-wh', label: 'WH', size: 1, isSelf: false, gapSec: -19, baseRatio: 0.58, ouPower: 0, power: 106, speedKph: 28 },
      { id: 'g-ms1', label: 'MS', size: 1, isSelf: false, gapSec: -3, baseRatio: 0.48, ouPower: 0, power: 95, speedKph: 24 },
      { id: 'g-self', label: '5', size: 5, isSelf: true, gapSec: 0, baseRatio: 0.85, ouPower: 0, power: 220, speedKph: 36 },
      { id: 'g-jp', label: 'JP', size: 1, isSelf: false, gapSec: 16, baseRatio: 0.68, ouPower: 0, power: 131, speedKph: 29 },
      { id: 'g-ms2', label: 'MS', size: 1, isSelf: false, gapSec: 61, baseRatio: 0.96, ouPower: 0, power: 213, speedKph: 39 }
    ]
  }

  get currentStep(): WorkoutStep {
    return this.scenario[this.stepIdx]
  }

  step(dtSec: number): SimOutput {
    const dt = Math.min(5, Math.max(0, dtSec))
    const { ftp, weightKg } = this.getAthlete()
    this.t += dt
    this.advanceScenario(dt)

    let target = this.currentStep.ratio
    this.updateEvents(dt, target)
    if (this.sprintLeft > 0) target = 1.9
    if (this.coastLeft > 0) target = 0

    // 目標強度への追従（上げは約 2.5 秒、下げは約 1.5 秒）
    const tau = target > this.ratio ? 2.5 : 1.5
    this.ratio += (target - this.ratio) * (1 - Math.exp(-dt / tau))

    // パワー: OU ノイズ（定常 SD 約 5.6%）+ 細かなペダリングのゆらぎ
    this.ouPower += -0.4 * this.ouPower * dt + 0.05 * Math.sqrt(dt) * this.gauss()
    let power = 0
    if (this.coastLeft <= 0) {
      power = ftp * this.ratio * (1 + this.ouPower) + this.gauss() * ftp * 0.015
      power = Math.max(0, power)
    }

    // ケイデンス
    this.ouCad += -0.3 * this.ouCad * dt + 1.5 * Math.sqrt(dt) * this.gauss()
    let cadence = 0
    if (this.coastLeft <= 0) {
      const base = this.sprintLeft > 0 ? 108 : clamp(82 + (this.ratio - 0.6) * 25, 70, 102)
      cadence = Math.max(0, base + this.ouCad)
    }

    // 心拍: 上昇は速く下降は遅い 1 次遅れ + ドリフト
    const effort = this.coastLeft > 0 ? 0 : Math.min(this.ratio, 1.5)
    const drift = Math.min(10, (this.t / 60) * 0.12)
    const hrTarget = REST_HR + (MAX_HR - REST_HR) * clamp(0.35 + 0.5 * effort, 0, 1) + drift
    const hrTau = hrTarget > this.hr ? 25 : 50
    this.hr += (hrTarget - this.hr) * (1 - Math.exp(-dt / hrTau)) + this.gauss() * 0.3 * Math.sqrt(dt)
    this.hr = clamp(this.hr, 40, 210)

    // 速度: 定常速度へ慣性を持って追従
    const vTarget = steadySpeed(power, weightKg + 9)
    this.speed += (vTarget - this.speed) * (1 - Math.exp(-dt / 8))
    this.distance += this.speed * dt

    const world = this.stepWorld(dt, Math.round(power), this.speed, ftp)

    return {
      power: Math.round(power),
      heartRate: Math.round(this.hr),
      cadence: Math.round(cadence),
      speed: this.speed,
      distance: this.distance,
      world
    }
  }

  private stepWorld(dt: number, selfPower: number, selfSpeedMs: number, ftp: number): WorldState {
    const selfPos = sampleRouteByDistance(this.distance)
    const selfSpeedKph = Math.max(12, Math.round(selfSpeedMs * 3.6))

    for (const g of this.groups) {
      if (g.isSelf) {
        g.gapSec = 0
        g.power = selfPower
        g.speedKph = selfSpeedKph
        continue
      }
      g.ouPower += -0.35 * g.ouPower * dt + 0.08 * Math.sqrt(dt) * this.gauss()
      // 時折 0W（足を止める）になるリアルな挙動
      const coast = g.id === 'g-hd' && Math.sin(this.t * 0.18) > 0.45
      const p = coast ? 0 : Math.max(0, Math.round(ftp * g.baseRatio * (1 + g.ouPower)))
      g.power = p
      const vMs = coast ? 4.5 : Math.max(4, steadySpeed(Math.max(60, p), 75))
      g.speedKph = Math.round(vMs * 3.6)

      // 自分との速度差と軽い平均回帰でタイムギャップが滑らかに変動する
      const baseGap =
        g.id === 'g-hd'
          ? -64
          : g.id === 'g-kp'
            ? -49
            : g.id === 'g-wh'
              ? -19
              : g.id === 'g-ms1'
                ? -3
                : g.id === 'g-jp'
                  ? 16
                  : 61
      const relSpeedFactor = (selfSpeedMs - vMs) * 0.08
      g.gapSec += ((baseGap - g.gapSec) * 0.04 + relSpeedFactor + this.gauss() * 0.15) * dt
    }

    // 前方（gapSec が小さい順）にソート
    const sorted = [...this.groups].sort((a, b) => a.gapSec - b.gapSec)
    const nodes: GroupNode[] = sorted.map((g, idx) => {
      const prev = idx > 0 ? sorted[idx - 1] : null
      return {
        id: g.id,
        label: g.size > 1 ? String(g.size) : g.label,
        size: g.size,
        isSelf: g.isSelf,
        gapFromPrevSec: prev ? Math.max(1, Math.round(g.gapSec - prev.gapSec)) : 0,
        gapFromSelfSec: g.isSelf ? 0 : Math.round(g.gapSec),
        power: g.power,
        speedKph: g.speedKph
      }
    })

    // マップ上のライダー座標（タイムギャップ×約9m/sでコース上の前後位置に配置）
    const entities: MapEntity[] = sorted.map((g) => {
      const offsetM = -g.gapSec * 9.5
      const pos = sampleRouteByDistance(this.distance + offsetM)
      return {
        id: g.id,
        label: g.label,
        x: pos.x,
        y: pos.y,
        isSelf: g.isSelf
      }
    })

    // さらにコース全体に点在する背景ライダーを数名追加
    for (let i = 0; i < 6; i++) {
      const d = this.distance * 0.7 + (i + 1) * (WORLD_TOTAL_DISTANCE_M / 7)
      const pos = sampleRouteByDistance(d)
      entities.push({
        id: `ambient-${i}`,
        label: '',
        x: pos.x,
        y: pos.y,
        isSelf: false
      })
    }

    const visibleTotal = nodes.reduce((acc, n) => acc + n.size, 0)

    return {
      routeProgress: selfPos.progress,
      x: selfPos.x,
      y: selfPos.y,
      headingRad: selfPos.headingRad,
      altitudeM: Math.round(selfPos.altitudeM),
      gradePct: Math.round(selfPos.gradePct * 10) / 10,
      entities,
      groups: {
        totalAthletes: visibleTotal,
        aheadCount: 15,
        behindCount: 16,
        nodes
      }
    }
  }

  private advanceScenario(dt: number): void {
    this.stepElapsed += dt
    while (this.stepElapsed >= this.currentStep.durationSec) {
      this.stepElapsed -= this.currentStep.durationSec
      this.stepIdx = (this.stepIdx + 1) % this.scenario.length
    }
  }

  private updateEvents(dt: number, target: number): void {
    this.sprintLeft = Math.max(0, this.sprintLeft - dt)
    this.coastLeft = Math.max(0, this.coastLeft - dt)
    if (this.sprintLeft > 0 || this.coastLeft > 0) return
    const r = this.rand()
    if (target >= 0.6 && target <= 1.0 && r < 0.003 * dt) {
      this.sprintLeft = 6 + this.rand() * 8
    } else if (target < 0.8 && r > 1 - 0.004 * dt) {
      this.coastLeft = 3 + this.rand() * 6
    }
  }

  /** Box-Muller 法による標準正規乱数 */
  private gauss(): number {
    const u = 1 - this.rand()
    const v = this.rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** P = v (Crr m g + 0.5 rho CdA v^2) をニュートン法で解く */
export function steadySpeed(power: number, massKg: number): number {
  if (power <= 0) return 0
  const a = 0.5 * 1.2 * 0.32
  const b = 0.004 * massKg * 9.81
  let v = 10
  for (let i = 0; i < 20; i++) {
    const f = a * v ** 3 + b * v - power
    const df = 3 * a * v ** 2 + b
    v -= f / df
  }
  return Math.max(0, v)
}
