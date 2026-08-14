import { BASE_URL } from '../config/index'

/** 后端统一响应体（热榜接口额外带 updateTime/nextRefreshTime） */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  updateTime?: string
  nextRefreshTime?: string
}

/** 小程序登录 token 的 Storage key */
const TOKEN_KEY = 'fishingtime:token'
/** 用户信息（含 userId）的 Storage key */
const USER_KEY = 'fishingtime:user'

export function getToken(): string {
  return (wx.getStorageSync(TOKEN_KEY) as string) || ''
}

export function setToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token)
}

export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY)
}

export interface StoredUser {
  id: number
  username: string
  nickname: string
}

export function getUser(): StoredUser | null {
  const u = wx.getStorageSync(USER_KEY)
  return u && typeof u === 'object' ? (u as StoredUser) : null
}

export function setUser(user: StoredUser): void {
  wx.setStorageSync(USER_KEY, user)
}

/** 有 token 时带 Authorization header（Web Session 不受影响） */
function buildHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 统一请求：401 时自动刷新登录态并重试一次（防死循环） */
function request<T>(
  url: string,
  options: { method?: 'GET' | 'POST' | 'PUT'; data?: object },
  allowRetry: boolean,
): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'Content-Type': 'application/json', ...buildHeader() },
      success: async (res) => {
        const body = res.data as ApiResponse<T>
        // 未认证/token 失效 → 自动刷新登录态并重试一次
        if (allowRetry && body && body.code === 401) {
          const ok = await refreshToken()
          if (ok) {
            const retried = await request<T>(url, options, false)
            resolve(retried)
            return
          }
        }
        resolve(body)
      },
      fail: (err) => reject(new Error(err.errMsg || '网络异常')),
    })
  })
}

/** 刷新 token：wx.login → 后端 wx-login → 覆盖本地 token */
async function refreshToken(): Promise<boolean> {
  try {
    const code = await new Promise<string>((resolve, reject) => {
      wx.login({
        success: (res) => (res.code ? resolve(res.code) : reject(new Error('code 为空'))),
        fail: () => reject(new Error('wx.login 失败')),
      })
    })
    const res = await request<{ token: string }>(
      '/api/auth/wx-login',
      { method: 'POST', data: { code } },
      false, // wx-login 自身不再触发 401 重试
    )
    if (res.code === 200 && res.data?.token) {
      setToken(res.data.token)
      return true
    }
    return false
  } catch {
    return false
  }
}

/** 统一 GET 请求 */
export function get<T>(url: string): Promise<ApiResponse<T>> {
  return request<T>(url, {}, true)
}

/** 统一 POST 请求（JSON body） */
export function post<T>(url: string, data: object): Promise<ApiResponse<T>> {
  return request<T>(url, { method: 'POST', data }, true)
}

/** 统一 PUT 请求（JSON body） */
export function put<T>(url: string, data: object): Promise<ApiResponse<T>> {
  return request<T>(url, { method: 'PUT', data }, true)
}
