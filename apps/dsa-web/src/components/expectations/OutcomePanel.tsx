// 收盘评分展示 + 自我复盘表单 — 重画版
import { useState } from 'react'
import type {
  AssumptionReview,
  ExecutionStatus,
  ExpectationOutcome,
  SelfReviewRequest,
} from '../../types/expectations'
import { Button } from '../common/Button'
import { cn } from '../../utils/cn'

const EXECUTION_OPTS: { value: ExecutionStatus; label: string; icon: string }[] = [
  { value: 'executed',     label: '完全执行', icon: '✅' },
  { value: 'partial',      label: '部分执行', icon: '⚡' },
  { value: 'not_executed', label: '未执行',   icon: '⏭' },
]

function scoreColor(score: number) {
  if (score >= 70) return { ring: 'text-green-500', bg: 'bg-green-500/10 border-green-500/25', label: '表现良好' }
  if (score >= 50) return { ring: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/25', label: '有待改进' }
  return { ring: 'text-red-500', bg: 'bg-red-500/10 border-red-500/25', label: '需要反思' }
}

interface Props {
  outcome: ExpectationOutcome | null | undefined
  assumptions: string[]
  onSubmitReview: (payload: SelfReviewRequest) => Promise<void>
  isSubmitting: boolean
}

export function OutcomePanel({ outcome, assumptions, onSubmitReview, isSubmitting }: Props) {
  const [selfScore, setSelfScore]           = useState<number>(outcome?.selfScore ?? 3)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>(outcome?.executionStatus ?? 'executed')
  const [executionNotes, setExecutionNotes] = useState(outcome?.executionNotes ?? '')
  const [deviationReason, setDeviationReason] = useState(outcome?.deviationReason ?? '')
  const [assumptionReviews, setAssumptionReviews] = useState<AssumptionReview[]>(
    outcome?.assumptionReviews ?? assumptions.map((a) => ({ assumption: a, result: 'na' as const })),
  )
  const [lessons, setLessons] = useState(outcome?.lessons ?? '')

  function updateAssumption(i: number, result: AssumptionReview['result']) {
    setAssumptionReviews((prev) => prev.map((a, idx) => (idx === i ? { ...a, result } : a)))
  }

  async function handleSubmit() {
    await onSubmitReview({
      selfScore,
      executionStatus,
      executionNotes: executionNotes || null,
      deviationReason: deviationReason || null,
      assumptionReviews: assumptionReviews.length > 0 ? assumptionReviews : null,
      lessons: lessons || null,
    })
  }

  const inputCls =
    'w-full rounded-lg bg-background border border-border/60 px-3 py-2 text-xs text-foreground placeholder:text-secondary-text/60 focus:outline-none focus:border-[hsl(var(--primary))/60] resize-none transition-colors'

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {/* 卡头 */}
      <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
        <span className="text-sm font-semibold text-foreground">收盘结果 & 自我复盘</span>
      </div>

      <div className="p-4 space-y-5">
        {/* ── 自动评分 ── */}
        {outcome?.autoScore != null ? (
          <div className="flex gap-4 items-start">
            {/* 大分数圆圈 */}
            <div className={cn(
              'shrink-0 w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center',
              scoreColor(outcome.autoScore).bg,
            )}>
              <span className={cn('text-2xl font-bold leading-none', scoreColor(outcome.autoScore).ring)}>
                {Math.round(outcome.autoScore)}
              </span>
              <span className={cn('text-[11px] font-medium mt-0.5', scoreColor(outcome.autoScore).ring)}>
                {scoreColor(outcome.autoScore).label}
              </span>
            </div>

            {/* 明细 */}
            <div className="flex-1 space-y-2">
              {outcome.indexScoreDetail && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-secondary-text">大盘</span>
                  {outcome.indexScoreDetail.actualPctChg != null && (
                    <span className={cn(
                      'text-xs font-semibold',
                      outcome.indexScoreDetail.actualPctChg >= 0 ? 'text-green-500' : 'text-red-500',
                    )}>
                      {outcome.indexScoreDetail.actualPctChg >= 0 ? '▲' : '▼'}
                      {' '}{Math.abs(outcome.indexScoreDetail.actualPctChg).toFixed(2)}%
                    </span>
                  )}
                  <span className={cn(
                    'text-[11px] px-1.5 py-0.5 rounded',
                    outcome.indexScoreDetail.directionHit
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-red-500/10 text-red-500',
                  )}>
                    {outcome.indexScoreDetail.directionHit ? '✓ 方向命中' : '✗ 方向未中'}
                  </span>
                </div>
              )}

              {outcome.stockScores && outcome.stockScores.map((s) => (
                <div key={s.code} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{s.code}</span>
                  {s.actualPctChg != null && (
                    <span className={cn(
                      'text-xs font-semibold',
                      s.actualPctChg >= 0 ? 'text-green-500' : 'text-red-500',
                    )}>
                      {s.actualPctChg >= 0 ? '▲' : '▼'} {Math.abs(s.actualPctChg).toFixed(2)}%
                    </span>
                  )}
                  <span className={cn(
                    'text-[11px] px-1.5 py-0.5 rounded',
                    s.directionHit ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500',
                  )}>
                    {s.directionHit ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2 text-xs text-secondary-text">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            等待收盘后自动评分
          </div>
        )}

        {/* ── 假设验证 ── */}
        {assumptionReviews.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-secondary-text">假设验证</div>
            {assumptionReviews.map((ar, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium text-secondary-text">
                  {i + 1}
                </span>
                <span className="flex-1 text-xs text-secondary-text truncate" title={ar.assumption}>
                  {ar.assumption}
                </span>
                <div className="flex gap-1 shrink-0">
                  {(['hit', 'miss', 'na'] as AssumptionReview['result'][]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => updateAssumption(i, r)}
                      className={cn(
                        'px-2 py-0.5 text-[11px] rounded-md border transition-all',
                        ar.result === r
                          ? r === 'hit'
                            ? 'bg-green-500/15 border-green-500/50 text-green-500 font-medium'
                            : r === 'miss'
                              ? 'bg-red-500/15 border-red-500/50 text-red-500 font-medium'
                              : 'bg-muted border-border text-secondary-text font-medium'
                          : 'border-border/40 text-secondary-text/50 hover:border-border',
                      )}
                    >
                      {r === 'hit' ? '成立' : r === 'miss' ? '不成立' : 'N/A'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40" />

        {/* ── 自我复盘 ── */}
        <div className="space-y-4">
          <div className="text-xs font-semibold text-foreground">自我复盘</div>

          {/* 执行状态 */}
          <div>
            <div className="text-xs font-medium text-secondary-text mb-1.5">执行情况</div>
            <div className="flex gap-1.5">
              {EXECUTION_OPTS.map(({ value, label, icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setExecutionStatus(value)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-all',
                    executionStatus === value
                      ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/40] text-[hsl(var(--primary))] font-medium'
                      : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
                  )}
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 偏差原因（仅 partial / not_executed 时） */}
          {executionStatus !== 'executed' && (
            <div>
              <div className="text-xs font-medium text-secondary-text mb-1.5">偏差原因</div>
              <textarea
                className={inputCls}
                rows={2}
                placeholder="为什么没有按计划执行？"
                value={deviationReason}
                onChange={(e) => setDeviationReason(e.target.value)}
              />
            </div>
          )}

          {/* 执行备注 */}
          <div>
            <div className="text-xs font-medium text-secondary-text mb-1.5">执行说明</div>
            <textarea
              className={inputCls}
              rows={2}
              placeholder="实际操作了什么？"
              value={executionNotes}
              onChange={(e) => setExecutionNotes(e.target.value)}
            />
          </div>

          {/* 复盘总结 */}
          <div>
            <div className="text-xs font-medium text-secondary-text mb-1.5">复盘总结</div>
            <textarea
              className={inputCls}
              rows={3}
              placeholder="今天学到了什么？下次会怎么做？"
              value={lessons}
              onChange={(e) => setLessons(e.target.value)}
            />
          </div>

          {/* 自评分（星星） */}
          <div>
            <div className="text-xs font-medium text-secondary-text mb-1.5">自评分 {selfScore}/5</div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSelfScore(n)}
                  className="text-2xl transition-transform hover:scale-110"
                >
                  <span className={n <= selfScore ? 'text-amber-400' : 'text-border/50'}>★</span>
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            loadingText="保存中..."
            className="w-full"
          >
            保存复盘
          </Button>
        </div>
      </div>
    </div>
  )
}
