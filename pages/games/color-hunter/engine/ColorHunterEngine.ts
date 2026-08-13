/**
 * 颜色猎手引擎（纯 TS，无 wx 依赖）
 *
 * 规则（对齐《颜色猎手小程序prd_v3.docx》，替代 V2 三关制）：
 * - 固定 5×5 棋盘，一局 4 轮，每轮重新生成完整棋盘
 * - 每局 targetCounts = shuffle([4,5,6,7])，各用一次，完整通关固定正确点击 22 次
 * - 每轮目标颜色随机，但不能与上一轮相同（非相邻轮次可重复）
 * - 总用时 = endTime - startTime（真实时间戳差，错误无惩罚换算）
 * - 目标格数量精确，其余 3 色均衡填充（数量差 ≤1），目标色避免占满整行/整列
 */

export type HunterColor = '红' | '黄' | '蓝' | '绿'

export interface HunterCell {
  id: number
  color: HunterColor
  /** 目标色且已被正确点击 */
  found: boolean
}

export interface HunterResult {
  /** 总通关时间（毫秒） */
  totalTime: number
  /** 错误次数 */
  errors: number
  /** 正确点击数（完整通关固定 22） */
  correctCount: number
  /** 准确率 0~1 = 22 / (22 + errors) */
  accuracy: number
  /** 四轮分轮用时（毫秒） */
  roundTimes: number[]
}

export type ClickResult =
  | { type: 'hit' } // 正确点击，仍有剩余
  | { type: 'wrong' } // 错误点击
  | { type: 'none' } // 重复点击已找到格 / 未运行
  | { type: 'roundComplete'; nextRound: number } // 本轮完成，需页面过渡后 nextRound
  | { type: 'gameComplete'; result: HunterResult } // 整局完成

export const HUNTER_COLORS: HunterColor[] = ['红', '黄', '蓝', '绿']
export const HUNTER_GRID_SIZE = 5
/** 完整通关固定正确点击数（4+5+6+7） */
export const HUNTER_TOTAL_CORRECT = 22
/** 每局目标数量池：四种各出现一次，只随机顺序 */
const TARGET_COUNT_POOL = [4, 5, 6, 7]

const MAX_PATTERN_RETRY = 10

export class ColorHunterEngine {
  private state: 'idle' | 'running' | 'finished' = 'idle'
  private roundIndex = 0
  private targetCounts: number[] = []
  private grid: HunterCell[] = []
  private targetColor: HunterColor | null = null
  private previousTargetColor: HunterColor | null = null
  private targetCount = 0
  private remaining = 0
  private errors = 0
  private correctCount = 0

  private startTime = 0
  private endTime = 0
  private roundStartTime = 0
  private roundTimes: number[] = []
  private lastResult: HunterResult | null = null

  start(): void {
    this.state = 'running'
    this.roundIndex = 0
    this.targetCounts = shuffle(TARGET_COUNT_POOL)
    this.grid = []
    this.targetColor = null
    this.previousTargetColor = null
    this.targetCount = 0
    this.remaining = 0
    this.errors = 0
    this.correctCount = 0
    this.startTime = Date.now()
    this.endTime = 0
    this.roundStartTime = this.startTime
    this.roundTimes = []
    this.lastResult = null
    this.createRound(this.targetCounts[0])
  }

  isRunning(): boolean {
    return this.state === 'running'
  }

  isFinished(): boolean {
    return this.state === 'finished'
  }

  /** 当前轮次索引 0..3 */
  getRoundIndex(): number {
    return this.roundIndex
  }

  getTargetCounts(): number[] {
    return this.targetCounts
  }

  getGridSize(): number {
    return HUNTER_GRID_SIZE
  }

  getCells(): HunterCell[] {
    return this.grid
  }

  getTargetColor(): HunterColor | null {
    return this.targetColor
  }

  getTargetCount(): number {
    return this.targetCount
  }

  getRemaining(): number {
    return this.remaining
  }

  getErrors(): number {
    return this.errors
  }

  /** 当前总用时（运行中实时、含轮间过渡；结算后固定） */
  currentTotalTimeMs(): number {
    if (this.state === 'finished') return this.endTime - this.startTime
    if (this.state === 'running') return Date.now() - this.startTime
    return 0
  }

  /** 进入下一轮：轮次过渡结束后调用，重新生成完整棋盘 */
  nextRound(): void {
    this.roundIndex++
    this.roundStartTime = Date.now()
    this.createRound(this.targetCounts[this.roundIndex])
  }

