import { FishGameEngine } from './engine/FishGameEngine'
import type { DifficultySpec, PoolResult } from './engine/types'
import { post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

type ViewState = 'intro' | 'countdown' | 'playing' | 'result'

/** 体验配置（与 Web 端 config 一致） */
const BOARD_ROWS = 5
const BOARD_COLS = 5
const GAME_DURATION_MS = 30_000
const MISTAKES_LIMIT = 3
const POOL_TRANSITION_MS = 350
const EXIT_ANIMATION_MS = 220

const DIFFICULTY: DifficultySpec[] = [
  { minPools: 0, fishCount: [10, 12], maxInitialFreeRatio: 0.6 },
  { minPools: 2, fishCount: [12, 14], maxInitialFreeRatio: 0.55 },
  { minPools: 4, fishCount: [14, 16], maxInitialFreeRatio: 0.5 },
  { minPools: 6, fishCount: [16, 18], maxInitialFreeRatio: 0.45 },
]

const ROTATE: Record<string, number> = { RIGHT: 0, DOWN: 90, LEFT: 180, UP: 270 }

/** 本地成绩（与「我的」页预定义 key 一致） */
const LOCAL_KEY_POOLS = 'fishingtime:local:fish-breakout:bestClearedPools'
const LOCAL_KEY_FISH = 'fishingtime:local:fish-breakout:bestReleasedFish'
const LOCAL_KEY_MISTAKES = 'fishingtime:local:fish-breakout:bestMistakes'
const LOCAL_KEY_COUNT = 'fishingtime:local:fish-breakout:gameCount'
const LOCAL_KEY_LAST = 'fishingtime:local:fish-breakout:lastResult'

interface RenderCell {
  id: string
  col: number
  row: number
  dir: string
  rotate: number
  exiting: boolean
  mistake: boolean
}

const engine = new FishGameEngine({
  rows: BOARD_ROWS,
  cols: BOARD_COLS,
  difficulty: DIFFICULTY,
  durationMs: GAME_DURATION_MS,
  mistakesLimit: MISTAKES_LIMIT,
})

let timer: number | null = null
let countdownTimer: number | null = null
let poolTimer: number | null = null
let mistakeTimer: number | null = null
/** 每条鱼独立离场计时器：快速连续点击互不干扰 */
const exitTimers: Record<string, number> = {}

Page({
  data: {
    view: 'intro' as ViewState,
    countdown: 3,
    remainingSeconds: GAME_DURATION_MS / 1000,
    clearedPools: 0,
    releasedFish: 0,
    mistakes: 0,
    gridSize: BOARD_COLS,
    cells: [] as RenderCell[],
    poolTransition: false,
    transitionText: '',
    animatingIds: [] as string[],
    mistakeId: null as string | null,
    result: null as PoolResult | null,
    accuracyText: '',
    isNewBest: false,
    localBestText: '',
    showRanking: false,
    saving: false,
    showUsernameDialog: false,
  },

  onLoad() {
    this.syncLocalBest()
  },

  /** 切后台不暂停 30 秒：回前台按真实时间重算，已超时直接结算 */
  onShow() {
    if (this.data.view === 'playing' && engine.isRunning()) {
      const remain = engine.remainingTimeMs()
      this.setData({ remainingSeconds: Math.max(0, Math.ceil(remain / 1000)) })
      if (remain <= 0) {
        this.showResult()
        return
      }
      this.startTimer()
    }
  },

  /** 不暂停计时：只停 UI 刷新 Timer，保留 endTime */
  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
    this.stopCountdown()
    if (poolTimer) clearTimeout(poolTimer)
    if (mistakeTimer) clearTimeout(mistakeTimer)
    Object.values(exitTimers).forEach((t) => clearTimeout(t))
  },

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
      poolTransition: false,
      transitionText: '',
      result: null,
      animatingIds: [],
      mistakeId: null,
    })
    this.syncGameView()
    this.startTimer()
  },

  startTimer() {
    this.stopTimer()
    timer = setInterval(() => {
      if (!engine.isRunning()) return
      const remain = engine.remainingTimeMs()
      // 整秒变化才更新显示，减少无谓 setData
      const sec = Math.max(0, Math.ceil(remain / 1000))
      if (sec !== this.data.remainingSeconds) this.setData({ remainingSeconds: sec })
      if (remain <= 0) this.showResult()
    }, 100)
  },

  stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  },

  /** 从引擎状态 + 动画状态重建棋盘/HUD（只更新必要字段） */
  syncGameView() {
    const board = engine.getState().currentBoard
    const anim = this.data.animatingIds
    const mistakeId = this.data.mistakeId
    const cells: RenderCell[] = board
      ? board.fishes
          .filter((f) => f.status === 'ACTIVE' || anim.indexOf(f.id) > -1)
          .map((f) => ({
            id: f.id,
            col: f.col,
            row: f.row,
            dir: f.direction,
            rotate: ROTATE[f.direction] ?? 0,
            exiting: anim.indexOf(f.id) > -1,
            mistake: mistakeId === f.id,
          }))
      : []
    const s = engine.getState()
    this.setData({
      cells,
      clearedPools: s.clearedPools,
      releasedFish: s.releasedFish,
      mistakes: s.mistakes,
    })
  },

  onCellTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (this.data.view !== 'playing' || this.data.poolTransition) return
    const res = engine.tapFish(id)
    if (res === 'ignore') return

    if (res === 'fail') {
      this.syncGameView()
      // 第 3 次失误已在引擎内提前结算
      if (engine.isFinished()) {
        this.showResult()
        return
      }
      this.setData({ mistakeId: id })
      if (mistakeTimer) clearTimeout(mistakeTimer)
      mistakeTimer = setTimeout(() => this.setData({ mistakeId: null }), 200)
      return
    }

    // success：逻辑移除已在引擎内完成，此处播离场动画
    this.animateExit(id)
    this.syncGameView()
  },

  /** 离场动画：每条鱼独立计时器，动画结束后进入清池过渡 */
  animateExit(id: string) {
    this.setData({ animatingIds: (this.data.animatingIds || []).concat([id]) })
    if (exitTimers[id]) clearTimeout(exitTimers[id])
    exitTimers[id] = setTimeout(() => {
      delete exitTimers[id]
      this.setData({ animatingIds: (this.data.animatingIds || []).filter((x) => x !== id) })
      this.syncGameView()
      // 若最后一鱼放生导致清池，进入池切换过渡
      if (engine.getState().status === 'transitioning') {
        this.setData({ poolTransition: true, transitionText: '鱼池清空！' })
        if (poolTimer) clearTimeout(poolTimer)
        poolTimer = setTimeout(() => {
          engine.startNextPool()
          this.setData({ poolTransition: false, transitionText: '' })
          this.syncGameView()
        }, POOL_TRANSITION_MS)
      }
    }, EXIT_ANIMATION_MS)
  },

  /** 结算并进入结果页（时间到 / 失误达上限，引擎 finish 幂等） */
  showResult() {
    if (this.data.view === 'result') return
    this.stopTimer()
    const r = engine.finish()
    const isNewBest = this.saveLocal(r)
    this.setData({
      view: 'result',
      result: r,
      accuracyText: `${Math.round(r.accuracy * 100)}%`,
      isNewBest,
    })
  },

  /** 本地保存最佳（清空池数 > 放生数 > 失误少）；Storage 异常不白屏 */
  saveLocal(result: PoolResult): boolean {
    let isNewBest = false
    try {
      const oldPools = Number(wx.getStorageSync(LOCAL_KEY_POOLS) || 0)
      const oldFish = Number(wx.getStorageSync(LOCAL_KEY_FISH) || 0)
      const oldMistakes = Number(wx.getStorageSync(LOCAL_KEY_MISTAKES) || 0)
      if (
        oldPools === 0 ||
        result.clearedPools > oldPools ||
        (result.clearedPools === oldPools && result.releasedFish > oldFish) ||
        (result.clearedPools === oldPools &&
          result.releasedFish === oldFish &&
          result.mistakes < oldMistakes)
      ) {
        wx.setStorageSync(LOCAL_KEY_POOLS, result.clearedPools)
        wx.setStorageSync(LOCAL_KEY_FISH, result.releasedFish)
        wx.setStorageSync(LOCAL_KEY_MISTAKES, result.mistakes)
        isNewBest = true
      }
      wx.setStorageSync(LOCAL_KEY_COUNT, Number(wx.getStorageSync(LOCAL_KEY_COUNT) || 0) + 1)
      wx.setStorageSync(LOCAL_KEY_LAST, result)
    } catch {
      // 忽略：Storage 不可用时仅不保存
    }
    this.syncLocalBest()
    return isNewBest
  },

  syncLocalBest() {
    try {
      const pools = Number(wx.getStorageSync(LOCAL_KEY_POOLS) || 0)
      const fish = Number(wx.getStorageSync(LOCAL_KEY_FISH) || 0)
      this.setData({ localBestText: pools > 0 ? `清空 ${pools} 池 / 放生 ${fish} 条` : '' })
    } catch {
      this.setData({ localBestText: '' })
    }
  },

  backToGames() {
    wx.navigateBack()
  },

  /** 查看排行榜（复用后端 fish-breakout rank，清空池数排序） */
    onOpenRanking() {
    this.setData({ showRanking: true })
  },

  onCloseRanking() {
    this.setData({ showRanking: false })
  },

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
      const res = await post<null>('/api/games/fish-breakout/score', {
        clearedPools: r.clearedPools,
        releasedFish: r.releasedFish,
        mistakes: r.mistakes,
        duration: r.duration,
      })
      return res.code === 200
    } catch {
      return false
    }
  },
})
