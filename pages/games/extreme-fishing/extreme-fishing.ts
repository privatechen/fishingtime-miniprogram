import { ExtremeFishingEngine } from './engine/ExtremeFishingEngine'
import type { ExtremeFishingConfig, GameResult, Selection } from './engine/types'
import { post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

type ViewState = 'intro' | 'playing' | 'result'

/** 体验配置（与 Web 端一致） */
const CONFIG: ExtremeFishingConfig = {
  rows: 5,
  cols: 5,
  durationMs: 30_000,
  scorePerFish: 10,
  perfectBonus: 50,
  perfectMinCells: 3,
  perfectMinDensity: 0.8,
  pufferPenalty: 20,
  pufferLimit: 3,
  comboMilestones: [
    { combo: 3, bonus: 30 },
    { combo: 5, bonus: 60 },
    { combo: 8, bonus: 120 },
  ],
  densityBonusTiers: [
    { minDensity: 0.9, factor: 10 },
    { minDensity: 0.6, factor: 5 },
    { minDensity: 0.4, factor: 2 },
  ],
  targetFishCount: 10,
  maxPufferCount: 3,
}

/** 本地成绩 key（与「我的」页预定义一致） */
const LOCAL_KEY_SCORE = 'fishingtime:local:extreme-fishing:bestScore'
const LOCAL_KEY_COMBO = 'fishingtime:local:extreme-fishing:bestCombo'
const LOCAL_KEY_PERFECT = 'fishingtime:local:extreme-fishing:bestPerfectCount'
const LOCAL_KEY_COUNT = 'fishingtime:local:extreme-fishing:gameCount'
const LOCAL_KEY_LAST = 'fishingtime:local:extreme-fishing:lastResult'

interface RenderCell {
  id: string
  row: number
  col: number
  type: string
  selected: boolean
}

const engine = new ExtremeFishingEngine(CONFIG)

let timer: number | null = null
let feedbackTimer: number | null = null
/** 棋盘 boundingRect（touch 坐标 → 格子换算用） */
let boardRect: { left: number; top: number; width: number; height: number } | null = null
/** 拖动选区 */
let dragStart: { row: number; col: number } | null = null
let dragCurrent: { row: number; col: number } | null = null

Page({
  data: {
    view: 'intro' as ViewState,
    remainingSeconds: CONFIG.durationMs / 1000,
    score: 0,
    combo: 0,
    pufferMistakes: 0,
    gridSize: CONFIG.cols,
    cells: [] as RenderCell[],
    result: null as GameResult | null,
    isNewBest: false,
    localBestText: '',
    feedback: null as { text: string; kind: 'ok' | 'perfect' | 'bad' } | null,
    showRanking: false,
    saving: false,
    showUsernameDialog: false,
  },

  onLoad() {
    this.syncLocalBest()
  },

  /** 切后台不暂停 30 秒：回前台重算，已超时结算 */
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

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
    if (feedbackTimer) clearTimeout(feedbackTimer)
  },

  startGame() {
    if (timer) return
    engine.start()
    this.setData({ view: 'playing', result: null, feedback: null, score: 0, combo: 0, pufferMistakes: 0 })
    this.syncCells()
    this.startTimer()
    // 等棋盘渲染后取 boundingRect（用于 touch 换算）
    setTimeout(() => this.queryBoardRect(), 80)
  },

  startTimer() {
    this.stopTimer()
    timer = setInterval(() => {
      if (!engine.isRunning()) return
      const remain = engine.remainingTimeMs()
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

  queryBoardRect() {
    wx.createSelectorQuery()
      .select('.fish-board')
      .boundingClientRect((rect) => {
        if (rect) {
          boardRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
      })
      .exec()
  },

  /** touch 坐标 → 格子 */
  cellFromTouch(clientX: number, clientY: number): { row: number; col: number } {
    const r = boardRect
    if (!r || r.width === 0) return { row: 0, col: 0 }
    const col = Math.floor(((clientX - r.left) / r.width) * CONFIG.cols)
    const row = Math.floor(((clientY - r.top) / r.height) * CONFIG.rows)
    return {
      row: Math.min(Math.max(row, 0), CONFIG.rows - 1),
      col: Math.min(Math.max(col, 0), CONFIG.cols - 1),
    }
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    if (this.data.view !== 'playing' || !engine.isRunning()) return
    const t = e.touches[0]
    const cell = this.cellFromTouch(t.clientX, t.clientY)
    dragStart = cell
    dragCurrent = cell
    this.syncCells()
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    if (!dragStart) return
    const t = e.touches[0]
    dragCurrent = this.cellFromTouch(t.clientX, t.clientY)
    this.syncCells()
  },

  onTouchEnd() {
    if (!dragStart || !dragCurrent) {
      dragStart = null
      dragCurrent = null
      return
    }
    const sel: Selection = {
      startRow: dragStart.row,
      startCol: dragStart.col,
      endRow: dragCurrent.row,
      endCol: dragCurrent.col,
    }
    dragStart = null
    dragCurrent = null
    this.resolveNet(sel)
  },

  resolveNet(sel: Selection) {
    if (this.data.view !== 'playing' || !engine.isRunning()) return
    const res = engine.resolveNet(sel)
    const s = engine.getState()
    this.setData({ score: s.score, combo: s.combo, pufferMistakes: s.pufferMistakes })
    this.syncCells()
    if (res.type === 'puffer') this.showFeedback('河豚！Combo 中断', 'bad')
    else if (res.type === 'success' && res.perfect) this.showFeedback(`PERFECT +${res.gained}`, 'perfect')
    else if (res.type === 'success') this.showFeedback(`+${res.gained}`, 'ok')
    if (engine.isFinished()) this.showResult()
  },

  syncCells() {
    const board = engine.getState().board
    const ds = dragStart
    const dc = dragCurrent
    const inRect = (r: number, c: number): boolean => {
      if (!ds || !dc) return false
      return (
        r >= Math.min(ds.row, dc.row) &&
        r <= Math.max(ds.row, dc.row) &&
        c >= Math.min(ds.col, dc.col) &&
        c <= Math.max(ds.col, dc.col)
      )
    }
    const cells: RenderCell[] = board.map((cell) => ({
      id: cell.id,
      row: cell.row,
      col: cell.col,
      type: cell.type,
      selected: inRect(cell.row, cell.col),
    }))
    this.setData({ cells })
  },

  showFeedback(text: string, kind: 'ok' | 'perfect' | 'bad') {
    this.setData({ feedback: { text, kind } })
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => this.setData({ feedback: null }), 700)
  },

  showResult() {
    if (this.data.view === 'result') return
    this.stopTimer()
    const r = engine.finish()
    const isNewBest = this.saveLocal(r)
    this.setData({ view: 'result', result: r, isNewBest })
  },

  /** 本地最佳（Storage 异常不白屏） */
  saveLocal(result: GameResult): boolean {
    let isNewBest = false
    try {
      const old = Number(wx.getStorageSync(LOCAL_KEY_SCORE) || 0)
      if (result.score > old) {
        wx.setStorageSync(LOCAL_KEY_SCORE, result.score)
        wx.setStorageSync(LOCAL_KEY_COMBO, result.maxCombo)
        wx.setStorageSync(LOCAL_KEY_PERFECT, result.perfectCount)
        isNewBest = true
      }
      wx.setStorageSync(LOCAL_KEY_COUNT, Number(wx.getStorageSync(LOCAL_KEY_COUNT) || 0) + 1)
      wx.setStorageSync(LOCAL_KEY_LAST, result)
    } catch {
      // 忽略
    }
    this.syncLocalBest()
    return isNewBest
  },

  syncLocalBest() {
    try {
      const score = Number(wx.getStorageSync(LOCAL_KEY_SCORE) || 0)
      this.setData({ localBestText: score > 0 ? `${score} 分` : '' })
    } catch {
      this.setData({ localBestText: '' })
    }
  },

  backToGames() {
    wx.navigateBack()
  },

  /** 打开排行榜（今日/总 Tab 由公共弹层处理） */
  onOpenRanking() {
    this.setData({ showRanking: true })
  },

  onCloseRanking() {
    this.setData({ showRanking: false })
  },

  /** 保存成绩：先玩后登录 */
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
      const res = await post<null>('/api/games/extreme-fishing/score', {
        score: r.score,
        caughtFish: r.caughtFish,
        perfectCount: r.perfectCount,
        maxCombo: r.maxCombo,
        pufferMistakes: r.pufferMistakes,
      })
      return res.code === 200
    } catch {
      return false
    }
  },
})
