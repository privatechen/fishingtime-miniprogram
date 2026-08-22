interface GameItem {
  id: string
  name: string
  desc: string
  icon: string
  /** 封面图路径（有则用图，无则用 emoji） */
  cover?: string
  /** 可玩游戏的路由；未开发为 undefined */
  path?: string
}

// 审核要求：不展示游戏，仅保留「非游戏类」三个入口（专注色彩 / 方向陷阱 / 细节）
// 被隐藏的 2048 / 颜色猎手 / 鱼群突围 / 极限捞鱼 代码保留，审核通过后如需恢复加回数组即可
const GAMES: GameItem[] = [
  { id: 'color-focus', name: '专注色彩', desc: '30 秒专注力挑战', icon: '🎨', cover: '/assets/games/color-focus.png', path: '/pages/games/color-focus/color-focus' },
  { id: 'direction-trap', name: '方向陷阱', desc: '30 秒反应挑战', icon: '🧭', cover: '/assets/games/direction-trap.png', path: '/pages/games/direction-trap/direction-trap' },
  { id: 'detail', name: '细节', desc: '看图 10 秒，记住每一个细节', icon: '👀', path: '/pages/games/detail/detail' },
]

Page({
  data: {
    games: GAMES,
  },

  /** 点击游戏卡片：可玩则进入游戏页，未开发提示 */
  onGameTap(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const game = this.data.games[index]
    if (!game) return
    if (game.path) {
      wx.navigateTo({
        url: game.path,
        fail: () => wx.showToast({ title: '页面不存在，请重新编译', icon: 'none' }),
      })
    } else {
      wx.showToast({ title: '敬请期待，正在开发中～', icon: 'none' })
    }
  },
})
