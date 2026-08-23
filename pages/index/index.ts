/**
 * 「瞅瞅」问答页（替换原热榜）
 *
 * 核心循环：选分类 → 看问题 → 选答案 → 揭晓比例 → 下一题。
 * 一屏一题；答题前不展示比例；同一用户同一题幂等。
 */
import { get, post } from '../../utils/request'
import { ensureLogin } from '../../utils/auth'

interface QaCategory {
  id: number
  code: string
  name: string
  icon: string
}
interface QaOption {
  id: number
  content: string
  icon: string
  sortOrder: number
  voteCount: number
  percent: number | null
  /** 展示文本（预计算） */
  percentText: string
}
interface QaQuestion {
  id: number
  categoryId: number
  categoryName: string
  content: string
  answerCount: number
  answered: boolean
  myOptionId: number | null
  options: QaOption[]
  /** 展示文本（预计算） */
  answerCountText: string
}
interface QaNextResponse {
  finished: boolean
  question: QaQuestion | null
}

/** 我的投稿 */
interface QaMySubmitVO {
  questionId: number
  categoryId: number
  categoryName: string
  content: string
  status: number
  rejectReason: string
  answerCount: number
  answered: boolean
  myOptionId: number | null
  options: QaOption[]
}

const RECOMMEND: QaCategory = { id: 0, code: 'recommend', name: '推荐', icon: '✨' }

/** 数字千分位 */
function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 装饰题目：预计算展示文本，避免 WXML 内做格式化 */
function decorate(q: QaQuestion): QaQuestion {
  return {
    ...q,
    answerCountText: fmt(q.answerCount || 0),
    options: (q.options || []).map((o) => ({
      ...o,
      percentText: o.percent != null ? `${o.percent.toFixed(1)}%` : '',
    })),
  }
}

