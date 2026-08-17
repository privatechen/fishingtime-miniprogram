/**
 * 《细节》小程序页 — 状态机：READY → OBSERVING → DRAWING → ANSWERING → RESULT → REVIEW → NEXT → FINISHED
 *
 * - 观察 10 秒（图片加载完成才开始计时；时间戳算差防后台切换漂移）
 * - 图片消失 → 6 张盲选题号卡 → 服务端抽题
 * - 题目出现开始答题计时，上限 8 秒，超时自动作答（服务端判超时）
 * - 中途可随时「结束并保存」（未抽题轮次不计入）；顶部返回需确认
 * - 结算显示每轮明细 + 今日/总排名；未登录「保存成绩」走先玩后登录再补存
 */
import { detailApi } from './engine/DetailSession'
import type {
  DetailStartResponse,
  DetailRoundInfo,
  DetailDrawResponse,
  DetailAnswerResponse,
  DetailFinishResponse,
} from './engine/DetailSession'
import { BASE_URL } from '../../../config/index'
import { ensureLogin, ensureFreshLogin } from '../../../utils/auth'
import { getToken } from '../../../utils/request'

const OBSERVE_MS = 10_000
const ANSWER_MS = 8_000
const TOTAL_ROUNDS = 5
/** 图片加载超时（毫秒）：超过仍未加载成功/失败，视为坏图，允许切换下一张 */
const IMAGE_LOAD_TIMEOUT_MS = 3_000

/** 本地最佳（答对题数） */
const LOCAL_KEY_BEST = 'fishingtime:local:detail:best'

type ViewState = 'intro' | 'observing' | 'drawing' | 'answering' | 'result' | 'review' | 'finished'

interface RoundRow {
  round: number
  label: string
  markClass: string
  timeText: string
}

let sessionId = ''
let rounds: DetailRoundInfo[] = []
let roundIndex = 0
let roundResults: Array<{ correct: boolean; elapsedMs: number }> = []
let observeEndAt = 0
let answerEndAt = 0
let ticker: number | null = null
/** 图片加载超时计时器（观察阶段） */
let imageLoadTimer: number | null = null
/** token 失效后强制刷新登录态的重试开关，防止死循环 */
let finishRetried = false

