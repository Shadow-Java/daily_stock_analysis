import { useCallback, useEffect, useRef, useState } from 'react'
import { Target } from 'lucide-react'
import { expectationsApi } from '../api/expectations'
import type {
  ExpectationCreateRequest,
  ExpectationDetail,
  SelfReviewRequest,
  UserExpectation,
} from '../types/expectations'
import { Button } from '../components/common/Button'
import { Drawer } from '../components/common/Drawer'
import { EmptyState } from '../components/common/EmptyState'
import { Loading } from '../components/common/Loading'
import { Pagination } from '../components/common/Pagination'
import { AgentEvalPanel } from '../components/expectations/AgentEvalPanel'
import { ExpectationCard } from '../components/expectations/ExpectationCard'
import { ExpectationForm } from '../components/expectations/ExpectationForm'
import { OutcomePanel } from '../components/expectations/OutcomePanel'
import { DirectionBadge } from '../components/expectations/DirectionBadge'

const PAGE_SIZE = 20

const MAGNITUDE_LABEL: Record<string, string> = {
  strong: '大幅',
  moderate: '中幅',
  weak: '小幅',
}
const ACTION_LABEL: Record<string, string> = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓', hold: '持有', watch: '观望',
}
const ACTION_COLOR: Record<string, string> = {
  buy: 'text-green-500', add: 'text-green-500',
  sell: 'text-red-500', reduce: 'text-red-500',
  hold: 'text-secondary-text', watch: 'text-secondary-text',
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-px">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'text-amber-400 text-xs' : 'text-border/60 text-xs'}>★</span>
      ))}
    </span>
  )
}

