import {
  ColorHunterEngine,
  type HunterCell,
  type HunterColor,
  type HunterResult,
} from './engine/ColorHunterEngine'
import { get, post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

type ViewState = 'intro' | 'playing' | 'result'

const COLOR_CSS: Record<HunterColor, string> = {
  红: '#e74c3c',
  黄: '#f7b500',
  蓝: '#2d8cf0',
  绿: '#27ae60',
}

/** 渲染用格子（found 为已完成状态） */
interface RenderCell {
  id: number
  color: string
  found: boolean
}

/** 本地成绩（finalTime 毫秒，与「我的」页预定义 key 一致） */
const LOCAL_KEY_FINAL = 'fishingtime:local:color-hunter:finalTime'
const LOCAL_KEY_ERRORS = 'fishingtime:local:color-hunter:bestErrors'
const LOCAL_KEY_COUNT = 'fishingtime:local:color-hunter:gameCount'
const LOCAL_KEY_LAST = 'fishingtime:local:color-hunter:lastResult'

const engine = new ColorHunterEngine()

let timer: number | null = null
let feedbackTimer: number | null = null
let transitionTimer: number | null = null
/** 切后台/离开页面时标记中断（返回后提示重新挑战） */
let interrupted = false
/** 轮次过渡期间锁定点击 */
let transitioning = false

Page({
  data: {
    view: 'intro' as ViewState,
    roundIndex: 0,
    roundLabel: 'Round 1 / 4',
    gridSize: 5,
    cells: [] as RenderCell[],
    targetColorName: '',
    targetColorCss: '',
    remaining: 0,
    errors: 0,
    currentTimeText: '0.00',
    targetPulse: false,
    wrongId: null as number | null,
    transitionText: '',
    transitioning: false,

    result: null as HunterResult | null,
    totalText: '',
    accuracyText: '',
    roundTexts: ['', '', '', ''],
    isNewBest: false,
    localBestText: '',

    showRanking: false,
    rankingLoading: false,
    rankingList: [] as { rank: number; nickname: string; timeText: string }[],
    saving: false,
    showUsernameDialog: false,
  },

  onShow() {
    // 中断后返回：本局作废，提示重新挑战（V3 §19）
    if (interrupted) {
      interrupted = false
      if (this.data.view === 'playing') {
        wx.showModal({
          title: '本局已中断',
          content: '游戏中断，本局成绩不会保存，请重新挑战。',
          showCancel: false,
          confirmText: '重新挑战',
          success: () => this.resetToIntro(),
        })
        return
      }
    }
    this.syncLocalBest()
  },

  onHide() {
    if (this.data.view === 'playing') {
      interrupted = true
    }
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
    if (feedbackTimer) clearTimeout(feedbackTimer)
    if (transitionTimer) clearTimeout(transitionTimer)
  },

  /** 开始：点击即开始计时并生成 Round 1（V3 §13 无倒计时） */
  startGame() {
    if (timer) return
    engine.start()
    // 复位模块级状态，避免上一实例残留的过渡锁定/中断标记影响本局
    transitioning = false
    interrupted = false
    this.setData({
      view: 'playing',
      transitioning: false,
      transitionText: '',
      wrongId: null,
      result: null,
      roundIndex: 0,
    })
    this.syncGameView()
    this.startTimer()
  },

  startTimer() {
    this.stopTimer()
    timer = setInterval(() => {
      this.setData({ currentTimeText: (engine.currentTotalTimeMs() / 1000).toFixed(2) })
    }, 100)
  },

  stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },

  /** 同步棋盘、目标提示与轮次 */
  syncGameView() {
    this.setData({
      roundIndex: engine.getRoundIndex(),
      roundLabel: `Round ${engine.getRoundIndex() + 1} / 4`,
      gridSize: engine.getGridSize(),
      cells: engine.getCells().map((c: HunterCell) => ({ id: c.id, color: COLOR_CSS[c.color], found: c.found })),
      targetColorName: engine.getTargetColor() || '',
      targetColorCss: engine.getTargetColor() ? COLOR_CSS[engine.getTargetColor() as HunterColor] : '',
      remaining: engine.getRemaining(),
      errors: engine.getErrors(),
    })
  },

  syncLocalBest() {
    const best = Number(wx.getStorageSync(LOCAL_KEY_FINAL) || 0)
    this.setData({ localBestText: best > 0 ? `${(best / 1000).toFixed(2)}s` : '' })
  },

  onCellTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as number
    if (this.data.view !== 'playing' || transitioning || !engine.isRunning()) return
    const res = engine.click(id)

    if (res.type === 'wrong') {
      this.setData({ errors: engine.getErrors(), wrongId: id })
      if (feedbackTimer) clearTimeout(feedbackTimer)
      feedbackTimer = setTimeout(() => this.setData({ wrongId: null }), 200)
      return
    }
    if (res.type === 'none') return

    if (res.type === 'hit') {
      this.syncGameView()
      return
    }
    if (res.type === 'roundComplete') {
      // 锁定本轮，显示轻量过渡后重生成棋盘
      this.setData({
        transitioning: true,
        transitionText: `Round ${res.nextRound} / 4`,
      })
      if (transitionTimer) clearTimeout(transitionTimer)
      transitionTimer = setTimeout(() => {
        engine.nextRound()
        this.setData({ transitioning: false, transitionText: '' })
        this.syncGameView()
        // 新一轮目标强调（150-250ms）
        this.setData({ targetPulse: true })
        setTimeout(() => this.setData({ targetPulse: false }), 250)
      }, 350)
      return
    }
    if (res.type === 'gameComplete') {
      this.finishGame(res.result)
    }
  },

  finishGame(result: HunterResult) {
    this.stopTimer()
    const isNewBest = this.saveLocal(result)
    this.setData({
      view: 'result',
      result,
      totalText: `${(result.totalTime / 1000).toFixed(2)}s`,
      accuracyText: `${Math.round(result.accuracy * 100)}%`,
      roundTexts: result.roundTimes.map((t) => `${(t / 1000).toFixed(2)}s`),
      isNewBest,
    })
  },

  /** 本地保存最佳（finalTime 毫秒）与最近成绩；未完整通关不更新 best */
  saveLocal(result: HunterResult): boolean {
    let isNewBest = false
    try {
      const oldBest = Number(wx.getStorageSync(LOCAL_KEY_FINAL) || 0)
      const oldErrors = Number(wx.getStorageSync(LOCAL_KEY_ERRORS) || 0)
      if (
        oldBest === 0 ||
        result.totalTime < oldBest ||
        (result.totalTime === oldBest && result.errors < oldErrors)
      ) {
        wx.setStorageSync(LOCAL_KEY_FINAL, result.totalTime)
        wx.setStorageSync(LOCAL_KEY_ERRORS, result.errors)
        isNewBest = true
      }
      wx.setStorageSync(LOCAL_KEY_COUNT, Number(wx.getStorageSync(LOCAL_KEY_COUNT) || 0) + 1)
      wx.setStorageSync(LOCAL_KEY_LAST, result)
    } catch {
      // Storage 不可用则仅不保存
    }
    this.syncLocalBest()
    return isNewBest
  },

  /** 返回：游戏中二次确认，其余直接返回 */
  onBack() {
    if (this.data.view === 'playing') {
      wx.showModal({
        title: '退出游戏',
        content: '退出后本局成绩不会保存，确定退出吗？',
        confirmText: '退出',
        cancelText: '继续',
        success: (r) => {
          if (r.confirm) {
            this.stopTimer()
            wx.navigateBack()
          }
        },
      })
      return
    }
    wx.navigateBack()
  },

  backToGames() {
    wx.navigateBack()
  },

  /** 中断后回到初始状态 */
  resetToIntro() {
    this.stopTimer()
    this.setData({
      view: 'intro',
      transitioning: false,
      transitionText: '',
      wrongId: null,
      result: null,
    })
    this.syncLocalBest()
  },

  /** 查看排行榜（复用后端 color-hunter rank，按总时间升序） */
  async onOpenRanking() {
    this.setData({ showRanking: true, rankingLoading: true })
    try {
      const res = await get<{ rank: number; nickname: string; bestFinalTime: number }[]>(
        '/api/games/color-hunter/rank',
      )
      this.setData({
        rankingList: (res.data || []).map((r) => ({
          rank: r.rank,
          nickname: r.nickname,
          timeText: `${(r.bestFinalTime / 1000).toFixed(2)}s`,
        })),
        rankingLoading: false,
      })
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
      // V3 无错误惩罚换算，bestFinalTime = bestActualTime = 总用时；fastestRound = 四轮中最快一轮
      const res = await post<null>('/api/games/color-hunter/score', {
        bestFinalTime: r.totalTime,
        bestActualTime: r.totalTime,
        lowestErrorCount: r.errors,
        fastestRound: r.roundTimes.length > 0 ? Math.min(...r.roundTimes) : null,
      })
      return res.code === 200
    } catch {
      return false
    }
  },
})
