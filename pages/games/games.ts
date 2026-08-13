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

const GAMES: GameItem[] = [
  { id: 'color-focus', name: '专注色彩', desc: '30 秒专注力挑战', icon: '🎨', cover: '/assets/games/color-focus.png', path: '/pages/games/color-focus/color-focus' },
  { id: '2048', name: '2048', desc: '合并数字挑战高分', icon: '🎯', cover: '/assets/games/2048.png', path: '/pages/games/2048/game2048' },
  { id: 'direction-trap', name: '方向陷阱', desc: '30 秒反应挑战', icon: '🧭', cover: '/assets/games/direction-trap.png', path: '/pages/games/direction-trap/direction-trap' },
  { id: 'color-hunter', name: '颜色猎手', desc: '找出所有目标颜色', icon: '🔍', cover: '/assets/games/color-hunter.png', path: '/pages/games/color-hunter/color-hunter' },
  { id: 'fish-breakout', name: '鱼群突围', desc: '30 秒连续清空鱼池', icon: '🐟', cover: '/assets/games/fish-breakout.png', path: '/pages/games/fish-breakout/fish-breakout' },
  { id: 'extreme-fishing', name: '极限捞鱼', desc: '拖动撒网，30 秒冲分', icon: '🎣', cover: '/assets/games/extreme-fishing.png', path: '/pages/games/extreme-fishing/extreme-fishing' },
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