Page({
  data: {
    view: 'intro' as ViewState,
    roundNum: 1,
    remainingSeconds: 0,
    imageReady: false,
    imageError: false,
    imageUrl: '',
    question: null as DetailDrawResponse | null,
    answer: null as DetailAnswerResponse | null,
    result: null as DetailFinishResponse | null,
    correctNow: 0,
    liveElapsedText: '0.0',
    elapsedText: '',
    answerTimeText: '',
    bestTimeText: '',
    errorText: '',
    submitting: false,
    saving: false,
    showRanking: false,
    showQuitConfirm: false,
    showUsernameDialog: false,
    localBest: 0,
    roundRows: [] as RoundRow[],
  },

  onShow() {
    this.setData({ localBest: Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0) })
  },

  onUnload() {
    this.stopTicker()
    this.clearImageLoadTimer()
  },

  // ────────────── 通用计时 ──────────────

  startTicker(fn: () => void) {
    this.stopTicker()
    ticker = setInterval(fn, 100)
  },

  stopTicker() {
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
  },

  /** 观察阶段图片加载超时：3 秒内既没成功也没失败 → 进入「图片加载失败」状态，避免卡死 */
  startImageLoadTimer() {
    this.clearImageLoadTimer()
    imageLoadTimer = setTimeout(() => {
      if (!this.data.imageReady) {
        this.setData({ imageError: true, imageReady: false })
      }
    }, IMAGE_LOAD_TIMEOUT_MS)
  },

  clearImageLoadTimer() {
    if (imageLoadTimer !== null) {
      clearTimeout(imageLoadTimer)
      imageLoadTimer = null
    }
  },

  // ────────────── 开局 / 观察 ──────────────

  startGame() {
    if (this.data.submitting) return
    this.setData({ submitting: true, errorText: '' })
    detailApi
      .start()
      .then((res) => {
        if (res.code !== 200 || !res.data) throw new Error(res.message || '开局失败')
        const d: DetailStartResponse = res.data
        sessionId = d.sessionId
        rounds = d.rounds
        roundIndex = 0
        roundResults = []
        finishRetried = false
        this.setData({
          submitting: false,
          view: 'observing',
          roundNum: 1,
          imageReady: false,
          imageError: false,
          imageUrl: BASE_URL + d.rounds[0].imageUrl,
          question: null,
          answer: null,
          result: null,
          correctNow: 0,
          liveElapsedText: '0.0',
          errorText: '',
        })
        this.startImageLoadTimer()
      })
      .catch(() => this.setData({ submitting: false, errorText: '开局失败，请重试' }))
  },

  onImageLoad() {
    if (this.data.view !== 'observing' || this.data.imageReady) return
    this.clearImageLoadTimer()
    // 超时置错后图片才加载成功：清除错误态，继续正常计时
    this.setData({ imageReady: true, imageError: false })
    // 图片加载完成才开始观察倒计时
    observeEndAt = Date.now() + OBSERVE_MS
    this.startTicker(() => {
      const remain = observeEndAt - Date.now()
      this.setData({ remainingSeconds: Math.max(0, Math.ceil(remain / 1000)) })
      if (remain <= 0) {
        this.stopTicker()
        this.setData({ view: 'drawing', question: null, answer: null })
      }
    })
  },

  onImageError() {
    this.clearImageLoadTimer()
    this.setData({ imageError: true, imageReady: false })
    this.stopTicker()
  },

  retryImage() {
    this.setData({ imageError: false })
    // 重新加载图片：更新 src 触发 bindload/binderror；同时重置加载超时
    this.setData({ imageUrl: '' })
    wx.nextTick(() => {
      this.setData({ imageUrl: BASE_URL + rounds[roundIndex].imageUrl })
      this.startImageLoadTimer()
    })
  },

  /** 切换下一张：图片拿不到时跳过本轮（未抽题的轮次结算时不计数） */
  skipImage() {
    this.clearImageLoadTimer()
    this.stopTicker()
    this.goNext()
  },

  // ────────────── 抽题 / 作答 ──────────────

  onPickNumber(e: WechatMiniprogram.TouchEvent) {
    const number = Number(e.currentTarget.dataset.number)
    if (this.data.view !== 'drawing' || this.data.submitting) return
    this.setData({ submitting: true, errorText: '' })
    detailApi
      .draw(sessionId, roundIndex + 1, number)
      .then((res) => {
        if (res.code !== 200 || !res.data) throw new Error(res.message || '抽题失败')
        this.setData({ submitting: false, question: res.data, view: 'answering' })
        this.beginAnswer()
      })
      .catch(() => this.setData({ submitting: false, errorText: '抽题失败，请重试' }))
  },

  beginAnswer() {
    // 题目出现开始答题计时，上限 8 秒；超时自动作答（服务端判超时）
    answerEndAt = Date.now() + ANSWER_MS
    this.startTicker(() => {
      const remain = answerEndAt - Date.now()
      this.setData({ remainingSeconds: Math.max(0, Math.ceil(remain / 1000)) })
      if (remain <= 0) {
        this.stopTicker()
        this.submitAnswer(null)
      }
    })
  },

  onChooseOption(e: WechatMiniprogram.TouchEvent) {
    this.submitAnswer(e.currentTarget.dataset.key as string)
  },

  submitAnswer(option: string | null) {
    if (this.data.submitting) return
    this.setData({ submitting: true, errorText: '' })
    detailApi
      .answer(sessionId, roundIndex + 1, option)
      .then((res) => {
        if (res.code !== 200 || !res.data) throw new Error(res.message || '提交失败')
        this.stopTicker()
        const a = res.data
        roundResults[roundIndex] = { correct: a.correct, elapsedMs: a.elapsedMs }
        const correctNow = roundResults.filter((r) => r && r.correct).length
        const liveMs = roundResults.reduce((s, r) => s + (r ? r.elapsedMs : 0), 0)
        this.setData({
          submitting: false,
          answer: a,
          view: 'result',
          elapsedText: (a.elapsedMs / 1000).toFixed(1),
          correctNow,
          liveElapsedText: (liveMs / 1000).toFixed(1),
        })
      })
      .catch(() => {
        // 答题接口失败不判错：服务端计时仍在继续，超时由服务端判定
        this.setData({ submitting: false, errorText: '提交失败，请重试' })
      })
  },

  // ────────────── 回看 / 下一轮 ──────────────

  goReview() {
    this.setData({ view: 'review' })
  },

  goNext() {
    if (roundIndex + 1 < rounds.length) {
      roundIndex++
      this.setData({
        roundNum: roundIndex + 1,
        view: 'observing',
        imageReady: false,
        imageError: false,
        imageUrl: BASE_URL + rounds[roundIndex].imageUrl,
        question: null,
        answer: null,
      })
      this.startImageLoadTimer()
    } else {
      this.finishGame()
    }
  },

  // ────────────── 结算 ──────────────

  /** 结算（含保存）。带 token 但返回未保存时，说明 token 已失效（后端内存态重启即失效），刷新登录态后重试一次 */
  finishGame() {
    if (this.data.submitting || this.data.saving) return
    this.setData({ submitting: true, errorText: '' })
    detailApi
      .finish(sessionId)
      .then((res) => {
        if (res.code !== 200 || !res.data) throw new Error(res.message || '结算失败')
        if (!res.data.saved && getToken() && !finishRetried) {
          finishRetried = true
          this.refreshLoginThenFinish()
          return
        }
        finishRetried = false
        this.renderFinish(res.data)
      })
      .catch((err) => this.setData({ submitting: false, errorText: err.message || '结算失败，请重试' }))
  },

  /** token 失效后：强制刷新登录态再重试结算；新用户弹用户名弹层 */
  refreshLoginThenFinish() {
    ensureFreshLogin().then((login) => {
      if (login === 'needUsername') {
        this.setData({ submitting: false, showUsernameDialog: true })
        return
      }
      if (login === 'ok') {
        detailApi
          .finish(sessionId)
          .then((res) => {
            if (res.code !== 200 || !res.data) throw new Error(res.message || '结算失败')
            finishRetried = false
            this.renderFinish(res.data)
          })
          .catch((err) => this.setData({ submitting: false, errorText: err.message || '结算失败，请重试' }))
        return
      }
      // 登录失败：匿名结算展示结果（saved=false），不再重试
      finishRetried = false
      detailApi
        .finish(sessionId)
        .then((res) => {
          if (res.code === 200 && res.data) {
            this.renderFinish(res.data)
          } else {
            this.setData({ submitting: false, errorText: '结算失败，请重试' })
          }
        })
        .catch(() => this.setData({ submitting: false, errorText: '结算失败，请重试' }))
    })
  },

  /** 渲染结算结果（已保存或匿名），含每轮明细与本地最佳 */
  renderFinish(r: DetailFinishResponse) {
    finishRetried = false
    const roundRows: RoundRow[] = (r.rounds || []).map((x) => ({
      round: x.round,
      label: !x.played ? '未开始' : x.timeout ? '超时' : x.correct ? '✓ 答对' : '✗ 答错',
      markClass: !x.played ? 'skip' : x.correct ? 'ok' : 'bad',
      timeText: x.played ? `${(x.elapsedMs / 1000).toFixed(1)}s` : '',
    }))
    this.setData({
      submitting: false,
      result: r,
      roundRows,
      view: 'finished',
      liveElapsedText: (r.answerTimeMs / 1000).toFixed(1),
      answerTimeText: (r.answerTimeMs / 1000).toFixed(1),
      bestTimeText: r.bestAnswerTimeMs != null ? (r.bestAnswerTimeMs / 1000).toFixed(1) : '',
    })
    // 本地最佳（答对题数）
    const oldBest = Number(wx.getStorageSync(LOCAL_KEY_BEST) || 0)
    if (r.correctCount > oldBest) {
      wx.setStorageSync(LOCAL_KEY_BEST, r.correctCount)
      this.setData({ localBest: r.correctCount })
    }
  },

  /** 结束并保存：停掉计时，确保有效登录后结算保存（token 失效由 finishGame 内刷新重试兜底） */
  endAndSave() {
    this.stopTicker()
    this.clearImageLoadTimer()
    if (getToken()) {
      this.finishGame()
      return
    }
    ensureFreshLogin().then((login) => {
      if (login === 'needUsername') {
        this.setData({ showUsernameDialog: true })
        return
      }
      // ok（已登录）或 fail（匿名）都结算：登录的会保存，匿名的仅展示结果
      this.finishGame()
    })
  },

  // ────────────── 放弃 / 返回 ──────────────

  onQuit() {
    this.setData({ showQuitConfirm: true })
  },

  onCancelQuit() {
    this.setData({ showQuitConfirm: false })
  },

  confirmQuit() {
    this.setData({ showQuitConfirm: false })
    this.stopTicker()
    this.clearImageLoadTimer()
    wx.navigateBack()
  },

  backToGames() {
    wx.navigateBack()
  },

  // ────────────── 保存成绩（先玩后登录，登录后重新 finish 补存） ──────────────

  onSaveScore() {
    if (this.data.saving || this.data.submitting) return
    this.setData({ saving: true })
    ensureLogin().then((login) => {
      if (login === 'needUsername') {
        this.setData({ saving: false, showUsernameDialog: true })
        return
      }
      if (login !== 'ok') {
        this.setData({ saving: false })
        wx.showToast({ title: '登录失败，成绩未保存', icon: 'none' })
        return
      }
      this.setData({ saving: false })
      this.finishGame()
    })
  },

  onUsernameConfirmed() {
    finishRetried = false
    this.setData({ showUsernameDialog: false, saving: false })
    // 注册/登录已拿到有效 token，重新结算即保存
    this.finishGame()
  },

  onUsernameClose() {
    this.setData({ showUsernameDialog: false, saving: false })
    // 从「结束并保存」进入的用户名弹层，取消后匿名结算展示结果
    if (this.data.view !== 'finished') {
      this.finishGame()
    }
  },

  // ────────────── 排行榜 ──────────────

  onOpenRanking() {
    this.setData({ showRanking: true })
  },

  onCloseRanking() {
    this.setData({ showRanking: false })
  },

  /** 空操作：弹层 catchtap 阻止冒泡 */
  noop() {},
})
