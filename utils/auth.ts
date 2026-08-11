import { post, getToken, setToken, setUser, type StoredUser } from './request'

interface WxLoginResult {
  needUsername?: boolean
  token?: string
  user?: StoredUser
}

/** wx.login 获取临时 code */
function getWxCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error('code 为空'))),
      fail: () => reject(new Error('wx.login 失败')),
    })
  })
}

/** 弹输入框设置用户名（微信 showModal editable，基础库 2.17.1+） */
function askUsername(): Promise<string | null> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '设置用户名',
      content: '首次使用，请设置一个用户名（昵称将与之保持一致）',
      editable: true,
      placeholderText: '请输入用户名（3~32 个字符）',
      success: (r) => {
        if (r.confirm && r.content && r.content.trim()) {
          resolve(r.content.trim())
        } else {
          resolve(null)
        }
      },
      fail: () => resolve(null),
    })
  })
}

/**
 * 确保已登录（先玩后登录：仅在主动保存时调用）：
 * - 已有 token → 直接成功
 * - 否则 wx-login 识别：
 *     - 已有用户 → 存 token + user
 *     - 首次 → 引导填用户名 → wx-register（昵称=用户名）→ 存 token + user
 * - 未填/取消/失败 → 返回 false（不保存成绩，成绩保留本地）
 */
export async function ensureLogin(): Promise<boolean> {
  if (getToken()) return true
  try {
    const code = await getWxCode()
    const res = await post<WxLoginResult>('/api/auth/wx-login', { code })
    if (res.code !== 200 || !res.data) return false

    // 已有身份
    if (res.data.token && res.data.user) {
      setToken(res.data.token)
      setUser(res.data.user)
      return true
    }

    // 首次使用：设置用户名注册
    if (res.data.needUsername) {
      const username = await askUsername()
      if (!username) return false
      // 微信 code 一次性，登录时已用掉，需重新获取
      const newCode = await getWxCode()
      const regRes = await post<WxLoginResult>('/api/auth/wx-register', { code: newCode, username })
      if (regRes.code === 200 && regRes.data?.token && regRes.data.user) {
        setToken(regRes.data.token)
        setUser(regRes.data.user)
        return true
      }
      // 用户名已存在等错误
      wx.showToast({ title: regRes.message || '注册失败', icon: 'none' })
      return false
    }

    return false
  } catch {
    wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    return false
  }
}
