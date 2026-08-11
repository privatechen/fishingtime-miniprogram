Page({
  data: {
    webUrl: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const url = options.url ? decodeURIComponent(options.url) : ''
    this.setData({ webUrl: url })
  },

  /** web-view 加载失败：降级为复制链接，提示用户去浏览器打开 */
  onWebError() {
    const url = this.data.webUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '网页打开失败，链接已复制', icon: 'none' })
      },
    })
  },
})
