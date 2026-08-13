/**
 * 极限捞鱼 — 棋盘生成
 *
 * 每次撒网结算后整盘随机重生成（PRD 调整）：
 * - 固定 5×5，维持 targetFishCount 条普通鱼
 * - 河豚数量随整局进度从 1 递增到 maxPufferCount（后期更危险）
 */
import type { Cell, ExtremeFishingConfig } from './types'

export class BoardSpawner {
  constructor(private cfg: ExtremeFishingConfig) {}

  /** 生成整盘：目标鱼数 + 按进度递增的河豚 */
  generateBoard(elapsedMs: number): Cell[] {
    const cells: Cell[] = []
    for (let r = 0; r < this.cfg.rows; r++) {
      for (let c = 0; c < this.cfg.cols; c++) {
        cells.push({ id: `${r}-${c}`, row: r, col: c, type: 'EMPTY' })
      }
    }

    const pufferCount = this.pufferCountFor(elapsedMs)
    const indices = shuffle(cells.map((_, i) => i))
    let fi = 0
    let pi = 0
    for (const idx of indices) {
      if (fi < this.cfg.targetFishCount) {
        cells[idx].type = 'FISH'
        fi++
      } else if (pi < pufferCount) {
        cells[idx].type = 'PUFFER'
        pi++
      } else {
        break
      }
    }
    return cells
  }

  /** 河豚数量：整局从 1 递增到 maxPufferCount（0s≈1，15s≈2，30s≈3） */
  private pufferCountFor(elapsedMs: number): number {
    const t = Math.min(1, elapsedMs / this.cfg.durationMs)
    return Math.min(this.cfg.maxPufferCount, 1 + Math.floor(t * 2))
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
