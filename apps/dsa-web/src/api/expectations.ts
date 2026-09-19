import apiClient from './index'
import { toCamelCase } from './utils'
import type {
  AgentEval,
  ExpectationCreateRequest,
  ExpectationDetail,
  ExpectationListParams,
  ExpectationListResponse,
  ExpectationOutcome,
  ExpectationUpdateRequest,
  SelfReviewRequest,
  UserExpectation,
} from '../types/expectations'
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

function toSnake(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toSnake)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        camelToSnake(k),
        toSnake(v),
      ]),
    )
  }
  return obj
}

function toListParams(params: ExpectationListParams): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if (params.market) p['market'] = params.market
  if (params.fromDate) p['from_date'] = params.fromDate
  if (params.toDate) p['to_date'] = params.toDate
  if (params.page) p['page'] = params.page
  if (params.pageSize) p['page_size'] = params.pageSize
  return p
}

export const expectationsApi = {
  async create(payload: ExpectationCreateRequest): Promise<UserExpectation> {
    const response = await apiClient.post<unknown>(
      '/api/v1/expectations',
      toSnake(payload) as Record<string, unknown>,
    )
    return toCamelCase<UserExpectation>(response.data)
  },

  async list(params: ExpectationListParams = {}): Promise<ExpectationListResponse> {
    const response = await apiClient.get<unknown>('/api/v1/expectations', {
      params: toListParams(params),
    })
    return toCamelCase<ExpectationListResponse>(response.data)
  },

  async getToday(): Promise<UserExpectation | null> {
    const response = await apiClient.get<unknown>('/api/v1/expectations/today')
    if (!response.data) return null
    return toCamelCase<UserExpectation>(response.data)
  },

  async get(id: number): Promise<ExpectationDetail> {
    const response = await apiClient.get<unknown>(`/api/v1/expectations/${id}`)
    return toCamelCase<ExpectationDetail>(response.data)
  },

  async update(id: number, payload: ExpectationUpdateRequest): Promise<UserExpectation> {
    const response = await apiClient.patch<unknown>(
      `/api/v1/expectations/${id}`,
      toSnake(payload) as Record<string, unknown>,
    )
    return toCamelCase<UserExpectation>(response.data)
  },

  async delete(id: number): Promise<void> {
    await apiClient.delete(`/api/v1/expectations/${id}`)
  },

  async score(id: number): Promise<{ outcome: ExpectationOutcome }> {
    const response = await apiClient.post<unknown>(`/api/v1/expectations/${id}/score`)
    return toCamelCase<{ outcome: ExpectationOutcome }>(response.data)
  },

  async fillSelfReview(id: number, payload: SelfReviewRequest): Promise<ExpectationOutcome> {
    const response = await apiClient.patch<unknown>(
      `/api/v1/expectations/${id}/outcome`,
      toSnake(payload) as Record<string, unknown>,
    )
    return toCamelCase<ExpectationOutcome>(response.data)
  },

  async triggerAgentEval(id: number): Promise<AgentEval> {
    const response = await apiClient.post<unknown>(`/api/v1/expectations/${id}/eval`)
    return toCamelCase<AgentEval>(response.data)
  },

  async getAgentEval(id: number): Promise<AgentEval | null> {
    const response = await apiClient.get<unknown>(`/api/v1/expectations/${id}/eval`)
    if (!response.data) return null
    return toCamelCase<AgentEval>(response.data)
  },
}
