// 预期管理系统类型定义

export type IndexDirection = 'up' | 'flat' | 'down'
export type IndexMagnitude = 'strong' | 'moderate' | 'weak'
export type ExpectationMarket = 'cn' | 'hk' | 'us'
export type StockAction = 'buy' | 'sell' | 'add' | 'reduce' | 'hold' | 'watch'
export type StockDirection = 'up' | 'flat' | 'down'
export type ResearchTime = 'lt_30m' | '30_90m' | 'gt_90m'
export type ExecutionStatus = 'executed' | 'partial' | 'not_executed'

export interface StockExpectationItem {
  code: string
  name?: string | null
  action: StockAction
  direction: StockDirection
  targetPrice?: number | null
  stopLoss?: number | null
  confidence: number
  reasoning?: string | null
}

export interface UserExpectation {
  id: number
  targetDate: string
  market: ExpectationMarket
  createdAt?: string | null
  updatedAt?: string | null

  // 心理快照
  emotionIndex?: number | null
  decisionDrivers?: string[] | null
  researchTime?: ResearchTime | null
  interferenceFlags?: string[] | null

  // 大盘预期
  indexDirection: IndexDirection
  indexMagnitude?: IndexMagnitude | null
  indexReasoning: string

  // 个股 & 计划
  stockExpectations?: StockExpectationItem[] | null
  keyAssumptions?: string[] | null
  keyRisks?: string | null
  operationPlan?: string | null
  overallConfidence?: number | null
  tags?: string[] | null
}

export interface ExpectationListResponse {
  items: UserExpectation[]
  total: number
  page: number
  pageSize: number
}

// ---------- Outcome ----------

export interface IndexScoreDetail {
  predictedDirection: string
  predictedMagnitude?: string | null
  actualPctChg?: number | null
  actualDirection?: string | null
  actualMagnitude?: string | null
  directionHit: boolean
  magnitudeHit: boolean
  score: number
  note?: string
}

export interface StockScoreItem {
  code: string
  predictedDirection: string
  actualPctChg?: number | null
  actualDirection?: string | null
  directionHit: boolean
  score: number
  note?: string
}

export interface AssumptionReview {
  assumption: string
  result: 'hit' | 'miss' | 'na'
}

export interface ExpectationOutcome {
  id: number
  expectationId: number
  outcomeDate?: string | null
  scoredAt?: string | null
  autoScore?: number | null
  indexScoreDetail?: IndexScoreDetail | null
  stockScores?: StockScoreItem[] | null
  selfScore?: number | null
  executionStatus?: ExecutionStatus | null
  executionNotes?: string | null
  deviationReason?: string | null
  assumptionReviews?: AssumptionReview[] | null
  lessons?: string | null
  filledAt?: string | null
}

// ---------- Agent 评价 ----------

export interface AgentEval {
  id: number
  expectationId: number
  evalType: 'single' | 'weekly'
  evalDate?: string | null
  generatedAt?: string | null
  reasoningQuality?: number | null
  informationUsage?: number | null
  riskAwareness?: number | null
  executionAlignment?: number | null
  overallAssessment?: string | null
  strengths?: string[] | null
  weaknesses?: string[] | null
  improvementSuggestions?: string[] | null
  biasTags?: string[] | null
}

// ---------- 聚合详情 ----------

export interface ExpectationDetail {
  expectation: UserExpectation
  outcome?: ExpectationOutcome | null
  agentEval?: AgentEval | null
}

// ---------- 请求 ----------

export interface ExpectationCreateRequest {
  targetDate: string
  market?: ExpectationMarket
  emotionIndex?: number | null
  decisionDrivers?: string[] | null
  researchTime?: ResearchTime | null
  interferenceFlags?: string[] | null
  indexDirection: IndexDirection
  indexMagnitude?: IndexMagnitude | null
  indexReasoning: string
  stockExpectations?: StockExpectationItem[] | null
  keyAssumptions?: string[] | null
  keyRisks?: string | null
  operationPlan?: string | null
  overallConfidence?: number
  tags?: string[] | null
}

export interface ExpectationUpdateRequest {
  emotionIndex?: number | null
  decisionDrivers?: string[] | null
  researchTime?: ResearchTime | null
  interferenceFlags?: string[] | null
  indexDirection?: IndexDirection
  indexMagnitude?: IndexMagnitude | null
  indexReasoning?: string
  stockExpectations?: StockExpectationItem[] | null
  keyAssumptions?: string[] | null
  keyRisks?: string | null
  operationPlan?: string | null
  overallConfidence?: number | null
  tags?: string[] | null
}

export interface SelfReviewRequest {
  selfScore?: number | null
  executionStatus?: ExecutionStatus | null
  executionNotes?: string | null
  deviationReason?: string | null
  assumptionReviews?: AssumptionReview[] | null
  lessons?: string | null
}

export interface ExpectationListParams {
  market?: ExpectationMarket
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
}
