/**
 * 专注色彩引擎（纯 TS，无 wx 依赖）
 *
 * 规则（对齐《专注色彩prd.docx》V1.0）：
 * - 单局固定 30 秒，用"结束时间戳"计算剩余（Date.now()，防 setInterval 漂移）
 * - 全程每道题随机【看颜色 / 看文字】，同一规则最多连续 3 题（第 4 题强制切换）
 * - 4 色（红/黄/绿/蓝），约 70% 冲突题（word ≠ fontColor）
 * - 计分 = 正确×20 − 错误×10 + 连对里程碑（5/10/20 → +20/+50/+100，同局首次）
 * - 判定：LOOK_COLOR 看字体颜色，LOOK_TEXT 看文字含义
 */

export type FocusColor = '红' | '黄' | '绿' | '蓝'
export type FocusRule = 'LOOK_COLOR' | 'LOOK_TEXT'

export interface FocusQuestion {
  /** 文字表达的颜色 */
  word: FocusColor
  /** 文字实际显示的字体颜色 */
  fontColor: FocusColor
  /** 当前规则 */
  rule: FocusRule
  /** word 与 fontColor 是否不同（冲突题） */
  isConflict: boolean
  /** 题目出现时间，用于反应时间 */
  startTime: number
}

export interface FocusResult {
  totalCount: number
  correctCount: number
  wrongCount: number
  /** 0~1 */
  accuracy: number
  /** 平均反应时间（秒） */
  avgReactionTime: number
  maxStreak: number
  score: number
  switchCorrect: number
  switchTotal: number
}

export const FOCUS_DURATION_MS = 30_000
export const FOCUS_COLORS: FocusColor[] = ['红', '黄', '绿', '蓝']

const CONFLICT_RATIO = 0.7
/** 同一规则最多连续题数 */
const MAX_SAME_RULE = 3

const STREAK_BONUSES: { streak: number; bonus: number }[] = [
  { streak: 5, bonus: 20 },
  { streak: 10, bonus: 50 },
  { streak: 20, bonus: 100 },
]

export class ColorFocusEngine {
  private state: 'idle' | 'running' | 'finished' = 'idle'
  private endTime = 0
  private current: FocusQuestion | null = null
  private prevQuestion: FocusQuestion | null = null
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
  private lastResult: FocusResult | null = null

  start(): void {
    this.state = 'running'
    this.endTime = Date.now() + FOCUS_DURATION_MS
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

  getQuestion(): FocusQuestion | null {
    return this.current
  }

  getScore(): number {
    return Math.max(0, this.score)
  }

  getStreak(): number {
    return this.streak
  }

  answer(color: FocusColor): { correct: boolean; correctAnswer: FocusColor; newQuestion: FocusQuestion } | null {
    const q = this.current
    if (!q || this.state !== 'running') return null

    const correctAnswer = q.rule === 'LOOK_COLOR' ? q.fontColor : q.word
    const correct = color === correctAnswer
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

  finish(): FocusResult {
    if (this.lastResult) return this.lastResult
    this.state = 'finished'

    const total = this.totalCount
    const correct = this.correctCount
    const result: FocusResult = {
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
  private generateQuestion(): FocusQuestion {
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

  private resolveRule(): FocusRule {
    const prev = this.prevQuestion
    if (prev && this.sameRuleCount >= MAX_SAME_RULE) {
      return prev.rule === 'LOOK_COLOR' ? 'LOOK_TEXT' : 'LOOK_COLOR'
    }
    return Math.random() < 0.5 ? 'LOOK_COLOR' : 'LOOK_TEXT'
  }

  private buildQuestion(rule: FocusRule): FocusQuestion {
    let word: FocusColor
    let fontColor: FocusColor
    if (Math.random() < CONFLICT_RATIO) {
      word = FOCUS_COLORS[randIndex(FOCUS_COLORS.length)]
      do {
        fontColor = FOCUS_COLORS[randIndex(FOCUS_COLORS.length)]
      } while (fontColor === word)
    } else {
      word = FOCUS_COLORS[randIndex(FOCUS_COLORS.length)]
      fontColor = word
    }
    return { word, fontColor, rule, isConflict: word !== fontColor, startTime: Date.now() }
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

function isSame(a: FocusQuestion, b: FocusQuestion): boolean {
  return a.word === b.word && a.fontColor === b.fontColor && a.rule === b.rule
}
