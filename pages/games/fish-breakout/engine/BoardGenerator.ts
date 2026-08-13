/**
 * 鱼群突围 — 可解棋盘生成器
 *
 * 采用「逆向构造」保证每个生成棋盘必然存在完整解：
 * 1. 先随机生成一个移除顺序 solutionOrder（即玩家可依次放生的顺序）；
 * 2. 按 solutionOrder 的逆序逐条放鱼，约束：当前鱼朝向前方路径内
 *    不得已有已放置的格（已放置 = 在它之后才离开的鱼）；
 * 3. 归纳可证：轮到某鱼离开时，前方只可能残留「更晚离开」的鱼，
 *    而这些鱼在其放置时就被要求不得占用该路径 → 该鱼必能离开，依此类推全部可清空。
 *
 * 难度软约束：开局可直接离开的鱼占比尽量不超过 maxInitialFreeRatio（越高越简单）。
 * 由于 solutionOrder[0] 放置时前方为空，任何棋盘至少存在 1 条开局可出鱼，
 * 因此该比例约束恒可实现，只做倾向性拒绝。
 */
import type { BoardState, Direction, Fish } from './types'

export interface BoardGeneratorConfig {
  rows: number
  cols: number
  fishCount: number
  /** 开局可直接离开鱼的最大占比（软约束） */
  maxInitialFreeRatio: number
}

const ALL_DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT']

const MAX_ATTEMPTS = 200

export class BoardGenerator {
  constructor(private cfg: BoardGeneratorConfig) {}

  generate(): BoardState {
    // 有界重试：优先返回满足难度软约束的棋盘；若始终无法满足，返回重试中出现的最优（可解）棋盘兜底
    let best: BoardState | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const board = this.tryGenerate()
      if (!board) continue
      if (this.meetsRatio(board)) return board
      if (!best || this.ratioOf(board) < this.ratioOf(best)) best = board
    }
    if (best) return best
    throw new Error('无法生成可解棋盘')
  }

  private tryGenerate(): BoardState | null {
    const { rows, cols, fishCount } = this.cfg
    const occupied = new Set<number>()
    const fishes: Fish[] = []
    // 随机移除顺序
    const order = shuffle(Array.from({ length: fishCount }, (_, i) => `f${i}`))

    // 逆序放鱼：每条鱼的朝向前方路径必须无已占格
    for (let i = fishCount - 1; i >= 0; i--) {
      const id = order[i]
      const cell = this.pickCell(occupied)
      if (!cell) return null
      occupied.add(cell.row * cols + cell.col)
      fishes.push({ id, row: cell.row, col: cell.col, direction: cell.direction, status: 'ACTIVE' })
    }

    return { rows, cols, fishes, solutionOrder: order }
  }

  /** 开局可直接离开鱼的比例 */
  private ratioOf(board: BoardState): number {
    const free = board.fishes.filter((f) => this.fishIsFree(f, board.fishes)).length
    return free / board.fishes.length
  }

  private meetsRatio(board: BoardState): boolean {
    return this.ratioOf(board) <= this.cfg.maxInitialFreeRatio
  }

  /** 随机挑一个可放置的（位置 + 方向），要求其前方路径无已占格 */
  private pickCell(occupied: Set<number>): { row: number; col: number; direction: Direction } | null {
    const { rows, cols } = this.cfg
    const candidates: { row: number; col: number; direction: Direction }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (occupied.has(r * cols + c)) continue
        for (const dir of ALL_DIRECTIONS) {
          if (this.pathClear(r, c, dir, occupied)) {
            candidates.push({ row: r, col: c, direction: dir })
          }
        }
      }
    }
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  /** 自 (row,col) 沿 dir 到边界，路径内是否无已占格 */
  private pathClear(row: number, col: number, dir: Direction, occupied: Set<number>): boolean {
    const { rows, cols } = this.cfg
    let r = row
    let c = col
    for (;;) {
      switch (dir) {
        case 'UP':
          r--
          break
        case 'DOWN':
          r++
          break
        case 'LEFT':
          c--
          break
        case 'RIGHT':
          c++
          break
      }
      if (r < 0 || r >= rows || c < 0 || c >= cols) return true
      if (occupied.has(r * cols + c)) return false
    }
  }

  /** 鱼当前是否畅通（无任何阻挡，使用棋盘真实边界） */
  private fishIsFree(fish: Fish, fishes: Fish[]): boolean {
    let r = fish.row
    let c = fish.col
    for (;;) {
      switch (fish.direction) {
        case 'UP':
          r--
          break
        case 'DOWN':
          r++
          break
        case 'LEFT':
          c--
          break
        case 'RIGHT':
          c++
          break
      }
      if (r < 0 || r >= this.cfg.rows || c < 0 || c >= this.cfg.cols) return true
      if (fishes.some((f) => f.row === r && f.col === c)) return false
    }
  }
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
