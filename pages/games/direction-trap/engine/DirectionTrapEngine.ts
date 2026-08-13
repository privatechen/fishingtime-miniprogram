/**
 * 方向陷阱引擎（纯 TS，无 wx 依赖）
 *
 * 规则（对齐《方向陷阱prd.docx》微信小程序版）：
 * - 单局固定 30 秒，用"结束时间戳"计算剩余（Date.now()，防 setInterval 漂移）
 * - 全程每道题随机【看箭头 / 看文字】，同一规则最多连续 3 题（第 4 题强制切换）
 * - 四方向（上/下/左/右），约 70% 冲突题（箭头 ≠ 文字；文字从箭头以外 3 个方向产生），30% 一致题
 * - 计分 = 正确×20 − 错误×10 + 连对里程碑（5/10/20 → +20/+50/+100，同局首次），最低 0 分
 * - 判定：LOOK_ARROW 看箭头方向，LOOK_TEXT 看文字方向
 */

export type Direction = '上' | '下' | '左' | '右'
export type DirectionRule = 'LOOK_ARROW' | 'LOOK_TEXT'

export interface DirectionQuestion {
  /** 视觉箭头方向 */
  arrow: Direction
  /** 文字表达的方向 */
  word: Direction
  /** 当前规则 */
  rule: DirectionRule
  /** arrow 与 word 是否不同（冲突题） */
  isConflict: boolean
  /** 题目出现时间，用于反应时间 */
  startTime: number
}

export interface DirectionResult {
  totalCount: number
  correctCount: number
  wrongCount: number
  /** 0~1 */
  accuracy: number
  /** 平均反应时间（秒） */
  avgReactionTime: number
  maxStreak: number
  score: number
  /** 规则切换正确数/总数（第 1 题不计入） */
  switchCorrect: number
  switchTotal: number
}

export const DIRECTION_DURATION_MS = 30_000
export const DIRECTIONS: Direction[] = ['上', '下', '左', '右']
/** 箭头显示符号 */
export const ARROW_SYMBOL: Record<Direction, string> = {
  上: '↑',
  下: '↓',
  左: '←',
  右: '→',
}

const CONFLICT_RATIO = 0.7
/** 同一规则最多连续题数 */
const MAX_SAME_RULE = 3

const STREAK_BONUSES: { streak: number; bonus: number }[] = [
  { streak: 5, bonus: 20 },
  { streak: 10, bonus: 50 },
  { streak: 20, bonus: 100 },
]

export class DirectionTrapEngine {
  private state: 'idle' | 'running' | 'finished' = 'idle'
  private endTime = 0
  private current: DirectionQuestion | null = null
  private prevQuestion: DirectionQuestion | null = null
  private sameRuleCount = 0

  private totalCount = 0
  private correctCount = 0
  private wrongCount = 0
  private streak = 0
  private maxStreak = 0
  private reactionTimes: number[] = []
  private score = 0
  private switchCorrect = 0
  private switchTotal = 0
  private awardedStreaks = new Set<number>()
  private lastResult: DirectionResult | null = null

  start(): void {
    this.state = 'running'
    this.endTime = Date.now() + DIRECTION_DURATION_MS
    this.current = null
    this.prevQuestion = null
    this.sameRuleCount = 0
    this.totalCount = 0
    this.correctCount = 0
    this.wrongCount = 0
    this.streak = 0
    this.maxStreak = 0
    this.reactionTimes = []
    this.score = 0
    this.switchCorrect = 0
    this.switchTotal = 0
    this.awardedStreaks.clear()
    this.lastResult = null
    this.current = this.generateQuestion()
  }

  isRunning(): boolean {
    return this.state === 'running'
  }

  isFinished(): boolean {
    return this.state === 'finished'
  }

  remainingTimeMs(): number {
    if (this.state !== 'running') return 0
    return this.endTime - Date.now()
  }

  getQuestion(): DirectionQuestion | null {
    return this.current
  }

  getScore(): number {
    return Math.max(0, this.score)
  }

