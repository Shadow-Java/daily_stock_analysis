// Agent 评价展示面板 — 重画版
import type { AgentEval } from '../../types/expectations'
import { Button } from '../common/Button'
import { cn } from '../../utils/cn'

interface Props {
  eval_: AgentEval | null | undefined
  onTrigger: () => Promise<void>
  isTriggering: boolean
}

const DIM_LABELS = [
  { key: 'reasoningQuality',    label: '推理逻辑' },
  { key: 'informationUsage',    label: '信息利用' },
  { key: 'riskAwareness',       label: '风险意识' },
  { key: 'executionAlignment',  label: '执行一致' },
] as const

function DimRow({
  label,
  value,
}: {
  label: string
  value: number | null | undefined
}) {
  const v = value ?? 0
  const colors = ['', 'bg-red-500', 'bg-orange-400', 'bg-amber-400', 'bg-green-400', 'bg-[hsl(var(--primary))]']
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-secondary-text w-[68px] shrink-0">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn(
              'w-2.5 h-2.5 rounded-full transition-colors',
              n <= v ? colors[v] || 'bg-[hsl(var(--primary))]' : 'bg-border/30',
            )}
          />
        ))}
      </div>
      <span className="text-[10.5px] text-secondary-text">{value != null ? `${value}/5` : '—'}</span>
    </div>
  )
}

const BIAS_COLOR: Record<string, string> = {
  '锚定偏差':  'bg-purple-500/10 border-purple-500/30 text-purple-500',
  '确认偏差':  'bg-orange-500/10 border-orange-500/30 text-orange-500',
  '近因效应':  'bg-amber-500/10 border-amber-500/30 text-amber-500',
  '损失厌恶':  'bg-red-500/10 border-red-500/30 text-red-500',
  '过度自信':  'bg-pink-500/10 border-pink-500/30 text-pink-500',
  'FOMO':      'bg-rose-500/10 border-rose-500/30 text-rose-500',
  '处置效应':  'bg-indigo-500/10 border-indigo-500/30 text-indigo-500',
}

export function AgentEvalPanel({ eval_, onTrigger, isTriggering }: Props) {
  if (!eval_) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-6 flex flex-col items-center gap-3">
        <span className="text-2xl opacity-40">🤖</span>
        <p className="text-xs text-secondary-text text-center">尚未生成 Agent 评价</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onTrigger}
          isLoading={isTriggering}
          loadingText="生成中..."
        >
          生成 Agent 点评
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {/* 卡头 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🤖</span>
          <span className="text-sm font-semibold text-foreground">Agent 评价</span>
        </div>
        <Button
          variant="ghost"
          size="xsm"
          onClick={onTrigger}
          isLoading={isTriggering}
          loadingText="重新生成..."
        >
          刷新
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* 维度评分 */}
        <div className="grid grid-cols-2 gap-2.5">
          {DIM_LABELS.map(({ key, label }) => (
            <DimRow key={key} label={label} value={(eval_ as unknown as Record<string, number | null>)[key]} />
          ))}
        </div>

        {/* 综合评价 */}
        {eval_.overallAssessment && (
          <div className="rounded-lg bg-[hsl(var(--primary))/5] border border-[hsl(var(--primary))/15] px-3 py-2.5">
            <p className="text-xs text-foreground/90 leading-relaxed">{eval_.overallAssessment}</p>
          </div>
        )}

        {/* 偏差标签 */}
        {eval_.biasTags && eval_.biasTags.length > 0 && (
          <div>
            <div className="text-[10.5px] font-semibold text-secondary-text uppercase tracking-wide mb-1.5">
              检测到的认知偏差
            </div>
            <div className="flex flex-wrap gap-1.5">
              {eval_.biasTags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'px-2 py-0.5 text-[10.5px] rounded border font-medium',
                    BIAS_COLOR[tag] ?? 'bg-orange-500/10 border-orange-500/30 text-orange-500',
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 优点 / 不足 */}
        {((eval_.strengths?.length ?? 0) > 0 || (eval_.weaknesses?.length ?? 0) > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {eval_.strengths && eval_.strengths.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold text-green-500 uppercase tracking-wide mb-1.5">
                  ✅ 优点
                </div>
                <ul className="space-y-1.5">
                  {eval_.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-secondary-text leading-relaxed flex gap-1.5">
                      <span className="text-green-500 shrink-0 mt-0.5">·</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {eval_.weaknesses && eval_.weaknesses.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold text-amber-500 uppercase tracking-wide mb-1.5">
                  ⚠ 待改进
                </div>
                <ul className="space-y-1.5">
                  {eval_.weaknesses.map((w, i) => (
                    <li key={i} className="text-xs text-secondary-text leading-relaxed flex gap-1.5">
                      <span className="text-amber-500 shrink-0 mt-0.5">·</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 改进建议 */}
        {eval_.improvementSuggestions && eval_.improvementSuggestions.length > 0 && (
          <div>
            <div className="text-[10.5px] font-semibold text-[hsl(var(--primary))] uppercase tracking-wide mb-1.5">
              💡 改进建议
            </div>
            <ul className="space-y-1.5">
              {eval_.improvementSuggestions.map((s, i) => (
                <li key={i} className="text-xs text-secondary-text leading-relaxed flex gap-2">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-[hsl(var(--primary))/15] text-[hsl(var(--primary))] text-[9px] flex items-center justify-center font-bold mt-0.5">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
