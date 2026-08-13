/**
 * 极限捞鱼 — 游戏引擎（纯 TS，无 Vue/DOM 依赖）
 *
 * 核心规则（2026-08-13 调整后）：
 * - 5×5 鱼池，拖动撒网：矩形选区内含河豚 → 失败；含鱼 → 全捕；空 → 空网
 * - 计分 = 鱼数×10 + 密度奖励 + Combo 里程碑 + PERFECT NET
 * - 撒网成功或命中河豚 → 整盘随机重生成；空网 → 棋盘不变
 * - 河豚失误达上限 → 挑战失败提前结束；30 秒到 → 时间到
 */
import type {
  Cell,
  ExtremeFishingConfig,
  GameResult,
  ResolveResult,
  Selection,
} from './types'
import { BoardSpawner } from './BoardSpawner'
import { comboMilestoneBonus, densityBonus } from './ScoreCalculator'

interface EngineState {
  status: 'idle' | 'running' | 'finished'
  endTime: number
  score: number
  combo: number
  maxCombo: number
  caughtFish: number
  perfectCount: number
  pufferMistakes: number
  board: Cell[]
}

export class ExtremeFishingEngine {
  private state: EngineState = {
    status: 'idle',
    endTime: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    caughtFish: 0,
    perfectCount: 0,
    pufferMistakes: 0,
    board: [],
  }
  private spawner: BoardSpawner
  private awardedCombos = new Set<number>()
  private startTime = 0
  private endedBy: 'timeout' | 'puffer' = 'timeout'
  private lastResult: GameResult | null = null

  constructor(private cfg: ExtremeFishingConfig) {
    this.spawner = new BoardSpawner(cfg)
  }

  start(): void {
    this.startTime = Date.now()
    this.state = {
      status: 'running',
      endTime: this.startTime + this.cfg.durationMs,
      score: 0,
      combo: 0,
      maxCombo: 0,
      caughtFish: 0,
      perfectCount: 0,
      pufferMistakes: 0,
      board: this.spawner.generateBoard(0),
    }
    this.awardedCombos.clear()
    this.endedBy = 'timeout'
    this.lastResult = null
  }

  isRunning(): boolean {
    return this.state.status === 'running'
  }

  isFinished(): boolean {
    return this.state.status === 'finished'
  }

  remainingTimeMs(): number {
    if (this.state.status === 'finished') return 0
    return this.state.endTime - Date.now()
  }

  getState(): EngineState {
    return this.state
  }

  /** 返回选区覆盖的所有格子 */
  cellsInSelection(sel: Selection): Cell[] {
    const minR = Math.min(sel.startRow, sel.endRow)
    const maxR = Math.max(sel.startRow, sel.endRow)
    const minC = Math.min(sel.startCol, sel.endCol)
    const maxC = Math.max(sel.startCol, sel.endCol)
    return this.state.board.filter(
      (c) => c.row >= minR && c.row <= maxR && c.col >= minC && c.col <= maxC,
    )
  }

  /**
   * 结算一次撒网（松手调用）。逻辑先结算，视觉由页面异步播放。
   */
  resolveNet(sel: Selection): ResolveResult {
    if (this.state.status !== 'running') return { type: 'empty' }
    if (Date.now() >= this.state.endTime) {
      this.finish('timeout')
      return { type: 'empty' }
    }

    const cells = this.cellsInSelection(sel)
    const hasPuffer = cells.some((c) => c.type === 'PUFFER')
    if (hasPuffer) {
      // 河豚：本次 0 分 + 惩罚 + Combo 清零 + 失误 +1；达上限则提前结束，否则整盘重生成
      this.state.score = Math.max(0, this.state.score - this.cfg.pufferPenalty)
      this.state.combo = 0
      this.state.pufferMistakes++
      if (this.state.pufferMistakes >= this.cfg.pufferLimit) {
        this.finish('puffer')
      } else {
        this.state.board = this.spawner.generateBoard(Date.now() - this.startTime)
      }
      return { type: 'puffer', penalty: this.cfg.pufferPenalty }
    }

    const fish = cells.filter((c) => c.type === 'FISH')
    const fishCount = fish.length
    if (fishCount === 0) {
      // 空网：0 分，Combo 清零，棋盘不变
      this.state.combo = 0
      return { type: 'empty' }
    }

    // 成功：全捕 + 计分 + 整盘重生成
    const cellCount = cells.length
    const density = fishCount / cellCount
    const base = fishCount * this.cfg.scorePerFish
    const densityBonusVal = densityBonus(density, fishCount, this.cfg.densityBonusTiers)

    // PERFECT：选区内格子 ≥ perfectMinCells 且鱼占比 ≥ perfectMinDensity（鱼数向上取整等效）
    const perfect =
      cellCount >= this.cfg.perfectMinCells && density >= this.cfg.perfectMinDensity
    // Combo 只在连续 PERFECT 时累积；非 perfect 的成功撒网打断连击（清零）
    let comboBonusVal = 0
    if (perfect) {
      this.state.combo++
      if (this.state.combo > this.state.maxCombo) this.state.maxCombo = this.state.combo
      comboBonusVal = comboMilestoneBonus(
        this.state.combo,
        this.cfg.comboMilestones,
        this.awardedCombos,
      )
    } else {
      this.state.combo = 0
    }
    let gained = base + densityBonusVal + comboBonusVal
    if (perfect) gained += this.cfg.perfectBonus

    this.state.score += gained
    this.state.caughtFish += fishCount
    if (perfect) this.state.perfectCount++

    this.state.board = this.spawner.generateBoard(Date.now() - this.startTime)

    return { type: 'success', gained, fishCaught: fishCount, density, perfect, combo: this.state.combo }
  }

  /** 幂等结算 */
  finish(reason: 'timeout' | 'puffer' = 'timeout'): GameResult {
    if (this.state.status !== 'finished') {
      this.state.status = 'finished'
      this.endedBy = reason
    }
    if (this.lastResult) return this.lastResult
    this.lastResult = {
      score: this.state.score,
      caughtFish: this.state.caughtFish,
      perfectCount: this.state.perfectCount,
      maxCombo: this.state.maxCombo,
      pufferMistakes: this.state.pufferMistakes,
      duration: Date.now() - this.startTime,
      endedBy: this.endedBy,
    }
    return this.lastResult
  }
}
