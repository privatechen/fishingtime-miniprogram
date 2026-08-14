import { get } from '../../utils/request'

/** 排行榜条目（后端 LeaderboardDTO.Item） */
interface RankItem {
  rank: number
  nickname: string
  score: number
  secondaryScore: number | null
  me: boolean
}

/** 我的排名（后端 LeaderboardDTO.MyRank） */
interface MyRank {
  rank: number
  score: number
  secondaryScore: number | null
}

const PAGE_SIZE = 20

/**
 * 公共排行榜弹层
 *
 * 今日排名 / 总排名 双 Tab（默认今日）；列表 + 底部固定我的排名 + 滚动加载更多 + 重试。
 * scoreType: number=分数原样；seconds=颜色猎手毫秒转秒；pools=鱼群突围清空池数（次级=放生数）
 */
Component({
  properties: {
    visible: { type: Boolean, value: false },
    gameCode: { type: String, value: '' },
    gameName: { type: String, value: '' },
    scoreType: { type: String, value: 'number' },
  },

  data: {
    period: 'TODAY',
    items: [] as RankItem[],
    myRank: null as MyRank | null,
    total: 0,
    page: 1,
    loading: false,
    loadingMore: false,
    error: false,
  },

  observers: {
    visible(v: boolean) {
      if (v) {
        this.reset()
        this.load()
      }
    },
  },

  methods: {
    reset() {
      this.setData({ period: 'TODAY', items: [], myRank: null, total: 0, page: 1, error: false, loadingMore: false })
    },

    onPeriodTap(e: WechatMiniprogram.TouchEvent) {
      const p = e.currentTarget.dataset.period as string
      if (p === this.data.period) return
      this.setData({ period: p, items: [], page: 1, error: false, loadingMore: false })
      this.load()
    },

    async load() {
      if (this.data.loading) return
      this.setData({ loading: true, error: false })
      try {
        const res = await get<{
          period: string
          items: RankItem[]
          myRank: MyRank | null
          total: number
        }>(
          `/api/games/${this.data.gameCode}/leaderboard?period=${this.data.period}&page=${this.data.page}&pageSize=${PAGE_SIZE}`,
        )
        if (res.code === 200 && res.data) {
          const d = res.data
          const items = this.data.page === 1 ? d.items || [] : this.data.items.concat(d.items || [])
          this.setData({ items, myRank: d.myRank || null, total: d.total || 0 })
        } else {
          this.setData({ error: true })
        }
      } catch {
        this.setData({ error: true })
      } finally {
        this.setData({ loading: false, loadingMore: false })
      }
    },

    onScrollBottom() {
      const { items, total, page, loadingMore } = this.data
      if (loadingMore || items.length >= total) return
      this.setData({ page: page + 1, loadingMore: true })
      this.load()
    },

    /** 成绩展示：number=原样；seconds=毫秒转秒；pools=清空池数 */
    formatScore(score: number): string {
      if (score == null) return ''
      if (this.data.scoreType === 'seconds') return `${(score / 1000).toFixed(2)}s`
      if (this.data.scoreType === 'pools') return `${score} 池`
      return String(score)
    },

    formatSecondary(sec: number | null): string {
      if (sec == null) return ''
      if (this.data.scoreType === 'pools') return `放生 ${sec} 条`
      return ''
    },

    noop() {},

    onClose() {
      this.triggerEvent('close')
    },

    onRetry() {
      this.load()
    },
  },
})