  getStreak(): number {
    return this.streak
  }

  answer(direction: Direction): { correct: boolean; correctAnswer: Direction; newQuestion: DirectionQuestion } | null {
    const q = this.current
    if (!q || this.state !== 'running') return null

    const correctAnswer = q.rule === 'LOOK_ARROW' ? q.arrow : q.word
    const correct = direction === correctAnswer
    const reactionMs = Date.now() - q.startTime

    this.totalCount++
    this.reactionTimes.push(reactionMs)
    // 规则切换题：本题 rule 与上一题不同（第 1 题不计入）
    if (this.prevQuestion && this.prevQuestion.rule !== q.rule) {
      this.switchTotal++
      if (correct) this.switchCorrect++
    }

    if (correct) {
      this.correctCount++
      this.streak++
      if (this.streak > this.maxStreak) this.maxStreak = this.streak
      this.score += 20
      this.applyStreakBonus()
    } else {
      this.wrongCount++
      this.streak = 0
      this.score = Math.max(0, this.score - 10)
    }

    this.prevQuestion = q
    const newQuestion = this.generateQuestion()
    this.current = newQuestion
    return { correct, correctAnswer, newQuestion }
  }

  finish(): DirectionResult {
    if (this.lastResult) return this.lastResult
    this.state = 'finished'

    const total = this.totalCount
    const correct = this.correctCount
    const result: DirectionResult = {
      totalCount: total,
      correctCount: correct,
      wrongCount: this.wrongCount,
      accuracy: total > 0 ? correct / total : 0,
      avgReactionTime:
        this.reactionTimes.length > 0
          ? this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length / 1000
          : 0,
      maxStreak: this.maxStreak,
      score: Math.max(0, this.score),
      switchCorrect: this.switchCorrect,
      switchTotal: this.switchTotal,
    }
    this.lastResult = result
    return result
  }

  // ────────────── 内部 ──────────────

  /** 出题：随机规则 + 连续 3 题限制 + 70% 冲突 + 去重 */
  private generateQuestion(): DirectionQuestion {
    const rule = this.resolveRule()
    const prev = this.prevQuestion
    if (prev && prev.rule === rule) {
      this.sameRuleCount++
    } else {
      this.sameRuleCount = 1
    }

    let q = this.buildQuestion(rule)
    let tries = 0
    while (prev && isSame(q, prev) && tries < 10) {
      q = this.buildQuestion(rule)
      tries++
    }
    return q
  }

  private resolveRule(): DirectionRule {
    const prev = this.prevQuestion
    if (prev && this.sameRuleCount >= MAX_SAME_RULE) {
      return prev.rule === 'LOOK_ARROW' ? 'LOOK_TEXT' : 'LOOK_ARROW'
    }
    return Math.random() < 0.5 ? 'LOOK_ARROW' : 'LOOK_TEXT'
  }

  private buildQuestion(rule: DirectionRule): DirectionQuestion {
    let arrow: Direction
    let word: Direction
    if (Math.random() < CONFLICT_RATIO) {
      arrow = DIRECTIONS[randIndex(DIRECTIONS.length)]
      // 冲突题：文字从箭头以外的其余 3 个方向随机产生
      do {
        word = DIRECTIONS[randIndex(DIRECTIONS.length)]
      } while (word === arrow)
    } else {
      arrow = DIRECTIONS[randIndex(DIRECTIONS.length)]
      word = arrow
    }
    return { arrow, word, rule, isConflict: arrow !== word, startTime: Date.now() }
  }

  private applyStreakBonus(): void {
    for (const b of STREAK_BONUSES) {
      if (this.streak === b.streak && !this.awardedStreaks.has(b.streak)) {
        this.awardedStreaks.add(b.streak)
        this.score += b.bonus
      }
    }
  }
}

function randIndex(length: number): number {
  return Math.floor(Math.random() * length)
}

function isSame(a: DirectionQuestion, b: DirectionQuestion): boolean {
  return a.arrow === b.arrow && a.word === b.word && a.rule === b.rule
}
