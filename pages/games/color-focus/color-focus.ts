import {
  ColorFocusEngine,
  FOCUS_COLORS,
  type FocusColor,
  type FocusQuestion,
  type FocusResult,
} from './engine/ColorFocusEngine'
import { get, post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

type ViewState = 'intro' | 'playing' | 'result'

const RULE_TEXT: Record<string, string> = { LOOK_COLOR: '看颜色', LOOK_TEXT: '看文字' }
const COLOR_CSS: Record<FocusColor, string> = {
  红: '#e74c3c',
  黄: '#f7b500',
  绿: '#27ae60',
  蓝: '#2d8cf0',
}

/** 本地成绩（与「我的」页预定义 key 一致） */
const LOCAL_KEY_BEST = 'fishingtime:local:color-focus:best'
const LOCAL_KEY_ACCURACY = 'fishingtime:local:color-focus:accuracy'
const LOCAL_KEY_REACTION = 'fishingtime:local:color-focus:reaction'
const LOCAL_KEY_LAST = 'fishingtime:local:color-focus:lastResult'

const engine = new ColorFocusEngine()

let timer: number | null = null
let feedbackTimer: number | null = null

Page({
  data: {
    view: 'intro' as ViewState,
    remainingSeconds: 0,
    question: null as FocusQuestion | null,
    questionColor: '',
    ruleText: '',
    rulePulse: false,
    score: 0,
    streak: 0,
    locked: false,
    feedback: null as { correct: boolean; answer: string } | null,
    result: null as FocusResult | null,
    localBest: 0,
    saving: false,
    colors: FOCUS_COLORS,
    accuracyText: '',
    reactionText: '',
    showRanking: false,
    rankingLoading: false,
    rankingList: [] as { rank: number; nickname: string; bestScore: number }[],
  },

  onShow() {
    this.setData({ localBest: Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0) })
  },

  onUnload() {
    this.stopTimer()
  },

  startGame() {
    engine.start()
    this.setData({
      view: 'playing',
      score: 0,
      streak: 0,
      feedback: null,
      locked: false,
      result: null,
      rulePulse: false,
    })
    this.syncQuestion()
    this.startTimer()
  },

  startTimer() {
    this.stopTimer()
    timer = setInterval(() => {
      const remain = engine.remainingTimeMs()
      this.setData({ remainingSeconds: Math.max(0, Math.ceil(remain / 1000)), score: engine.getScore() })
      if (remain <= 0) {
        this.finishGame()
      }
    }, 100)
  },

  stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },

  syncQuestion() {
    const q = engine.getQuestion()
    this.setData({
      question: q,
      questionColor: q ? COLOR_CSS[q.fontColor] : '',
      ruleText: q ? RULE_TEXT[q.rule] : '',
      rulePulse: false,
    })
  },

  handleAnswer(e: WechatMiniprogram.TouchEvent) {
    const color = e.currentTarget.dataset.color as FocusColor
    if (this.data.locked || this.data.view !== 'playing' || !engine.isRunning()) return
    const res = engine.answer(color)
    if (!res) return

    this.setData({ locked: true, feedback: { correct: res.correct, answer: color } })
    this.setData({ score: engine.getScore(), streak: engine.getStreak() })
    // 规则随下一题更新
    const newRule = res.newQuestion.rule
    const ruleChanged = RULE_TEXT[newRule] !== this.data.ruleText
    this.setData({
      question: res.newQuestion,
      // 题目颜色随新题更新（fontColor 每题随机，避免一直显示第一题的颜色）
      questionColor: COLOR_CSS[res.newQuestion.fontColor],
      ruleText: RULE_TEXT[newRule],
      rulePulse: ruleChanged,
    })
    if (ruleChanged) {
      setTimeout(() => this.setData({ rulePulse: false }), 300)
    }

    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => {
      this.setData({ feedback: null, locked: false })
    }, 180)
  },

  finishGame() {
    if (!engine.isRunning()) return
    this.stopTimer()
    const result = engine.finish()
    this.saveLocal(result)
    this.setData({
      result,
      view: 'result',
      accuracyText: `${Math.round(result.accuracy * 100)}%`,
      reactionText: `${result.avgReactionTime.toFixed(2)}s`,
    })
  },

  /** 本地保存最近成绩与最佳（游客也有连续体验） */
  saveLocal(result: FocusResult) {
    try {
      wx.setStorageSync(LOCAL_KEY_LAST, result)
      const oldBest = Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0)
      if (result.score > oldBest) wx.setStorageSync(LOCAL_KEY_BEST, result.score)
      const oldAcc = Number(wx.getStorageSync(LOCAL_KEY_ACCURACY) || 0)
      if (result.accuracy > oldAcc) wx.setStorageSync(LOCAL_KEY_ACCURACY, result.accuracy)
      const oldReaction = Number(wx.getStorageSync(LOCAL_KEY_REACTION) || 0)
      if (oldReaction === 0 || (result.avgReactionTime > 0 && result.avgReactionTime < oldReaction)) {
        wx.setStorageSync(LOCAL_KEY_REACTION, result.avgReactionTime)
      }
    } catch {
      // Storage 不可用则仅不保存
    }
    this.setData({ localBest: Math.max(Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0), result.score) })
  },

  backToGames() {
    wx.navigateBack()
  },

  /** 查看排行榜（复用后端 color-focus rank，展示分数 + 昵称） */
  async onOpenRanking() {
    this.setData({ showRanking: true, rankingLoading: true })
    try {
      const res = await get<{ rank: number; nickname: string; bestScore: number }[]>('/api/games/color-focus/rank')
      this.setData({ rankingList: res.data || [], rankingLoading: false })
    } catch {
      this.setData({ rankingList: [], rankingLoading: false })
      wx.showToast({ title: '排行榜加载失败', icon: 'none' })
    }
  },

  onCloseRanking() {
    this.setData({ showRanking: false })
  },

  /** 空操作：弹层 catchtap 阻止冒泡 */
  noop() {},

  /** 保存成绩：先玩后登录，未建身份时引导登录/填用户名；未填则返回 false 不保存 */
  async onSaveScore() {
    if (this.data.saving || !this.data.result) return
    this.setData({ saving: true })
    try {
      const ok = await ensureLogin()
      if (!ok) {
        wx.showToast({ title: '未保存成绩', icon: 'none' })
        return
      }
      const ok2 = await this.submitScore()
      wx.showToast({ title: ok2 ? '保存成功' : '成绩未保存，可稍后重试', icon: ok2 ? 'success' : 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async submitScore(): Promise<boolean> {
    const r = this.data.result
    if (!r) return false
    try {
      const res = await post<null>('/api/games/color-focus/score', {
        bestScore: r.score,
        bestAccuracy: r.accuracy,
        bestAvgReaction: r.avgReactionTime,
        bestSwitchAccuracy: r.switchTotal > 0 ? r.switchCorrect / r.switchTotal : null,
        maxStreak: r.maxStreak,
      })
      return res.code === 200
    } catch {
      return false
    }
  },
})
