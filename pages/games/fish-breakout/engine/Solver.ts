/**
 * 鱼群突围 — Solver
 *
 * 用于验证棋盘可解性（开发环境批量测试 + debug 面板）。
 *
 * 判定逻辑：反复移除所有「当前可出」的鱼，直到棋盘清空或卡住。
 * 正确性：移除鱼只会让其他鱼更容易离开（清除路径），不会产生新的阻挡，
 * 因此「当前无可出鱼但仍有鱼」即为真死局（贪心对可解判定是完备的）。
 */
import type { BoardState, Fish } from './types'

/** 判定某鱼在 board 上当前能否离开（只有 ACTIVE 鱼参与阻挡） */
export function canExit(fish: Fish, fishes: Fish[], rows: number, cols: number): boolean {
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
    if (r < 0 || r >= rows || c < 0 || c >= cols) return true // 到达棋盘边界，畅通
    if (fishes.some((f) => f.status === 'ACTIVE' && f.row === r && f.col === c)) return false
  }
}

export class Solver {
  /** 尝试求解：可解则返回移除顺序，否则 solvable=false */
  solve(board: BoardState): { solvable: boolean; order: string[] } {
    const fishes: Fish[] = board.fishes.map((f) => ({ ...f, status: 'ACTIVE' }))
    const order: string[] = []

    let progress = true
    while (progress) {
      progress = false
      for (const f of fishes) {
        if (f.status !== 'ACTIVE') continue
        if (canExit(f, fishes, board.rows, board.cols)) {
          f.status = 'EXITING'
          order.push(f.id)
          progress = true
        }
      }
    }

    return { solvable: order.length === fishes.length, order }
  }
}
