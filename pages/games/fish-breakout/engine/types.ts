/**
 * 鱼群突围 — 核心类型定义
 *
 * 与 Vue/DOM 完全无关，供 Engine / 生成器 / Solver 复用，
 * 后续小程序版可直接移植本目录。
 */

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

export type FishStatus = 'ACTIVE' | 'EXITING'

export interface Fish {
  id: string
  row: number
  col: number
  /** 固定朝向，鱼不能转向 */
  direction: Direction
  status: FishStatus
}

export interface BoardState {
  rows: number
  cols: number
  fishes: Fish[]
  /** 生成器给出的一个合法移除顺序（开发/调试用） */
  solutionOrder: string[]
}

export type GameStatus = 'ready' | 'playing' | 'transitioning' | 'finished'

export interface GameState {
  status: GameStatus
  /** 整局结束时间戳（Date.now() + 30000） */
  endTime: number
  /** 已完整清空的鱼池数 */
  clearedPools: number
  /** 成功放生鱼数（含未清空池中已放生的） */
  releasedFish: number
  /** 失误次数 */
  mistakes: number
  currentBoard: BoardState | null
}

export interface PoolResult {
  clearedPools: number
  releasedFish: number
  mistakes: number
  /** 准确率 = releasedFish / (releasedFish + mistakes) */
  accuracy: number
  /** 实际总用时（毫秒，结算时刻 - 开始时刻） */
  duration: number
  /** 结束方式：timeout=30 秒到正常结束；mistakes=失误达上限提前结束 */
  endedBy: 'timeout' | 'mistakes'
}

/** 难度档：达到 minPools 个已清空池数后启用 */
export interface DifficultySpec {
  minPools: number
  /** 单池鱼数随机范围 [min, max] */
  fishCount: [number, number]
  /** 开局可直接离开鱼的最大占比（软约束，越低越难） */
  maxInitialFreeRatio: number
}
