/**
 * 《细节》游戏 API 客户端（复用 FishingTime 后端，服务端权威判定）
 *
 * start 只返回图片；draw 返回问题（不含答案）；answer 服务端判题与计时；
 * finish 汇总答对数 + 累计用时并落库；匿名 finish 不缓存，登录后重调可补存。
 */
import { post } from '../../../../utils/request'

export interface DetailRoundInfo {
  round: number
  imageKey: string
  /** 相对路径（如 /games/detail/pic_a.png），加载时拼 BASE_URL */
  imageUrl: string
}

export interface DetailStartResponse {
  sessionId: string
  observationMs: number
  rounds: DetailRoundInfo[]
}

export interface DetailDrawResponse {
  questionId: number
  questionText: string
  /** 乱序后的 4 个选项文本 */
  options: string[]
  /** 与 options 对应的选项键 A/B/C/D */
  optionKeys: string[]
}

export interface DetailAnswerResponse {
  correct: boolean
  correctOption: string
  correctAnswer: string
  elapsedMs: number
}

export interface DetailRoundResult {
  round: number
  played: boolean
  correct: boolean
  timeout: boolean
  elapsedMs: number
}

export interface DetailFinishResponse {
  correctCount: number
  answeredCount: number
  answerTimeMs: number
  saved: boolean
  bestCorrectCount: number | null
  bestAnswerTimeMs: number | null
  todayRank: number | null
  allRank: number | null
  rounds: DetailRoundResult[]
}

export const detailApi = {
  start: () => post<DetailStartResponse>('/api/games/detail/start', {}),
  draw: (sessionId: string, round: number, number: number) =>
    post<DetailDrawResponse>(`/api/games/detail/${sessionId}/round/${round}/draw`, { number }),
  answer: (sessionId: string, round: number, option: string | null) =>
    post<DetailAnswerResponse>(`/api/games/detail/${sessionId}/round/${round}/answer`, { option }),
  finish: (sessionId: string) => post<DetailFinishResponse>(`/api/games/detail/${sessionId}/finish`, {}),
}
