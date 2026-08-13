import { Game2048Engine, type Direction, type BoardTile } from './engine/Game2048Engine'
import { get, post } from '../../../utils/request'
import { ensureLogin } from '../../../utils/auth'

/** 本地存档 key（语义与 Web 版一致） */
const LOCAL_KEY_BOARD = 'fishingtime:local:2048:board'
const LOCAL_KEY_SCORE = 'fishingtime:local:2048:score'
const LOCAL_KEY_BEST = 'fishingtime:local:2048:best'
const LOCAL_KEY_MAXTILE = 'fishingtime:local:2048:maxTile'
const LOCAL_KEY_WON = 'fishingtime:local:2048:hasWon'
const LOCAL_KEY_OVER = 'fishingtime:local:2048:gameOver'

/** 渲染用格子（带 isNew 标记做弹出动画） */
interface RenderTile extends BoardTile {
  isNew: boolean
}

/** 移动滑动最小阈值（px），防误触 */
const SWIPE_THRESHOLD = 20

const engine = new Game2048Engine()

let touchStartX = 0
let touchStartY = 0
/** 手势起点是否在棋盘内（只在棋盘按下才开始响应滑动） */
let gestureFromBoard = false
/** 一次手势只触发一次 move */
let moveFired = false
let newTileTimer: number | null = null
let shakeTimer: number | null = null

