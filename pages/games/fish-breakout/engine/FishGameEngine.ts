/**
 * 鱼群突围 — 游戏引擎（纯 TS，无 Vue/DOM 依赖）
 *
 * 核心规则（对齐《鱼群突围网页端prd.docx》）：
 * - 每条鱼固定朝上/下/左/右；点击后沿朝向扫描到棋盘边界，
 *   前方任意位置有 ACTIVE 鱼 → 失败（mistakes+1）；畅通 → 游出（逻辑立即移除）。
 * - 鱼只能点击，不能拖拽、转向、换位。
 * - 30 秒连续挑战：清空鱼池自动进入下一池（总计时不暂停）。
 * - 所有棋盘由可解生成器产出，保证 100% 有解。
 * - finish 幂等；鱼池切换期间不接受旧棋盘点击。
 */
import type { BoardState, DifficultySpec, Fish, GameState, PoolResult } from './types'
import { BoardGenerator } from './BoardGenerator'
import { canExit } from './Solver'

export interface FishGameOptions {
  rows: number
  cols: number
  difficulty: DifficultySpec[]
  /** 单局时长（毫秒，默认 30 秒） */
  durationMs?: number
  /** 失误达到该次数提前结束（默认 3） */
  mistakesLimit?: number
}

export const DEFAULT_DURATION_MS = 30_000
export const DEFAULT_MISTAKES_LIMIT = 3

export class FishGameEngine {
  private state: GameState = {
    status: 'ready',
    endTime: 0,
    clearedPools: 0,
    releasedFish: 0,
    mistakes: 0,
    currentBoard: null,
  }
  private endedBy: 'timeout' | 'mistakes' = 'timeout'
  private startTime = 0

  constructor(private options: FishGameOptions) {}

  /** 开始新一局（生成第一池） */
  start(): void {
    this.startTime = Date.now()
    this.state = {
      status: 'playing',
      endTime: this.startTime + (this.options.durationMs ?? DEFAULT_DURATION_MS),
      clearedPools: 0,
      releasedFish: 0,
      mistakes: 0,
      currentBoard: null,
    }
    this.endedBy = 'timeout'
    this.generatePool()
  }

  /** 是否仍在进行（含过渡期，时间未到） */
  isRunning(): boolean {
    return this.state.status === 'playing' || this.state.status === 'transitioning'
  }

  isFinished(): boolean {
    return this.state.status === 'finished'
  }

  /** 剩余毫秒；结束后返回 0 */
  remainingTimeMs(): number {
    if (this.state.status === 'finished') return 0
    return this.state.endTime - Date.now()
  }

  getState(): GameState {
    return this.state
  }

  /** 某鱼当前能否离开（debug 高亮用） */
  canExit(fishId: string): boolean {
    const board = this.state.currentBoard
    if (!board) return false
    const fish = board.fishes.find((f) => f.id === fishId)
    if (!fish || fish.status !== 'ACTIVE') return false
    return canExit(fish, board.fishes, board.rows, board.cols)
  }

  /**
   * 点击鱼。同步更新逻辑状态（动画由页面异步播放）：
   * - success：鱼立即从 ACTIVE 移除，releasedFish+1；若棋盘清空则进入清池状态
   * - fail：mistakes+1
   * - ignore：未运行 / 过渡中 / 已超时 / 重复点击
   */
  tapFish(fishId: string): 'success' | 'fail' | 'ignore' {
    if (this.state.status === 'finished' || this.state.status === 'transitioning') return 'ignore'
    if (Date.now() >= this.state.endTime) {
      this.finish()
      return 'ignore'
    }
    const board = this.state.currentBoard
    if (!board) return 'ignore'
    const fish = board.fishes.find((f) => f.id === fishId)
    if (!fish || fish.status !== 'ACTIVE') return 'ignore'

    if (!canExit(fish, board.fishes, board.rows, board.cols)) {
      this.state.mistakes++
      // 失误达上限：立即结算（30 秒仍是上限，这里是提前失败）
      if (this.state.mistakes >= this.mistakesLimit()) {
        this.finish('mistakes')
      }
      return 'fail'
    }

    fish.status = 'EXITING'
    this.state.releasedFish++
    if (board.fishes.every((f) => f.status !== 'ACTIVE')) {
      this.state.clearedPools++
      this.state.status = 'transitioning'
    }
    return 'success'
  }

  /** 鱼池切换过渡结束后调用：进入下一池（总计时不暂停） */
  startNextPool(): void {
    if (this.state.status !== 'transitioning') return
    this.generatePool()
  }

  /**
   * 幂等结算：未清空池中已放生的鱼计入 releasedFish，池数不计入 clearedPools。
   * reason 仅在首次结算时生效（timeout=30 秒到 / mistakes=失误达上限提前结束）。
   */
  finish(reason: 'timeout' | 'mistakes' = 'timeout'): PoolResult {
    if (this.state.status !== 'finished') {
      this.state.status = 'finished'
      this.endedBy = reason
    }
    const { clearedPools, releasedFish, mistakes } = this.state
    return {
      clearedPools,
      releasedFish,
      mistakes,
      accuracy: releasedFish + mistakes > 0 ? releasedFish / (releasedFish + mistakes) : 0,
      duration: Date.now() - this.startTime,
      endedBy: this.endedBy,
    }
  }

  // ────────────── 仅开发环境（debug 面板）使用 ──────────────

  /** 重新生成当前池 */
  debugRegeneratePool(): void {
    this.generatePool()
  }

  /** 延长计时 */
  debugExtendTime(ms: number): void {
    this.state.endTime += ms
  }

  // ────────────── 内部 ──────────────

  private generatePool(): void {
    const spec = this.difficultyFor(this.state.clearedPools)
    const fishCount = randBetween(spec.fishCount[0], spec.fishCount[1])
    const generator = new BoardGenerator({
      rows: this.options.rows,
      cols: this.options.cols,
      fishCount,
      maxInitialFreeRatio: spec.maxInitialFreeRatio,
    })
    this.state.currentBoard = generator.generate()
    this.state.status = 'playing'
  }

  private difficultyFor(pools: number): DifficultySpec {
    let spec = this.options.difficulty[0]
    for (const s of this.options.difficulty) {
      if (pools >= s.minPools) spec = s
    }
    return spec
  }

  private mistakesLimit(): number {
    return this.options.mistakesLimit ?? DEFAULT_MISTAKES_LIMIT
  }
}

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}
