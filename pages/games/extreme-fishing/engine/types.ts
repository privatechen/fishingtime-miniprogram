/**
 * 极限捞鱼 — 核心类型定义
 *
 * 与 Vue/DOM 无关，供 Engine / Spawner / ScoreCalculator 复用，
 * 后续可直接迁移到微信小程序。
 *
 * 交互规则（2026-08-13 调整）：
 * - 撒网成功（捕到鱼）→ 整盘随机重生成
 * - 空网（无鱼无河豚）→ 棋盘不变，Combo 清零
 * - 命中河豚 → 整盘重生成，河豚失误达上限则挑战失败结束
 * - 30 秒到 → 时间到正常结算
 */

export type CellType = 'EMPTY' | 'FISH' | 'PUFFER'

export interface Cell {
  id: string
  row: number
  col: number
  type: CellType
}

/** 拖动选区：轴对齐矩形（由 startCell 到 currentCell 决定） */
export interface Selection {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

export type ResolveResult =
  | { type: 'success'; gained: number; fishCaught: number; density: number; perfect: boolean; combo: number }
  | { type: 'empty' }
  | { type: 'puffer'; penalty: number }

export interface GameResult {
  score: number
  caughtFish: number
  perfectCount: number
  maxCombo: number
  pufferMistakes: number
  duration: number
  /** 结束方式：timeout=30 秒到；puffer=河豚失误达上限 */
  endedBy: 'timeout' | 'puffer'
}

/** 密度奖励档位：density ≥ minDensity 时附加 fishCount × factor */
export interface DensityBonusTier {
  minDensity: number
  factor: number
}

export interface ComboMilestone {
  combo: number
  bonus: number
}

/** 全部体验参数（试玩可调，不改引擎） */
export interface ExtremeFishingConfig {
  rows: number
  cols: number
  durationMs: number
  scorePerFish: number
  perfectBonus: number
  /** PERFECT 最低选区内格子数（< 该值不算 PERFECT） */
  perfectMinCells: number
  /** PERFECT 最低鱼占比（鱼数/格子数 ≥ 该值，等效鱼数向上取整） */
  perfectMinDensity: number
  pufferPenalty: number
  /** 河豚失误达到该次数本局提前结束 */
  pufferLimit: number
  comboMilestones: ComboMilestone[]
  densityBonusTiers: DensityBonusTier[]
  /** 每盘目标普通鱼数量 */
  targetFishCount: number
  /** 每盘河豚数量上限（随时间阶段递增） */
  maxPufferCount: number
}
