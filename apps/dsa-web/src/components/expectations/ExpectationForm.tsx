// 新建/编辑预期表单 — 重画版（步骤流）
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type {
  ExpectationCreateRequest,
  ExpectationUpdateRequest,
  IndexDirection,
  IndexMagnitude,
  ResearchTime,
  StockExpectationItem,
  UserExpectation,
} from '../../types/expectations'
import { Button } from '../common/Button'
import { PsychSnapshotSection } from './PsychSnapshotSection'
import { StockExpectationEditor } from './StockExpectationEditor'
import { cn } from '../../utils/cn'

interface Props {
  initial?: UserExpectation | null
  onSubmit: (payload: ExpectationCreateRequest | ExpectationUpdateRequest) => Promise<void>
  isSubmitting: boolean
  onCancel?: () => void
}

// ── 方向按钮 ──────────────────────────────────────────────────────
const DIR_OPTS: { value: IndexDirection; label: string; icon: string; activeClass: string }[] = [
  { value: 'up',   label: '看涨', icon: '▲', activeClass: 'bg-green-500/15 border-green-500/50 text-green-500' },
  { value: 'flat', label: '震荡', icon: '━', activeClass: 'bg-amber-500/15 border-amber-500/50 text-amber-500' },
  { value: 'down', label: '看跌', icon: '▼', activeClass: 'bg-red-500/15 border-red-500/50 text-red-500' },
]

const MAG_OPTS: { value: IndexMagnitude; label: string }[] = [
  { value: 'strong',   label: '大幅 >1%' },
  { value: 'moderate', label: '中幅 0.3-1%' },
  { value: 'weak',     label: '小幅 <0.3%' },
]

