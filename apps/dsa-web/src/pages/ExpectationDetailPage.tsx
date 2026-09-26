import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Target } from 'lucide-react'
import { expectationsApi } from '../api/expectations'
import type { ExpectationDetail, SelfReviewRequest } from '../types/expectations'
import { Loading } from '../components/common/Loading'
import { Button } from '../components/common/Button'
import { PageTabNav } from '../components/common/PageTabNav'
import { DirectionBadge } from '../components/expectations/DirectionBadge'
import { OutcomePanel } from '../components/expectations/OutcomePanel'
import { AgentEvalPanel } from '../components/expectations/AgentEvalPanel'
import { cn } from '../utils/cn'

const MAGNITUDE_LABEL: Record<string, string> = { strong: '大幅', moderate: '中幅', weak: '小幅' }
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
        <span key={i} className={cn('text-[11px]', i < value ? 'text-amber-400' : 'text-border/50')}>★</span>
      ))}
    </span>
  )
}

export default function ExpectationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<ExpectationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [isScoringId, setIsScoringId] = useState(false)
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false)
  const [isEvalTriggering, setIsEvalTriggering] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    expectationsApi.get(Number(id))
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [id])

  async function handleScore() {
    if (!id) return
    setIsScoringId(true)
    try {
      await expectationsApi.score(Number(id))
      const res = await expectationsApi.get(Number(id))
      setDetail(res)
    } finally {
      setIsScoringId(false)
    }
  }

  async function handleSelfReview(payload: SelfReviewRequest) {
    if (!id) return
    setIsReviewSubmitting(true)
    try {
      await expectationsApi.fillSelfReview(Number(id), payload)
      const res = await expectationsApi.get(Number(id))
      setDetail(res)
    } finally {
      setIsReviewSubmitting(false)
    }
  }

  async function handleTriggerEval() {
    if (!id) return
    setIsEvalTriggering(true)
    try {
      await expectationsApi.triggerAgentEval(Number(id))
      const res = await expectationsApi.get(Number(id))
      setDetail(res)
    } finally {
      setIsEvalTriggering(false)
    }
  }

  const exp = detail?.expectation

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageTabNav detailId={id} />
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/50 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/expectations')}
          className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回列表
        </button>
        <div className="w-px h-4 bg-border/50" />
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">
            {exp ? `${exp.targetDate} 预期详情` : '预期详情'}
          </h1>
          {exp && <DirectionBadge direction={exp.indexDirection} size="sm" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/10">
        {loading && (
          <div className="flex items-center justify-center h-full"><Loading /></div>
        )}

        {!loading && !detail && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary-text">
            <p className="text-sm">未找到该预期记录</p>
            <Button variant="outline" size="sm" onClick={() => navigate('/expectations')}>返回列表</Button>
          </div>
        )}

        {!loading && detail && exp && (
          <div className="px-6 py-5 space-y-4">

            {/* 心理快照 */}
            {(exp.emotionIndex != null || (exp.decisionDrivers?.length ?? 0) > 0) && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 rounded-xl border border-border/40 bg-card text-xs text-secondary-text">
                {exp.emotionIndex != null && (
                  <span>录入时情绪&nbsp;<span className="font-semibold text-foreground">{exp.emotionIndex}/10</span>&nbsp;{exp.emotionIndex <= 3 ? '😨 偏恐惧' : exp.emotionIndex <= 7 ? '😐 中性' : '🤑 偏贪婪'}</span>
                )}
                {exp.researchTime && (
                  <span>研究时间&nbsp;<span className="font-semibold text-foreground">{exp.researchTime === 'lt_30m' ? '<30m' : exp.researchTime === '30_90m' ? '30-90m' : '>90m'}</span></span>
                )}
                {exp.decisionDrivers && exp.decisionDrivers.length > 0 && (
                  <span className="flex items-center gap-1 flex-wrap">
                    驱动
                    {exp.decisionDrivers.map((d) => (
                      <span key={d} className="px-1.5 py-0.5 rounded bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))] text-[11px]">{d}</span>
                    ))}
                  </span>
                )}
                {exp.interferenceFlags && exp.interferenceFlags.length > 0 && (
                  <span className="flex items-center gap-1 flex-wrap">
                    干扰
                    {exp.interferenceFlags.map((f) => (
                      <span key={f} className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px]">⚠ {f}</span>
                    ))}
                  </span>
                )}
              </div>
            )}

            {/* 预期概览 */}
            <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{exp.targetDate} 预期</span>
                  <DirectionBadge direction={exp.indexDirection} />
                  {exp.indexMagnitude && <span className="text-xs text-secondary-text">{MAGNITUDE_LABEL[exp.indexMagnitude]}</span>}
                  {exp.overallConfidence != null && <StarRow value={exp.overallConfidence} />}
                </div>
                <Button variant="outline" size="xsm" isLoading={isScoringId} loadingText="评分中..." onClick={handleScore}>
                  触发评分
                </Button>
              </div>

              <div className="px-4 py-3 space-y-3">
                <p className="text-sm text-foreground/90 leading-relaxed">{exp.indexReasoning}</p>

                {exp.keyAssumptions && exp.keyAssumptions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-secondary-text">核心假设</div>
                    {exp.keyAssumptions.map((a, i) => (
                      <div key={i} className="flex gap-2 text-xs text-secondary-text">
                        <span className="shrink-0 w-4 h-4 rounded-full bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))] flex items-center justify-center text-[11px] font-bold">{i + 1}</span>
                        <span className="leading-relaxed">{a}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(exp.keyRisks || exp.operationPlan) && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {exp.keyRisks && (
                      <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                        <div className="text-[11px] font-semibold text-red-500/80 mb-1">关键风险</div>
                        <p className="text-xs text-secondary-text leading-relaxed">{exp.keyRisks}</p>
                      </div>
                    )}
                    {exp.operationPlan && (
                      <div className="rounded-lg bg-[hsl(var(--primary))/5] border border-[hsl(var(--primary))/15] px-3 py-2">
                        <div className="text-[11px] font-semibold text-[hsl(var(--primary))] mb-1">操作计划</div>
                        <p className="text-xs text-secondary-text leading-relaxed">{exp.operationPlan}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {exp.stockExpectations && exp.stockExpectations.length > 0 && (
                <div className="border-t border-border/40 px-4 py-3">
                  <div className="text-xs font-medium text-secondary-text mb-2">个股预期</div>
                  <div className="space-y-2">
                    {exp.stockExpectations.map((s) => (
                      <div key={s.code} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/30">
                        <span className="font-semibold text-xs text-foreground min-w-[68px] shrink-0">{s.code}</span>
                        <span className={cn('text-xs font-medium shrink-0', ACTION_COLOR[s.action] ?? 'text-secondary-text')}>{ACTION_LABEL[s.action]}</span>
                        <DirectionBadge direction={s.direction} size="sm" />
                        {s.targetPrice && <span className="text-[11px] text-secondary-text shrink-0">目标 {s.targetPrice}</span>}
                        {s.stopLoss && <span className="text-[11px] text-secondary-text shrink-0">止损 {s.stopLoss}</span>}
                        <div className="flex-1 min-w-0">
                          {s.reasoning && <p className="text-xs text-secondary-text leading-relaxed line-clamp-2">{s.reasoning}</p>}
                        </div>
                        <StarRow value={s.confidence} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 收盘结果 + 自我复盘 */}
            <OutcomePanel
              outcome={detail.outcome}
              assumptions={exp.keyAssumptions ?? []}
              onSubmitReview={handleSelfReview}
              isSubmitting={isReviewSubmitting}
            />

            {/* Agent 评价 */}
            <AgentEvalPanel
              eval_={detail.agentEval}
              onTrigger={handleTriggerEval}
              isTriggering={isEvalTriggering}
            />
          </div>
        )}
      </div>
    </div>
  )
}
