import { get, post, put, getToken, getUser, setUser } from '../../utils/request'
import { ensureLogin } from '../../utils/auth'

/** 后端我的成绩（GameRecordDTO） */
interface ServerRecord {
  gameType: string
  bestScore?: number
  maxTile?: number
  bestAccuracy?: number
  maxStreak?: number
  bestFinalTime?: number
  bestActualTime?: number
  lowestErrorCount?: number
  bestClearedPools?: number
  bestReleasedFish?: number
  bestMistakes?: number
  bestPerfectCount?: number
  bestMaxCombo?: number
  bestPufferMistakes?: number
}

/** 我的游戏展示视图 */
interface GameRecordView {
  id: string
  name: string
  /** emoji 或图片路径 */
  icon: string
  /** 图标是否为图片路径（true 渲染 image，false 渲染 emoji） */
  hasIcon: boolean
  primaryLabel: string
  primaryValue: string
  secondaryLabel: string
  secondaryValue: string
}

/** 本机本地成绩（游戏接入时写入这些 key）；审核期仅保留展示的三个 */
interface LocalRecords {
  'color-focus'?: { best?: number; accuracy?: number }
  'direction-trap'?: { best?: number }
}

const GAME_LOCAL_KEYS: Record<string, string> = {
  'color-focus': 'fishingtime:local:color-focus:best',
  'color-focus:accuracy': 'fishingtime:local:color-focus:accuracy',
  'direction-trap': 'fishingtime:local:direction-trap:best',
}