  click(id: number): ClickResult {
    if (this.state !== 'running') return { type: 'none' }
    const cell = this.grid.find((c) => c.id === id)
    if (!cell || cell.found) return { type: 'none' }

    if (cell.color !== this.targetColor) {
      this.errors++
      return { type: 'wrong' }
    }

    // 正确点击
    cell.found = true
    this.correctCount++
    this.remaining--
    if (this.remaining > 0) return { type: 'hit' }

    // 本轮全部找到
    this.roundTimes.push(Date.now() - this.roundStartTime)
    if (this.roundIndex >= 3) {
      // Round 4 完成 → 整局结束（finish 幂等）
      this.state = 'finished'
      this.endTime = Date.now()
      return { type: 'gameComplete', result: this.calculateResult() }
    }
    return { type: 'roundComplete', nextRound: this.roundIndex + 2 }
  }

  /** 计算成绩（完整通关后由 click 内部调用；非完整通关页面直接作废，不调用） */
  finish(): HunterResult {
    if (this.lastResult) return this.lastResult
    return this.calculateResult()
  }

  // ────────────── 内部 ──────────────

  private calculateResult(): HunterResult {
    const result: HunterResult = {
      totalTime: this.endTime - this.startTime,
      errors: this.errors,
      correctCount: this.correctCount,
      accuracy:
        this.correctCount + this.errors > 0 ? this.correctCount / (this.correctCount + this.errors) : 0,
      roundTimes: [...this.roundTimes],
    }
    this.lastResult = result
    return result
  }

  /** 生成一轮：目标色（≠上一轮）+ 目标数量精确 + 其余 3 色均衡 + 防整行/整列，作为同一 roundState 一次性生成 */
  private createRound(targetCount: number): void {
    this.targetColor = this.pickTargetColor()
    this.targetCount = targetCount
    this.remaining = targetCount
    const total = HUNTER_GRID_SIZE * HUNTER_GRID_SIZE
    this.grid = this.buildGrid(HUNTER_GRID_SIZE, total, [{ color: this.targetColor, count: targetCount }])
  }

  /** 选目标色：非首轮从除上一轮以外的 3 色中直接随机（V3 §5） */
  private pickTargetColor(): HunterColor {
    if (this.previousTargetColor === null) {
      this.previousTargetColor = HUNTER_COLORS[randIndex(HUNTER_COLORS.length)]
      return this.previousTargetColor
    }
    const others = HUNTER_COLORS.filter((c) => c !== this.previousTargetColor)
    this.previousTargetColor = others[randIndex(others.length)]
    return this.previousTargetColor
  }

  /** 生成棋盘：目标色数量精确，其余颜色均匀分配（数量差 ≤1），目标色避免占满整行/整列 */
  private buildGrid(
    gridSize: number,
    total: number,
    targets: { color: HunterColor; count: number }[],
  ): HunterCell[] {
    for (let attempt = 0; attempt < MAX_PATTERN_RETRY; attempt++) {
      const colors = this.colorPool(total, targets)
      if (!this.hasFullRowOrColumn(gridSize, targets, colors)) {
        return colors.map((color, i) => ({ id: i, color, found: false }))
      }
    }
    // 重抽仍存在整行/整列则接受最后一次
    const colors = this.colorPool(total, targets)
    return colors.map((color, i) => ({ id: i, color, found: false }))
  }

  /** 构建颜色池：目标色精确计数，剩余颜色尽量均匀（数量差 ≤1） */
  private colorPool(total: number, targets: { color: HunterColor; count: number }[]): HunterColor[] {
    const targetCount = targets.reduce((s, t) => s + t.count, 0)
    const used = new Set(targets.map((t) => t.color))
    const restColors = HUNTER_COLORS.filter((c) => !used.has(c))

    const pool: HunterColor[] = []
    for (const t of targets) {
      for (let i = 0; i < t.count; i++) pool.push(t.color)
    }

    const rest = total - targetCount
    if (rest > 0 && restColors.length > 0) {
      const base = Math.floor(rest / restColors.length)
      const extra = rest % restColors.length
      const shuffled = shuffle(restColors)
      for (let i = 0; i < shuffled.length; i++) {
        const count = base + (i < extra ? 1 : 0)
        for (let k = 0; k < count; k++) pool.push(shuffled[i])
      }
    }
    return shuffle(pool)
  }

  /** 某目标色是否恰好占满整行或整列（视觉搜索价值低，触发重抽） */
  private hasFullRowOrColumn(
    gridSize: number,
    targets: { color: HunterColor; count: number }[],
    colors: HunterColor[],
  ): boolean {
    for (const t of targets) {
      const pos = new Set<number>()
      colors.forEach((c, i) => {
        if (c === t.color) pos.add(i)
      })
      for (let r = 0; r < gridSize; r++) {
        let full = true
        for (let c = 0; c < gridSize; c++) if (!pos.has(r * gridSize + c)) { full = false; break }
        if (full) return true
      }
      for (let c = 0; c < gridSize; c++) {
        let full = true
        for (let r = 0; r < gridSize; r++) if (!pos.has(r * gridSize + c)) { full = false; break }
        if (full) return true
      }
    }
    return false
  }
}

function randIndex(length: number): number {
  return Math.floor(Math.random() * length)
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}