export default function ExpectationsPage() {
  const [items, setItems] = useState<UserExpectation[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ExpectationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [isScoringId, setIsScoringId] = useState<number | null>(null)
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false)
  const [isEvalTriggering, setIsEvalTriggering] = useState(false)

  const reqRef = useRef(0)

  const load = useCallback(async (p: number) => {
    const rid = ++reqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await expectationsApi.list({ page: p, pageSize: PAGE_SIZE })
      if (reqRef.current !== rid) return
      setItems(res.items)
      setTotal(res.total)
    } catch {
      if (reqRef.current !== rid) return
      setError('加载失败，请重试')
    } finally {
      if (reqRef.current === rid) setLoading(false)
    }
  }, [])

  useEffect(() => { load(page) }, [page, load])

  async function loadDetail(id: number) {
    setSelectedId(id)
    setDetailLoading(true)
    try {
      const res = await expectationsApi.get(id)
      setDetail(res)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleCreate(payload: ExpectationCreateRequest) {
    setIsSubmitting(true)
    try {
      await expectationsApi.create(payload)
      setShowForm(false)
      load(1)
      setPage(1)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleScore(id: number) {
    setIsScoringId(id)
    try {
      await expectationsApi.score(id)
      if (selectedId === id) loadDetail(id)
    } finally {
      setIsScoringId(null)
    }
  }

  async function handleSelfReview(payload: SelfReviewRequest) {
    if (!selectedId) return
    setIsReviewSubmitting(true)
    try {
      await expectationsApi.fillSelfReview(selectedId, payload)
      loadDetail(selectedId)
    } finally {
      setIsReviewSubmitting(false)
    }
  }

  async function handleTriggerEval() {
    if (!selectedId) return
    setIsEvalTriggering(true)
    try {
      await expectationsApi.triggerAgentEval(selectedId)
      loadDetail(selectedId)
    } finally {
      setIsEvalTriggering(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const exp = detail?.expectation

  return (
    <div className="flex flex-col h-full">
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">预期管理</h1>
          {total > 0 && (
            <span className="text-xs text-secondary-text bg-muted/70 px-1.5 py-0.5 rounded-full">
              {total}
            </span>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
          + 今日预期
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左：列表 ── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border/40 overflow-hidden bg-muted/20">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && <Loading />}
            {!loading && error && (
              <p className="text-xs text-destructive text-center py-6">{error}</p>
            )}
            {!loading && !error && items.length === 0 && (
              <EmptyState
                title="还没有预期记录"
                description="点击「今日预期」开始第一条记录"
              />
            )}
            {items.map((item) => (
              <ExpectationCard
                key={item.id}
                expectation={item}
                selected={selectedId === item.id}
                onClick={() => loadDetail(item.id)}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="p-3 border-t border-border/40">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>

        {/* ── 右：详情 ── */}
        <div className="flex-1 overflow-y-auto">
          {/* 空状态 */}
          {!selectedId && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary-text">
              <Target className="w-10 h-10 opacity-20" />
              <p className="text-sm">选择一条预期查看详情</p>
            </div>
          )}

          {selectedId && detailLoading && (
            <div className="flex items-center justify-center h-full">
              <Loading />
            </div>
          )}

          {selectedId && !detailLoading && detail && exp && (
            <div className="max-w-2xl mx-auto px-6 py-5 space-y-4">

              {/* ── 预期概览卡片 ── */}
              <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
                {/* 卡头：日期 + 操作 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">
                      {exp.targetDate} 预期
                    </h2>
                    <DirectionBadge direction={exp.indexDirection} />
                    {exp.indexMagnitude && (
                      <span className="text-xs text-secondary-text">
                        {MAGNITUDE_LABEL[exp.indexMagnitude]}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="xsm"
                    isLoading={isScoringId === selectedId}
                    loadingText="评分中..."
                    onClick={() => handleScore(selectedId)}
                  >
                    触发评分
                  </Button>
                </div>

                {/* 大盘理由 */}
                <div className="px-4 py-3 space-y-3">
                  {exp.overallConfidence != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-secondary-text">整体信心</span>
                      <StarRow value={exp.overallConfidence} />
                    </div>
                  )}

                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {exp.indexReasoning}
                  </p>

                  {/* 核心假设 */}
                  {exp.keyAssumptions && exp.keyAssumptions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-secondary-text">核心假设</div>
                      {exp.keyAssumptions.map((a, i) => (
                        <div key={i} className="flex gap-2 text-xs text-secondary-text">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed">{a}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 关键风险 + 操作计划 */}
                  {(exp.keyRisks || exp.operationPlan) && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      {exp.keyRisks && (
                        <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                          <div className="text-[10.5px] font-medium text-red-500/80 mb-1">关键风险</div>
                          <p className="text-xs text-secondary-text leading-relaxed">{exp.keyRisks}</p>
                        </div>
                      )}
                      {exp.operationPlan && (
                        <div className="rounded-lg bg-[hsl(var(--primary))/5] border border-[hsl(var(--primary))/15] px-3 py-2">
                          <div className="text-[10.5px] font-medium text-[hsl(var(--primary))] mb-1">操作计划</div>
                          <p className="text-xs text-secondary-text leading-relaxed">{exp.operationPlan}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 个股预期列表 */}
                {exp.stockExpectations && exp.stockExpectations.length > 0 && (
                  <div className="border-t border-border/40 px-4 py-3">
                    <div className="text-xs font-medium text-secondary-text mb-2">个股预期</div>
                    <div className="space-y-2">
                      {exp.stockExpectations.map((s) => (
                        <div
                          key={s.code}
                          className="flex items-start gap-2 p-2 rounded-lg bg-muted/40 border border-border/30"
                        >
                          <span className="font-semibold text-xs text-foreground min-w-[60px]">{s.code}</span>
                          <span className={`text-xs font-medium shrink-0 ${ACTION_COLOR[s.action] ?? 'text-secondary-text'}`}>
                            {ACTION_LABEL[s.action]}
                          </span>
                          <DirectionBadge direction={s.direction} size="sm" />
                          <div className="flex-1 min-w-0">
                            {s.reasoning && (
                              <p className="text-xs text-secondary-text leading-relaxed line-clamp-2">
                                {s.reasoning}
                              </p>
                            )}
                          </div>
                          <StarRow value={s.confidence} max={5} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 心理快照摘要（若有） ── */}
              {(exp.emotionIndex != null || (exp.decisionDrivers && exp.decisionDrivers.length > 0)) && (
                <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
                  <div className="text-xs font-medium text-secondary-text mb-2">录入时心理快照</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {exp.emotionIndex != null && (
                      <div className="flex items-center gap-1.5 text-xs text-secondary-text">
                        <span>情绪</span>
                        <span className="font-semibold text-foreground">{exp.emotionIndex}/10</span>
                        <span>{exp.emotionIndex <= 3 ? '😨 偏恐惧' : exp.emotionIndex <= 7 ? '😐 中性' : '🤑 偏贪婪'}</span>
                      </div>
                    )}
                    {exp.researchTime && (
                      <div className="flex items-center gap-1.5 text-xs text-secondary-text">
                        <span>研究时间</span>
                        <span className="font-semibold text-foreground">
                          {exp.researchTime === 'lt_30m' ? '<30m' : exp.researchTime === '30_90m' ? '30-90m' : '>90m'}
                        </span>
                      </div>
                    )}
                    {exp.decisionDrivers && exp.decisionDrivers.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-secondary-text flex-wrap">
                        <span>驱动</span>
                        {exp.decisionDrivers.map((d) => (
                          <span key={d} className="px-1.5 py-0.5 rounded bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))] text-[10.5px]">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                    {exp.interferenceFlags && exp.interferenceFlags.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs flex-wrap">
                        <span className="text-secondary-text">干扰</span>
                        {exp.interferenceFlags.map((f) => (
                          <span key={f} className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10.5px]">
                            ⚠ {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── 收盘结果 + 自我复盘 ── */}
              <OutcomePanel
                outcome={detail.outcome}
                assumptions={exp.keyAssumptions ?? []}
                onSubmitReview={handleSelfReview}
                isSubmitting={isReviewSubmitting}
              />

              {/* ── Agent 评价 ── */}
              <AgentEvalPanel
                eval_={detail.agentEval}
                onTrigger={handleTriggerEval}
                isTriggering={isEvalTriggering}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── 新建表单 Drawer ── */}
      <Drawer
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title="录入今日预期"
        width="max-w-lg"
      >
        <div className="p-5">
          <ExpectationForm
            onSubmit={(p) => handleCreate(p as ExpectationCreateRequest)}
            isSubmitting={isSubmitting}
            onCancel={() => setShowForm(false)}
          />
        </div>
      </Drawer>
    </div>
  )
}