// ── 分区标题 ──────────────────────────────────────────────────────
function SectionHead({ step, title, sub }: { step: string; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2 mb-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--primary))/15] text-[hsl(var(--primary))] text-[11px] font-bold flex items-center justify-center mt-0.5">
        {step}
      </span>
      <div>
        <div className="text-xs font-semibold text-foreground">{title}</div>
        {sub && <div className="text-[11px] text-secondary-text mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ── 字段标签 ──────────────────────────────────────────────────────
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-secondary-text mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg bg-background border border-border/60 px-3 py-2 text-sm text-foreground placeholder:text-secondary-text/60 focus:outline-none focus:border-[hsl(var(--primary))/60] transition-colors resize-none'

export function ExpectationForm({ initial, onSubmit, isSubmitting, onCancel }: Props) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = tomorrow.toISOString().slice(0, 10)

  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? defaultDate)

  // 心理快照
  const [emotionIndex, setEmotionIndex]     = useState(initial?.emotionIndex ?? 5)
  const [decisionDrivers, setDecisionDrivers] = useState<string[]>(initial?.decisionDrivers ?? [])
  const [researchTime, setResearchTime]     = useState<ResearchTime | null>(initial?.researchTime ?? null)
  const [interferenceFlags, setInterferenceFlags] = useState<string[]>(initial?.interferenceFlags ?? [])

  // 大盘预期
  const [indexDirection, setIndexDirection] = useState<IndexDirection>(initial?.indexDirection ?? 'up')
  const [indexMagnitude, setIndexMagnitude] = useState<IndexMagnitude | null>(initial?.indexMagnitude ?? null)
  const [indexReasoning, setIndexReasoning] = useState(initial?.indexReasoning ?? '')

  // 假设
  const [keyAssumptions, setKeyAssumptions] = useState<string[]>(initial?.keyAssumptions ?? [''])

  // 个股
  const [stockExpectations, setStockExpectations] = useState<StockExpectationItem[]>(initial?.stockExpectations ?? [])
  const [showStocks, setShowStocks] = useState(false)

  // 综合判断
  const [keyRisks, setKeyRisks]           = useState(initial?.keyRisks ?? '')
  const [operationPlan, setOperationPlan] = useState(initial?.operationPlan ?? '')
  const [overallConfidence, setOverallConfidence] = useState(initial?.overallConfidence ?? 3)

  function updateAssumption(i: number, value: string) {
    setKeyAssumptions((prev) => prev.map((a, idx) => (idx === i ? value : a)))
  }
  function addAssumption() { setKeyAssumptions((p) => [...p, '']) }
  function removeAssumption(i: number) { setKeyAssumptions((p) => p.filter((_, idx) => idx !== i)) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const assumptions = keyAssumptions.filter((a) => a.trim())
    const payload: ExpectationCreateRequest = {
      targetDate,
      market: initial?.market ?? 'cn',
      emotionIndex: emotionIndex || null,
      decisionDrivers: decisionDrivers.length ? decisionDrivers : null,
      researchTime: researchTime || null,
      interferenceFlags: interferenceFlags.length ? interferenceFlags : null,
      indexDirection,
      indexMagnitude: indexMagnitude || null,
      indexReasoning,
      stockExpectations: stockExpectations.length ? stockExpectations : null,
      keyAssumptions: assumptions.length ? assumptions : null,
      keyRisks: keyRisks || null,
      operationPlan: operationPlan || null,
      overallConfidence,
    }
    await onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* 目标日期（仅新建时显示） */}
      {!initial && (
        <div>
          <FieldLabel>预期日期</FieldLabel>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="h-9 rounded-lg bg-background border border-border/60 px-3 text-sm text-foreground focus:outline-none focus:border-[hsl(var(--primary))/60]"
            required
          />
        </div>
      )}

      {/* ── Step 1：心理快照 ── */}
      <PsychSnapshotSection
        emotionIndex={emotionIndex}
        onEmotionChange={setEmotionIndex}
        decisionDrivers={decisionDrivers}
        onDriversChange={setDecisionDrivers}
        researchTime={researchTime}
        onResearchTimeChange={setResearchTime}
        interferenceFlags={interferenceFlags}
        onInterferenceFlagsChange={setInterferenceFlags}
      />

      {/* ── Step 2：大盘预期 ── */}
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
        <SectionHead step="2" title="明日大盘预期" />

        {/* 方向 */}
        <div>
          <FieldLabel required>方向判断</FieldLabel>
          <div className="flex gap-2">
            {DIR_OPTS.map(({ value, label, icon, activeClass }) => (
              <button
                key={value}
                type="button"
                onClick={() => setIndexDirection(value)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-lg border font-medium transition-all',
                  indexDirection === value
                    ? activeClass
                    : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
                )}
              >
                <span className="text-[13px]">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 幅度 */}
        <div>
          <FieldLabel>幅度预判</FieldLabel>
          <div className="flex gap-1.5">
            {MAG_OPTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setIndexMagnitude(indexMagnitude === value ? null : value)}
                className={cn(
                  'flex-1 py-1.5 text-xs rounded-lg border transition-all',
                  indexMagnitude === value
                    ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/40] text-[hsl(var(--primary))] font-medium'
                    : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 理由 */}
        <div>
          <FieldLabel required>判断理由</FieldLabel>
          <textarea
            className={inputCls}
            rows={3}
            placeholder="今天看到了什么信息，让你做出这个判断？"
            value={indexReasoning}
            onChange={(e) => setIndexReasoning(e.target.value)}
            required
          />
        </div>

        {/* 假设 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <FieldLabel>核心假设</FieldLabel>
            <button
              type="button"
              onClick={addAssumption}
              className="text-xs text-[hsl(var(--primary))] hover:opacity-80 flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> 添加
            </button>
          </div>
          <div className="space-y-1.5">
            {keyAssumptions.map((a, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium text-secondary-text">
                  {i + 1}
                </span>
                <input
                  className="flex-1 h-8 rounded-lg bg-background border border-border/60 px-2.5 text-xs text-foreground placeholder:text-secondary-text/60 focus:outline-none focus:border-[hsl(var(--primary))/60]"
                  placeholder={`例如："美联储本次不加息"`}
                  value={a}
                  onChange={(e) => updateAssumption(i, e.target.value)}
                />
                {keyAssumptions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAssumption(i)}
                    className="text-secondary-text/50 hover:text-destructive transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Step 3：个股预期（可选） ── */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setShowStocks((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-secondary-text hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium">3</span>
            <span className="font-semibold text-foreground">个股预期</span>
            <span className="text-secondary-text">（可选）</span>
            {stockExpectations.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary))/15] text-[hsl(var(--primary))] text-[11px] font-medium">
                {stockExpectations.length} 只
              </span>
            )}
          </div>
          <span className="text-secondary-text/60">{showStocks ? '▲' : '▼'}</span>
        </button>
        {showStocks && (
          <div className="px-4 pb-4 border-t border-border/40">
            <div className="pt-3">
              <StockExpectationEditor value={stockExpectations} onChange={setStockExpectations} />
            </div>
          </div>
        )}
      </div>

      {/* ── Step 4：综合判断 ── */}
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
        <SectionHead step="4" title="综合判断" sub="整体计划与风险备注" />

        <div>
          <FieldLabel>关键风险</FieldLabel>
          <input
            className={cn(inputCls, 'h-9')}
            placeholder="什么情况下你的判断会错？"
            value={keyRisks}
            onChange={(e) => setKeyRisks(e.target.value)}
          />
        </div>

        <div>
          <FieldLabel>操作计划</FieldLabel>
          <textarea
            className={inputCls}
            rows={2}
            placeholder="明天打算怎么操作？具体到位置和仓位"
            value={operationPlan}
            onChange={(e) => setOperationPlan(e.target.value)}
          />
        </div>

        {/* 整体信心（星星） */}
        <div>
          <FieldLabel>整体信心 {overallConfidence}/5</FieldLabel>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOverallConfidence(n)}
                className="text-xl transition-transform hover:scale-110"
                aria-label={`${n} 星`}
              >
                <span className={n <= overallConfidence ? 'text-amber-400' : 'text-border/50'}>★</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 提交按钮 ── */}
      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          loadingText="保存中..."
          className="flex-1"
        >
          {initial ? '保存修改' : '提交预期'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  )
}
