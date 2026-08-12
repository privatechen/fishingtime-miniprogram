import { get } from '../../utils/request'
import {
  PLATFORMS,
  PLATFORM_NAME,
  type HotItem,
  type CommonHotView,
  type CommonHotSource,
  type CommonHotCluster,
  type CommonHotRawItem,
} from '../../types/hot'

/** 共同热点详情弹层条目 */
interface CommonDetailItem {
  platformName: string
  title: string
  url?: string
}

Page({
  data: {
    platforms: PLATFORMS,
    /** swiper 当前索引（与 activePlatform 联动） */
    current: 0,
    activePlatform: 'weibo',
    /** 共同热点（Top 2；为空时模块隐藏） */
    commonHotspots: [] as CommonHotView[],
    /** 各平台热榜缓存：platform → list（swiper-item 各自渲染） */
    platformCache: {} as Record<string, HotItem[]>,
    /** 各平台是否已尝试加载（成功或失败） */
    platformLoaded: {} as Record<string, boolean>,
    lastUpdateTime: '',
    refreshing: false,
    showCommonDetail: false,
    commonDetail: [] as CommonDetailItem[],
    /** 外部链接操作弹层 */
    showAction: false,
    actionSource: '',
    actionUrl: '',
    actionTip: '你以为会打开详情？我也想，可惜跳不出去～只能复制 → 浏览器 → 粘贴',
  },

  onLoad() {
    this.loadCommonHot()
    this.loadPlatform('weibo')
  },

  /** 加载全网共同热点（Top 2；失败或为空时隐藏模块） */
  async loadCommonHot() {
    try {
      const res = await get<CommonHotCluster[]>('/api/hot/similar/clusters')
      const hotspots = (res.data || []).slice(0, 2).map((cluster) => this.toCommonHotView(cluster))
      this.setData({ commonHotspots: hotspots })
    } catch {
      this.setData({ commonHotspots: [] })
    }
  },

  toCommonHotView(cluster: CommonHotCluster): CommonHotView {
    const sources: CommonHotSource[] = (cluster.items || []).slice(0, 3).map((item) => ({
      platform: item.platform,
      platformName: PLATFORM_NAME[item.platform] || item.platform,
      rank: item.hotItem?.rank ?? 0,
      url: item.hotItem?.url,
    }))
    return { title: cluster.title, sources, rawItems: cluster.items || [] }
  },

  /** 点击顶部 Tab：只需改 current，swiper bindchange 会统一处理加载 */
  onTabTap(e: WechatMiniprogram.TouchEvent) {
    const platform = e.currentTarget.dataset.platform as string
    const index = this.data.platforms.findIndex((p) => p.id === platform)
    if (index === -1 || index === this.data.current) return
    this.setData({ current: index })
  },

  /** 左右滑动（或 current 变化）联动：更新 activePlatform + 懒加载该平台 */
  onSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const current = e.detail.current as number
    const platform = this.data.platforms[current]
    if (!platform || platform.id === this.data.activePlatform) return
    this.setData({ activePlatform: platform.id, current })
    if (!this.data.platformLoaded[platform.id]) {
      this.loadPlatform(platform.id)
    }
  },

  async loadPlatform(platform: string) {
    try {
      const res = await get<HotItem[]>('/api/hot/' + platform)
      const list = (res.data || []).filter((i) => i.rank != null && i.title)
      this.setData({
        [`platformCache.${platform}`]: list,
        [`platformLoaded.${platform}`]: true,
        lastUpdateTime: this.formatUpdateTime(res.updateTime),
      })
    } catch {
      // 失败：标记已加载（显示空态），保留已有缓存
      this.setData({ [`platformLoaded.${platform}`]: true })
      wx.showToast({ title: '网络开小差了，下拉重试', icon: 'none' })
    }
  },

  /** scroll-view 下拉刷新：只重新请求后端最新数据，不触发爬虫 */
  async onRefresh() {
    this.setData({ refreshing: true })
    await Promise.all([this.loadCommonHot(), this.loadPlatform(this.data.activePlatform)])
    this.setData({ refreshing: false })
  },

  formatUpdateTime(t?: string): string {
    if (!t) return ''
    const d = new Date(t)
    if (isNaN(d.getTime())) return ''
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  },

  /** 点击共同热点：底部弹层展示各平台原始标题 */
  onCommonTap(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const cluster = this.data.commonHotspots[index]
    if (!cluster) return
    const commonDetail: CommonDetailItem[] = cluster.rawItems
      .map((item: CommonHotRawItem) => ({
        platformName: PLATFORM_NAME[item.platform] || item.platform,
        title: item.hotItem?.title || '',
        url: item.hotItem?.url,
      }))
      .filter((i: CommonDetailItem) => i.title)
    this.setData({ commonDetail, showCommonDetail: true })
  },

  onCloseCommonDetail() {
    this.setData({ showCommonDetail: false })
  },

  /** 点击单平台热榜标题：弹出操作层（来源 = 当前平台） */
  onHotTap(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string
    this.openWeb(url, PLATFORM_NAME[this.data.activePlatform] || this.data.activePlatform)
  },

  /** 点击共同热点弹层中的具体平台标题 */
  onCommonItemTap(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const item = this.data.commonDetail[index]
    this.openWeb(item?.url, item?.platformName)
  },

  /**
   * 打开外部链接：弹出操作层（来源 + 复制），确认后再复制到剪贴板。
   * 第三方平台域名无法配置 web-view 业务域名（真机必然被拦截），只能复制让用户去浏览器打开。
   */
  openWeb(url?: string, source?: string) {
    if (!url) {
      wx.showToast({ title: '暂无可用链接', icon: 'none' })
      return
    }
    this.setData({ actionUrl: url, actionSource: source || '', showAction: true })
  },

  /** 复制链接到剪贴板并提示 */
  onCopyLink() {
    const url = this.data.actionUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '我也想跳。。。但是跳不了😞 链接已复制，请在浏览器中打开', icon: 'none' })
      },
    })
    this.setData({ showAction: false })
  },

  onCloseAction() {
    this.setData({ showAction: false })
  },

  /** 空操作：用于弹层 catchtap 阻止冒泡 */
  noop() {},
})
