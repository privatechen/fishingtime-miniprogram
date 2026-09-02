import { ensureLogin } from './auth'
import { post } from './request'

const LAST_REPORT_KEY = 'fishingtime:analytics:lastVisitReportAt'
const REPORT_INTERVAL_MS = 30 * 60 * 1000
let reportPromise: Promise<void> | null = null

/**
 * 上报一次有效进入：同一设备 30 分钟内只上报一次，避免页面切换/重复 onShow 造成频繁写库。
 */
export function reportVisit(): Promise<void> {
  if (reportPromise) return reportPromise

  const last = Number(wx.getStorageSync(LAST_REPORT_KEY) || 0)
  if (last > 0 && Date.now() - last < REPORT_INTERVAL_MS) return Promise.resolve()

  reportPromise = (async () => {
    const login = await ensureLogin()
    if (login !== 'ok') return

    try {
      const res = await post<null>('/api/analytics/visit', {})
      if (res.code === 200) wx.setStorageSync(LAST_REPORT_KEY, Date.now())
    } catch {
      // 统计失败不影响小程序主流程，下次进入仍会重试
    }
  })().finally(() => {
    reportPromise = null
  })

  return reportPromise
}
