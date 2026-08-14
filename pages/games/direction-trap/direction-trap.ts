import {
  DirectionTrapEngine,
  ARROW_SYMBOL,
  type Direction,
  type DirectionQuestion,
  type DirectionResult,
} from './engine/DirectionTrapEngine'
import { post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

type ViewState = 'intro' | 'countdown' | 'playing' | 'result'

const RULE_TEXT: Record<string, string> = { LOOK_ARROW: '看箭头', LOOK_TEXT: '看文字' }

/** 本地成绩（与「我的」页预定义 key 一致） */
const LOCAL_KEY_BEST = 'fishingtime:local:direction-trap:best'
const LOCAL_KEY_ACCURACY = 'fishingtime:local:direction-trap:accuracy'
const LOCAL_KEY_REACTION = 'fishingtime:local:direction-trap:reaction'
const LOCAL_KEY_LAST = 'fishingtime:local:direction-trap:lastResult'

const engine = new DirectionTrapEngine()

let timer: number | null = null
let countdownTimer: number | null = null
let feedbackTimer: number | null = null

Page({
  data: {
    view: 'intro' as ViewState,
    countdown: 3,
    remainingSeconds: 0,
    question: null as DirectionQuestion | null,
    arrowSymbol: '',
    wordText: '',
    ruleText: '',
    rulePulse: false,
    score: 0,
    streak: 0,
    locked: false,
    feedback: null as { correct: boolean; answer: Direction } | null,
    result: null as DirectionResult | null,
    localBest: 0,
    saving: false,
    accuracyText: '',
    reactionText: '',
    showRanking: false,
    showUsernameDialog: false,
  },

  onShow() {
    this.setData({ localBest: Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0) })
  },

  onUnload() {
    this.stopTimer()
    this.stopCountdown()
    if (feedbackTimer) clearTimeout(feedbackTimer)
  },

  /** 开始：3、2、1 倒计时后进入 30 秒游戏 */
  startGame() {
    if (countdownTimer || timer) return
    this.setData({ countdown: 3, view: 'countdown' })
    this.stopCountdown()
    countdownTimer = setInterval(() => {
      const c = this.data.countdown - 1
      if (c <= 0) {
        this.stopCountdown()
        this.beginPlaying()
      } else {
        this.setData({ countdown: c })
      }
    }, 1000)
  },

  stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  },

  beginPlaying() {
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
      arrowSymbol: q ? ARROW_SYMBOL[q.arrow] : '',
      wordText: q ? q.word : '',
      ruleText: q ? RULE_TEXT[q.rule] : '',
      rulePulse: false,
    })
  },

  handleAnswer(e: WechatMiniprogram.TouchEvent) {
    const direction = e.currentTarget.dataset.direction as Direction
    if (this.data.locked || this.data.view !== 'playing' || !engine.isRunning()) return
    const res = engine.answer(direction)
    if (!res) return

    this.setData({ locked: true, feedback: { correct: res.correct, answer: direction } })
    this.setData({ score: engine.getScore(), streak: engine.getStreak() })
    // 规则与题目作为同一题状态原子更新，避免错配
    const newRule = res.newQuestion.rule
    const ruleChanged = RULE_TEXT[newRule] !== this.data.ruleText
    this.setData({
      question: res.newQuestion,
      arrowSymbol: ARROW_SYMBOL[res.newQuestion.arrow],
      wordText: res.newQuestion.word,
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
  saveLocal(result: DirectionResult) {
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

  /** 查看排行榜（复用后端 direction-trap rank，Top20 分数降序） */
    onOpenRanking() {
    this.setData({ showRanking: true })
  },

  onCloseRanking() {
    this.setData({ showRanking: false })
  },

  /** 空操作：弹层 catchtap 阻止冒泡 */
  noop() {},

  /** 保存成绩：先玩后登录（首次需设置用户名时弹自定义弹层） */
  async onSaveScore() {
    if (this.data.saving || !this.data.result) return
    const login = await ensureLogin()
    if (login === 'needUsername') {
      this.setData({ showUsernameDialog: true })
      return
    }
    if (login !== 'ok') {
      wx.showToast({ title: '未保存成绩', icon: 'none' })
      return
    }
    await this.saveScoreAfterLogin()
  },

  async saveScoreAfterLogin() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const ok = await this.submitScore()
      wx.showToast({ title: ok ? '保存成功' : '成绩未保存，可稍后重试', icon: ok ? 'success' : 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  /** 用户名设置成功（注册已自动登录），继续保存 */
  onUsernameConfirmed() {
    this.setData({ showUsernameDialog: false })
    this.saveScoreAfterLogin()
  },
  onUsernameClose() {
    this.setData({ showUsernameDialog: false })
  },

  async submitScore(): Promise<boolean> {
    const r = this.data.result
    if (!r) return false
    try {
      const res = await post<null>('/api/games/direction-trap/score', {
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
