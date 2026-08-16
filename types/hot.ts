/**
 * 热榜相关数据类型（与 FishingTime 后端 HotItemDTO / SimilarHotClusterDTO 对齐）
 *
 * 首页 PRD：单平台榜单只渲染 rank + title，其余字段保留类型但首页不展示。
 */

/** 单平台热榜条目（HotItemDTO） */
export interface HotItem {
  rank?: number
  title?: string
  hotScore?: string
  normalizedHotScore?: number
  summary?: string
  url?: string
  replyCount?: number
  viewCount?: number
  author?: string
  publishTime?: string
}

/** 共同热点中的单平台来源（前端处理后渲染用） */
export interface CommonHotSource {
  platform: string
  platformName: string
  rank: number
  url?: string
}

/** 共同热点（前端处理后渲染用） */
export interface CommonHotView {
  title: string
  sources: CommonHotSource[]
  /** 原始 items，用于点击后展示各平台原始标题 */
  rawItems: CommonHotRawItem[]
}

export interface CommonHotRawItem {
  platform: string
  hotItem: HotItem
}

/** 后端共同热点原始结构（SimilarHotClusterDTO） */
export interface CommonHotCluster {
  title: string
  sourceCount: number
  items: CommonHotRawItem[]
}

/** 平台配置：顺序 微博→百度→知乎→抖音→头条（抖音热榜替换虎扑） */
export const PLATFORMS: { id: string; name: string }[] = [
  { id: 'weibo', name: '微博' },
  { id: 'baidu', name: '百度' },
  { id: 'zhihu', name: '知乎' },
  { id: 'douyin', name: '抖音' },
  { id: 'toutiao', name: '头条' },
]

export const PLATFORM_NAME: Record<string, string> = {
  weibo: '微博',
  baidu: '百度',
  zhihu: '知乎',
  douyin: '抖音',
  toutiao: '头条',
}