Page({
  data: {
    tiles: [] as RenderTile[],
    score: 0,
    best: 0,
    maxTile: 0,
    hasWon: false,
    gameOver: false,
    showRule: false,
    showRestart: false,
    showResult: false,
    showRanking: false,
    rankingLoading: false,
    rankingList: [] as { rank: number; nickname: string; bestScore: number }[],
    saving: false,
    moveFail: false,
    showUsernameDialog: false,
    emptyCells: Array.from({ length: 16 }, (_, i) => i),
  },

  onLoad() {
    this.loadLocal()
  },

  onHide() {
    this.saveLocal()
  },

  onUnload() {
    this.saveLocal()
    if (newTileTimer) clearTimeout(newTileTimer)
  },

  /** 读取本地存档：有效则恢复，否则新局 */
  loadLocal() {
    const best = Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0)
    const hasWon = !!wx.getStorageSync(LOCAL_KEY_WON)
    const gameOver = !!wx.getStorageSync(LOCAL_KEY_OVER)
    const score = Number(wx.getStorageSync(LOCAL_KEY_SCORE) || 0)
    const maxTile = Number(wx.getStorageSync(LOCAL_KEY_MAXTILE) || 0)
    const board = wx.getStorageSync(LOCAL_KEY_BOARD)

    try {
      if (Array.isArray(board) && board.length === 4 && Array.isArray(board[0])) {
        engine.loadState(board, score)
        this.setData({
          tiles: this.renderTiles([]),
          score,
          best,
          maxTile,
          hasWon,
          gameOver,
        })
        console.log('[2048] loadLocal engine=', JSON.stringify(engine.getBoardValues()))
        console.log('[2048] loadLocal ui=', JSON.stringify(this.data.tiles.map((t) => t.value)))
        return
      }
    } catch {
      // Storage 损坏 → 安全回退新局
    }
    this.startNew()
  },

  startNew() {
    engine.init()
    this.setData({
      tiles: this.renderTiles([]),
      score: 0,
      maxTile: 0,
      hasWon: false,
      gameOver: false,
      showResult: false,
    })
    console.log('[2048] startNew engine=', JSON.stringify(engine.getBoardValues()))
    console.log('[2048] startNew ui=', JSON.stringify(this.data.tiles.map((t) => t.value)))
    this.saveLocal()
  },

  /** 渲染 tiles：带 isNew 标记（新生成/合并的格子做弹出动画） */
  renderTiles(newTileIds: number[]): RenderTile[] {
    return engine.getTiles().map((t) => ({
      ...t,
      isNew: newTileIds.includes(t.id),
    }))
  },

  saveLocal() {
    try {
      wx.setStorageSync(LOCAL_KEY_BOARD, engine.getBoardValues())
      wx.setStorageSync(LOCAL_KEY_SCORE, this.data.score)
      const best = Math.max(this.data.best, this.data.score)
      if (best !== this.data.best) {
        this.setData({ best })
        wx.setStorageSync(LOCAL_KEY_BEST, best)
      }
      wx.setStorageSync(LOCAL_KEY_MAXTILE, this.data.maxTile)
      wx.setStorageSync(LOCAL_KEY_WON, this.data.hasWon)
      wx.setStorageSync(LOCAL_KEY_OVER, this.data.gameOver)
    } catch {
      // Storage 不可用则仅不保存
    }
  },

  /** 起点在棋盘：记录手势起点（滑动/抬手在页面级捕获，滑出棋盘也不会丢） */
  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0]
    touchStartX = t.clientX
    touchStartY = t.clientY
    gestureFromBoard = true
    moveFired = false
  },

  /** 页面级 touchmove：起点在棋盘才响应，位移超阈值立即触发一次 move */
  onPageTouchMove(e: WechatMiniprogram.TouchEvent) {
    if (!gestureFromBoard || moveFired) return
    const t = e.touches[0]
    const dx = t.clientX - touchStartX
    const dy = t.clientY - touchStartY
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return

    let dir: Direction
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left'
    else dir = dy > 0 ? 'down' : 'up'
    this.move(dir)
  },

  /** 页面级 touchend：抬手即复位（页面全屏，不会滑出丢失） */
  onPageTouchEnd() {
    gestureFromBoard = false
    moveFired = false
  },

  move(direction: Direction) {
    // 一次手势只触发一次 move（抬手才复位）
    moveFired = true
    if (this.data.gameOver || this.data.showResult) return
    const result = engine.move(direction)
    if (!result.moved) {
      // 无效移动（该方向棋盘无变化）：轻抖反馈，让用户知道"滑了但方向不能动"
      this.flashInvalidMove()
      return
    }

    const maxTile = engine.getMaxTile()
    const score = engine.getScore()
    const win = !this.data.hasWon && maxTile >= 2048
    const gameOver = engine.isGameOver()

    this.setData({
      tiles: this.renderTiles(result.newTileIds),
      score,
      maxTile,
      hasWon: this.data.hasWon || win,
      gameOver,
    })
    console.log('[2048] move后 engine=', JSON.stringify(engine.getBoardValues()))
    console.log('[2048] move后 ui=', JSON.stringify(this.data.tiles.map((t) => t.value)))
    // 动画结束后清除弹出标记
    if (newTileTimer) clearTimeout(newTileTimer)
    newTileTimer = setTimeout(() => {
      this.setData({ tiles: this.renderTiles([]) })
      newTileTimer = null
    }, 250)

    this.saveLocal()

    if (win) {
      wx.showModal({
        title: '🎉 恭喜达成 2048！',
        content: '太棒了！可以继续挑战更高分。',
        showCancel: false,
      })
    }
    if (gameOver) {
      this.setData({ showResult: true })
    }
  },

  /** 无效移动反馈：棋盘轻抖 200ms */
  flashInvalidMove() {
    if (shakeTimer) clearTimeout(shakeTimer)
    this.setData({ moveFail: true })
    shakeTimer = setTimeout(() => this.setData({ moveFail: false }), 200)
  },

  onRestartTap() {
    this.setData({ showRestart: true })
  },
  confirmRestart() {
    this.setData({ showRestart: false })
    this.startNew()
  },
  cancelRestart() {
    this.setData({ showRestart: false })
  },
  onRuleTap() {
    this.setData({ showRule: true })
  },
  closeRule() {
    this.setData({ showRule: false })
  },

  backToGames() {
    wx.navigateBack()
  },

  /** 保存成绩：先玩后登录（首次需设置用户名时弹自定义弹层） */
  async onSaveScore() {
    if (this.data.saving) return
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
      const res = await post<null>('/api/games/2048/score', {
        bestScore: this.data.score,
        maxTile: this.data.maxTile,
      })
      wx.showToast({ title: res.code === 200 ? '保存成功' : '成绩未保存，可稍后重试', icon: res.code === 200 ? 'success' : 'none' })
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

  /** 查看排行榜（复用后端 rank，Top20 分数降序） */
  async onOpenRanking() {
    this.setData({ showRanking: true, rankingLoading: true })
    try {
      const res = await get<{ rank: number; nickname: string; bestScore: number }[]>('/api/games/2048/rank')
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
})