Page({
  data: {
    loggedIn: false,
    loggingIn: false,
    nickname: '未登录',
    games: [] as GameRecordView[],
    showFeedback: false,
    feedbackContent: '',
    feedbackSubmitting: false,
    showUsernameDialog: false,
    showUsernameEdit: false,
    editUsername: '',
    editError: '',
    editSubmitting: false,
  },

  onShow() {
    const loggedIn = !!getToken()
    const user = getUser()
    this.setData({ loggedIn, nickname: user?.nickname || '未登录' })
    this.refreshGames()
  },

  /** 刷新成绩：登录拉后端，游客读本地 */
  refreshGames() {
    const local = this.readLocalRecords()
    if (this.data.loggedIn) {
      this.loadServerRecords(local)
    } else {
      this.setData({ games: this.buildGames([], local) })
    }
  },

  async loadServerRecords(local: LocalRecords) {
    try {
      const res = await get<ServerRecord[]>('/api/games/my-records')
      this.setData({ games: this.buildGames(res.data || [], local) })
    } catch {
      // 失败：保留本地成绩，不整页不可用
      this.setData({ games: this.buildGames([], local) })
      wx.showToast({ title: '账号成绩加载失败', icon: 'none' })
    }
  },

  readLocalRecords(): LocalRecords {
    const num = (key: string): number | undefined => {
      const v = wx.getStorageSync(key)
      return typeof v === 'number' && v > 0 ? v : undefined
    }
    return {
      'color-focus': {
        best: num(GAME_LOCAL_KEYS['color-focus']),
        accuracy: num(GAME_LOCAL_KEYS['color-focus:accuracy']),
      },
      'direction-trap': { best: num(GAME_LOCAL_KEYS['direction-trap']) },
    }
  },

  /** 账号成绩与本地成绩合并：得分制取更大；审核期仅展示保留的三个入口 */
  buildGames(server: ServerRecord[], local: LocalRecords): GameRecordView[] {
    const s = (id: string) => server.find((r) => r.gameType === id)
    const fmtAccuracy = (v?: number) => (v == null ? '' : `${Math.round(v * 100)}%`)

    const sCf = s('color-focus')
    const bestCf = this.maxNum(sCf?.bestScore, local['color-focus']?.best)
    const accuracy = sCf?.bestAccuracy ?? local['color-focus']?.accuracy

    const sDt = s('direction-trap')
    const bestDt = this.maxNum(sDt?.bestScore, local['direction-trap']?.best)

    // 只保留玩过的游戏（本地或账号有核心成绩），没玩过的不显示
    const views: GameRecordView[] = []
    if (bestCf != null) {
      views.push({
        id: 'color-focus', name: '专注色彩', icon: '/assets/games/color-focus.png', hasIcon: true,
        primaryLabel: '最高分', primaryValue: String(bestCf),
        secondaryLabel: '最高正确率', secondaryValue: fmtAccuracy(accuracy),
      })
    }
    if (bestDt != null) {
      views.push({
        id: 'direction-trap', name: '方向陷阱', icon: '/assets/games/direction-trap.png', hasIcon: true,
        primaryLabel: '最高分', primaryValue: String(bestDt),
        secondaryLabel: '最高连对', secondaryValue: sDt?.maxStreak != null ? String(sDt.maxStreak) : '',
      })
    }
    return views
  },

  maxNum(a?: number, b?: number): number | undefined {
    if (a == null) return b
    if (b == null) return a
    return Math.max(a, b)
  },

  /** 登录/注册：先玩后登录，主动点击才建立身份（首次需设置用户名时弹自定义弹层） */
  async onSaveRecord() {
    if (this.data.loggedIn) {
      wx.showToast({ title: '已登录', icon: 'success' })
      return
    }
    if (this.data.loggingIn) return
    this.setData({ loggingIn: true })
    wx.showLoading({ title: '登录中...' })
    try {
      const login = await ensureLogin()
      if (login === 'needUsername') {
        this.setData({ showUsernameDialog: true })
        return
      }
      if (login === 'ok') {
        this.applyLogin()
      } else {
        wx.showToast({ title: '未登录', icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ loggingIn: false })
    }
  },

  /** 登录成功：刷新身份区 + 成绩 */
  applyLogin() {
    const user = getUser()
    this.setData({ loggedIn: true, nickname: user?.nickname || '未登录' })
    wx.showToast({ title: '登录成功', icon: 'success' })
    this.refreshGames()
  },

  /** 用户名设置成功（注册已自动登录） */
  onUsernameConfirmed() {
    this.setData({ showUsernameDialog: false })
    this.applyLogin()
  },
  onUsernameClose() {
    this.setData({ showUsernameDialog: false })
  },

  /** 点击游戏卡片：进入小游戏 Tab（V1 游戏页后续接入） */
  onGameTap() {
    wx.switchTab({ url: '/pages/games/games' })
  },

  onAbout() {
    wx.showModal({
      title: '关于这个小程序',
      content: '没啥。',
      showCancel: false,
    })
  },

  /** 说你要啥：打开反馈输入弹层 */
  onFeedbackTap() {
    this.setData({ showFeedback: true, feedbackContent: '' })
  },

  onCloseFeedback() {
    if (this.data.feedbackSubmitting) return
    this.setData({ showFeedback: false })
  },

  onFeedbackInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ feedbackContent: e.detail.value })
  },

  /** 提交反馈（可登录可不登录，登录则后端记录 userId） */
  async onSubmitFeedback() {
    const content = this.data.feedbackContent.trim()
    if (!content) {
      wx.showToast({ title: '有什么要说的？', icon: 'none' })
      return
    }
    if (this.data.feedbackSubmitting) return
    this.setData({ feedbackSubmitting: true })
    try {
      const res = await post<null>('/api/feedback', { content })
      if (res.code === 200) {
        this.setData({ showFeedback: false, feedbackContent: '' })
        wx.showToast({ title: '已收到，谢谢反馈', icon: 'success' })
      } else {
        wx.showToast({ title: res.message || '提交失败', icon: 'none' })
      }
    } catch {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' })
    } finally {
      this.setData({ feedbackSubmitting: false })
    }
  },

  /** 打开修改用户名弹层（输入框留空便于输入新名） */
  onEditUsername() {
    this.setData({ showUsernameEdit: true, editUsername: '', editError: '' })
  },

  onEditUsernameInput(e: WechatMiniprogram.Input) {
    this.setData({ editUsername: e.detail.value, editError: '' })
  },

  onEditUsernameClose() {
    if (this.data.editSubmitting) return
    this.setData({ showUsernameEdit: false })
  },

  /** 提交修改用户名（方案A：昵称同步为新用户名） */
  async onEditUsernameSubmit() {
    const name = this.data.editUsername.trim()
    if (name.length < 3 || name.length > 32) {
      this.setData({ editError: '用户名需 3~32 个字符' })
      return
    }
    if (this.data.editSubmitting) return
    this.setData({ editSubmitting: true })
    try {
      const res = await put<{ id: number; username: string; nickname: string }>('/api/users/me', {
        username: name,
        nickname: name,
      })
      if (res.code === 200 && res.data) {
        setUser({ id: res.data.id, username: res.data.username, nickname: res.data.nickname })
        this.setData({ showUsernameEdit: false, editUsername: '', nickname: res.data.nickname })
        wx.showToast({ title: '用户名已更新', icon: 'success' })
      } else {
        this.setData({ editError: res.message || '修改失败' })
      }
    } catch {
      this.setData({ editError: '网络异常，请重试' })
    } finally {
      this.setData({ editSubmitting: false })
    }
  },

  /** 空操作：弹层 catchtap 阻止冒泡 */
  noop() {},
})
