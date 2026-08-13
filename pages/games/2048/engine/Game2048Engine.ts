/**
 * 2048 游戏引擎 — 纯 TypeScript 逻辑，不依赖框架（移植自 FishingTime Web 版）
 *
 * 移动流程：Move → Compress → Merge → Compress → GenerateTile
 * 生成规则：90% 生成 2，10% 生成 4
 * 合并规则：一次移动同一个数字只能参与一次合并
 *
 * 方向处理：使用 transpose（转置）+ 翻转，将任意方向统一为"向左"处理
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

/** 棋盘上的一个格子（带唯一 id，用于动画追踪） */
export interface BoardTile {
  id: number
  row: number
  col: number
  value: number
}

/** 移动结果 */
export interface MoveResult {
  /** 是否产生了有效移动 */
  moved: boolean
  /** 需要"弹出"动画的格子 id（新生成 + 合并产生） */
  newTileIds: number[]
}

/** 内部格子数据 */
interface TileData {
  id: number
  value: number
}

export class Game2048Engine {
  private grid: (TileData | null)[][]
  private score: number
  private readonly size: number
  private nextId: number

  constructor(size = 4) {
    this.size = size
    this.score = 0
    this.nextId = 1
    this.grid = this.emptyGrid()
    this.init()
  }

  /** 初始化棋盘：两个随机 2 */
  init(): void {
    this.grid = this.emptyGrid()
    this.score = 0
    this.nextId = 1
    this.generateTile()
    this.generateTile()
  }

  getScore(): number {
    return this.score
  }

  /** 当前棋盘最大方块 */
  getMaxTile(): number {
    let max = 0
    for (const row of this.grid) {
      for (const t of row) {
        if (t && t.value > max) max = t.value
      }
    }
    return max
  }

  /** 获取数值矩阵（用于 Storage 保存） */
  getBoardValues(): number[][] {
    return this.grid.map((row) => row.map((t) => (t ? t.value : 0)))
  }

  /** 从数值矩阵恢复（用于 Storage 恢复） */
  loadState(values: number[][], score: number): void {
    this.grid = values.map((row) =>
      row.map((v) => (v === 0 ? null : { id: this.nextId++, value: v })),
    )
    this.score = score
  }

  /** 获取所有格子的当前状态（供 UI 渲染 + 动画） */
  getTiles(): BoardTile[] {
    const tiles: BoardTile[] = []
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const t = this.grid[r][c]
        if (t) tiles.push({ id: t.id, row: r, col: c, value: t.value })
      }
    }
    return tiles
  }

  /**
   * 移动棋盘
   * @returns 移动结果（是否移动 + 需要弹出的格子 id）
   */
  move(direction: Direction): MoveResult {
    let mergedIds: number[] = []
    let moved = false

    switch (direction) {
      case 'left':
        ;({ moved, mergedIds } = this.slideAllLeft())
        break
      case 'right':
        this.reverseRows()
        ;({ moved, mergedIds } = this.slideAllLeft())
        this.reverseRows()
        break
      case 'up':
        this.transpose()
        ;({ moved, mergedIds } = this.slideAllLeft())
        this.transpose()
        break
      case 'down':
        this.transpose()
        this.reverseRows()
        ;({ moved, mergedIds } = this.slideAllLeft())
        this.reverseRows()
        this.transpose()
        break
    }

    // 有效移动后生成新格子
    let newTileId = -1
    if (moved) {
      newTileId = this.generateTile()
    }

    const newTileIds = [...mergedIds]
    if (newTileId > 0) newTileIds.push(newTileId)
    return { moved, newTileIds }
  }

  /** 是否游戏结束：棋盘满且四个方向均不可移动 */
  isGameOver(): boolean {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cur = this.grid[r][c]
        if (!cur) return false
        // 相邻格可能为 null（当前格非空但右/下为空），需判空再比较
        if (c + 1 < this.size) {
          const right = this.grid[r][c + 1]
          if (right && cur.value === right.value) return false
        }
        if (r + 1 < this.size) {
          const down = this.grid[r + 1][c]
          if (down && cur.value === down.value) return false
        }
      }
    }
    return true
  }

  // ────────────── 内部方法 ──────────────

  private emptyGrid(): (TileData | null)[][] {
    return Array.from({ length: this.size }, () => Array(this.size).fill(null))
  }

  /** 生成新方块：90% 2，10% 4；返回新格子 id */
  private generateTile(): number {
    const empty: Array<[number, number]> = []
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (!this.grid[r][c]) empty.push([r, c])
      }
    }
    if (empty.length === 0) return -1
    const [r, c] = empty[Math.floor(Math.random() * empty.length)]
    const value = Math.random() < 0.9 ? 2 : 4
    const id = this.nextId++
    this.grid[r][c] = { id, value }
    return id
  }

  /** 所有行向左滑动 */
  private slideAllLeft(): { moved: boolean; mergedIds: number[] } {
    let moved = false
    const mergedIds: number[] = []
    for (let r = 0; r < this.size; r++) {
      const rowResult = this.slideRowLeft(r)
      if (rowResult.moved) moved = true
      mergedIds.push(...rowResult.mergedIds)
    }
    return { moved, mergedIds }
  }

  /**
   * 单行向左滑动（compress → merge → compress）
   * 返回该行是否有变化 + 合并产生的新格子 id
   */
  private slideRowLeft(r: number): { moved: boolean; mergedIds: number[] } {
    const row = this.grid[r]

    // 收集非空格子（记录原列位置）
    const nonEmpty: Array<{ tile: TileData; col: number }> = []
    for (let c = 0; c < this.size; c++) {
      if (row[c]) nonEmpty.push({ tile: row[c]!, col: c })
    }

    const newRow: (TileData | null)[] = Array(this.size).fill(null)
    const mergedIds: number[] = []
    let moved = false
    let pos = 0

    for (let i = 0; i < nonEmpty.length; i++) {
      const { tile, col } = nonEmpty[i]
      if (i < nonEmpty.length - 1 && tile.value === nonEmpty[i + 1].tile.value) {
        // 合并：新格子，值为两倍，占用合并后的位置
        const newValue = tile.value * 2
        this.score += newValue
        const mergedTile: TileData = { id: this.nextId++, value: newValue }
        newRow[pos] = mergedTile
        mergedIds.push(mergedTile.id)
        if (col !== pos || nonEmpty[i + 1].col !== pos) moved = true
        i++ // 跳过被合并的右格
      } else {
        newRow[pos] = tile
        if (col !== pos) moved = true
      }
      pos++
    }

    // 若行结构变化（例如发生了合并导致数量减少）也算移动
    for (let c = 0; c < this.size; c++) {
      if (newRow[c]?.id !== row[c]?.id) {
        moved = true
        break
      }
    }

    this.grid[r] = newRow
    return { moved, mergedIds }
  }

  /** 转置（行列互换） */
  private transpose(): void {
    const n = this.size
    const result = this.emptyGrid()
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        result[c][r] = this.grid[r][c]
      }
    }
    this.grid = result
  }

  /** 每行反转（水平翻转） */
  private reverseRows(): void {
    for (let r = 0; r < this.size; r++) {
      this.grid[r] = [...this.grid[r]].reverse()
    }
  }
}
