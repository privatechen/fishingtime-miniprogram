import { post, getToken, setToken, setUser, type StoredUser } from './request'

interface WxLoginResult {
  needUsername?: boolean
  token?: string
  user?: StoredUser
}

/** 登录结果：ok=已有身份可直接操作；needUsername=首次需设置用户名（页面弹自定义弹层）；fail=失败 */
export type LoginResult = 'ok' | 'needUsername' | 'fail'

/** wx.login 获取临时 code */
function getWxCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error('code 为空'))),
      fail: () => reject(new Error('wx.login 失败')),
    })
  })
}

/**
 * 确保已登录（先玩后登录，仅在主动保存时调用）：
 * - 已有 token → ok
 * - wx-login 识别已有用户 → 存 token+user → ok
 * - 首次 → needUsername（页面显示自定义弹层，让用户填用户名后调 registerWithUsername）
 * - 失败 → fail
 */
export async function ensureLogin(): Promise<LoginResult> {
  if (getToken()) return 'ok'
  try {
    const code = await getWxCode()
    const res = await post<WxLoginResult>('/api/auth/wx-login', { code })
    if (res.code !== 200 || !res.data) return 'fail'
    if (res.data.token && res.data.user) {
      setToken(res.data.token)
      setUser(res.data.user)
      return 'ok'
    }
    if (res.data.needUsername) return 'needUsername'
    return 'fail'
  } catch {
    return 'fail'
  }
}

/**
 * 强制刷新登录态：始终用新 code 调 wx-login，返回有效 token 或进入注册。
 * 后端 token 存内存、重启即失效；保存成绩等关键操作前调用，避免用失效 token 静默保存失败。
 */
export async function ensureFreshLogin(): Promise<LoginResult> {
  try {
    const code = await getWxCode()
    const res = await post<WxLoginResult>('/api/auth/wx-login', { code })
    if (res.code !== 200 || !res.data) return 'fail'
    if (res.data.token && res.data.user) {
      setToken(res.data.token)
      setUser(res.data.user)
      return 'ok'
    }
    if (res.data.needUsername) return 'needUsername'
    return 'fail'
  } catch {
    return 'fail'
  }
}

/** 用用户名注册（首次设置用户名建立身份，昵称=用户名），成功则已存 token+user */
export async function registerWithUsername(
  username: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const code = await getWxCode() // 微信 code 一次性，需重新获取
    const res = await post<WxLoginResult>('/api/auth/wx-register', { code, username })
    if (res.code === 200 && res.data?.token && res.data.user) {
      setToken(res.data.token)
      setUser(res.data.user)
      return { ok: true }
    }
    return { ok: false, message: res.message || '注册失败' }
  } catch {
    return { ok: false, message: '网络异常，请重试' }
  }
}