Page({
  data: {
    categories: [RECOMMEND] as QaCategory[],
    activeCategoryCode: 'recommend',
    question: null as QaQuestion | null,
    finished: false,
    loading: true,
    error: '',
    showUsernameDialog: false,
    submitting: false,
    /** 我选的选项百分比（结果态反馈文案用） */
    myPercentText: '',
    /** 出题投稿 */
    showSubmit: false,
    realCategories: [] as QaCategory[],
    submitCategory: '',
    submitContent: '',
    submitOptions: [
      { icon: '', content: '' },
      { icon: '', content: '' },
    ] as { icon: string; content: string }[],
    submitError: '',
    submitSubmitting: false,
    /** 我选的答案（选项下标，-1=未选，可选） */
    submitAnswerIndex: -1,
    /** 我的投稿 */
    showMine: false,
    mineList: [] as QaMySubmitVO[],
    mineDetail: null as QaMySubmitVO | null,
    mineSubmitting: false,
  },

  onLoad() {
    this.init()
  },

  async init() {
    const login = await ensureLogin()
    if (login === 'needUsername') {
      this.setData({ showUsernameDialog: true })
      return
    }
    if (login !== 'ok') {
      this.setData({ loading: false, error: '登录失败，请重试' })
      return
    }
    await this.loadCategories()
    await this.loadNext()
  },

  onUsernameConfirmed() {
    this.setData({ showUsernameDialog: false })
    this.init()
  },

  onUsernameClose() {
    this.setData({ showUsernameDialog: false })
  },

  async loadCategories() {
    try {
      const res = await get<QaCategory[]>('/api/qa/categories')
      if (res.code === 200 && res.data) {
        this.setData({ categories: [RECOMMEND, ...res.data], realCategories: res.data })
      }
    } catch {
      // 分类加载失败不阻塞（推荐仍可用）
    }
  },

  async loadNext() {
    this.setData({ loading: true, error: '', finished: false, question: null, myPercentText: '' })
    try {
      const res = await get<QaNextResponse>(
        `/api/qa/questions/next?categoryCode=${this.data.activeCategoryCode}`,
      )
      if (res.code === 200 && res.data) {
        const question = res.data.question ? decorate(res.data.question) : null
        this.setData({
          loading: false,
          finished: res.data.finished,
          question,
          myPercentText: question && question.answered ? this.myPercent(question) : '',
        })
      } else {
        this.setData({ loading: false, error: res.message || '加载失败' })
      }
    } catch {
      this.setData({ loading: false, error: '网络异常，请重试' })
    }
  },

  onCategoryTap(e: WechatMiniprogram.TouchEvent) {
    const code = e.currentTarget.dataset.code as string
    if (code === this.data.activeCategoryCode) return
    this.setData({ activeCategoryCode: code })
    this.loadNext()
  },

  async onOptionTap(e: WechatMiniprogram.TouchEvent) {
    const question = this.data.question
    if (this.data.submitting || !question || question.answered) return
    const optionId = Number(e.currentTarget.dataset.oid)
    this.setData({ submitting: true })
    try {
      const res = await post<QaQuestion>(`/api/qa/questions/${question.id}/answer`, { optionId })
      if (res.code === 200 && res.data) {
        const answered = decorate(res.data)
        this.setData({ question: answered, myPercentText: this.myPercent(answered) })
      } else {
        wx.showToast({ title: res.message || '提交失败', icon: 'none' })
      }
    } catch {
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onNext() {
    this.loadNext()
  },

  onSeeRecommend() {
    this.setData({ activeCategoryCode: 'recommend' })
    this.loadNext()
  },

  /** 跳转解压工具 Tab */
  onGoDecompress() {
    wx.switchTab({ url: '/pages/games/games' })
  },

  // ────────────── 出题投稿 ──────────────

  async openSubmit() {
    // 打开前确保分类已加载（修复投稿无法选分类）
    await this.loadCategories()
    this.setData({ showSubmit: true, submitError: '', submitAnswerIndex: -1 })
  },

  onMarkAnswer(e: WechatMiniprogram.TouchEvent) {
    this.setData({ submitAnswerIndex: Number(e.currentTarget.dataset.index) })
  },

  closeSubmit() {
    this.setData({ showSubmit: false })
  },

  onPickCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ submitCategory: e.currentTarget.dataset.code as string })
  },

  onSubmitContent(e: WechatMiniprogram.Input) {
    this.setData({ submitContent: e.detail.value })
  },

  onSubmitOptIcon(e: WechatMiniprogram.Input) {
    const i = Number(e.currentTarget.dataset.index)
    const key = `submitOptions[${i}].icon`
    this.setData({ [key]: e.detail.value })
  },

  onSubmitOptContent(e: WechatMiniprogram.Input) {
    const i = Number(e.currentTarget.dataset.index)
    const key = `submitOptions[${i}].content`
    this.setData({ [key]: e.detail.value })
  },

  onAddOption() {
    if (this.data.submitOptions.length >= 6) {
      wx.showToast({ title: '最多 6 个选项', icon: 'none' })
      return
    }
    this.setData({ submitOptions: [...this.data.submitOptions, { icon: '', content: '' }] })
  },

  onRemoveOption(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index)
    if (this.data.submitOptions.length <= 2) return
    const opts = this.data.submitOptions.filter((_, idx) => idx !== i)
    this.setData({ submitOptions: opts })
  },

  async onSubmitQuestion() {
    if (this.data.submitSubmitting) return
    const catId = this.data.realCategories.find((c) => c.code === this.data.submitCategory)?.id
    if (!catId) {
      this.setData({ submitError: '请选择分类' })
      return
    }
    if (!this.data.submitContent.trim()) {
      this.setData({ submitError: '请填写问题' })
      return
    }
    const options = this.data.submitOptions
      .map((o) => ({ content: o.content.trim(), icon: o.icon }))
      .filter((o) => o.content)
    if (options.length < 2) {
      this.setData({ submitError: '至少填写 2 个选项' })
      return
    }
    this.setData({ submitSubmitting: true, submitError: '' })
    try {
      const body: Record<string, unknown> = {
        categoryId: catId,
        content: this.data.submitContent.trim(),
        options,
      }
      // 可选：用户选了自己的答案则一起提交（下标需映射到过滤后的选项数组）
      const marked = this.data.submitOptions[this.data.submitAnswerIndex]
      if (marked && marked.content.trim()) {
        const idxInFiltered = this.data.submitOptions
          .slice(0, this.data.submitAnswerIndex)
          .filter((o) => o.content.trim()).length
        body.answerIndex = idxInFiltered
      }
      const res = await post('/api/qa/submit', body)
      if (res.code === 200) {
        this.setData({ showSubmit: false, submitContent: '', submitCategory: '', submitAnswerIndex: -1 })
        wx.showToast({ title: '提交成功，等待审核', icon: 'success' })
      } else {
        this.setData({ submitError: res.message || '提交失败' })
      }
    } catch {
      this.setData({ submitError: '网络异常，请重试' })
    } finally {
      this.setData({ submitSubmitting: false })
    }
  },

  // ────────────── 我的投稿 ──────────────

  /** 打开我的投稿弹层 */
  async openMine() {
    this.setData({ showMine: true, mineDetail: null })
    try {
      const res = await get<QaMySubmitVO[]>('/api/qa/questions/mine')
      if (res.code === 200 && res.data) {
        const list = res.data.map((it) => ({
          ...it,
          options: (it.options || []).map((o) => ({
            ...o,
            percentText: o.percent != null ? `${o.percent.toFixed(1)}%` : '',
          })),
        }))
        this.setData({ mineList: list })
      }
    } catch {
      wx.showToast({ title: '我的投稿加载失败', icon: 'none' })
    }
  },

  closeMine() {
    this.setData({ showMine: false, mineDetail: null })
  },

  onMineItemTap(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index)
    this.setData({ mineDetail: this.data.mineList[idx] })
  },

  onMineBack() {
    this.setData({ mineDetail: null })
  },

  /** 回答自己的待审题 */
  async onMineOptionTap(e: WechatMiniprogram.TouchEvent) {
    const detail = this.data.mineDetail
    if (this.data.mineSubmitting || !detail || detail.answered) return
    const optionId = Number(e.currentTarget.dataset.oid)
    this.setData({ mineSubmitting: true })
    try {
      const res = await post<QaQuestion>(`/api/qa/questions/${detail.questionId}/answer`, { optionId })
      if (res.code === 200 && res.data) {
        const answered = decorate(res.data)
        this.setData({
          mineDetail: {
            ...detail,
            answered: true,
            myOptionId: answered.myOptionId,
            answerCount: answered.answerCount,
            options: answered.options,
          },
        })
      } else {
        wx.showToast({ title: res.message || '提交失败', icon: 'none' })
      }
    } catch {
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    } finally {
      this.setData({ mineSubmitting: false })
    }
  },

  /** 我选的选项百分比文本 */
  myPercent(question: QaQuestion): string {
    const mine = question.options.find((o) => o.id === question.myOptionId)
    return mine && mine.percent != null ? mine.percent.toFixed(0) : ''
  },
})
