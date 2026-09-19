import { useState } from 'react'
import { BookOpen, Plus, Edit2, PauseCircle, AlertTriangle, CheckCircle } from 'lucide-react'
import { Button } from '../components/common/Button'
import { PageTabNav } from '../components/common/PageTabNav'
import { cn } from '../utils/cn'

interface Principle {
  id: number
  title: string
  rationale: string
  createdAt: string
  triggerCount: number
  violationCount: number
  isActive: boolean
  monthViolationPct?: number
  monthTrend?: 'up' | 'down' | 'flat'
}

const DEMO_PRINCIPLES: Principle[] = [
  {
    id: 1,
    title: '不在周五下午开新仓',
    rationale: '无法管理周末消息面风险，历史数据显示周五下午新仓次日跌多涨少',
    createdAt: '2026-07-12',
    triggerCount: 26,
    violationCount: 6,
    isActive: true,
    monthViolationPct: 15,
    monthTrend: 'down',
  },
  {
    id: 2,
    title: '预期信心低于 3 星时只观察不操作',
    rationale: '模糊判断不应该有仓位，历史上低信心操作亏损率明显偏高',
    createdAt: '2026-08-01',
    triggerCount: 25,
    violationCount: 2,
    isActive: true,
    monthViolationPct: 8,
    monthTrend: 'flat',
  },
  {
    id: 4,
    title: '止损位设定后不移动',
    rationale: '防止越亏越拿，历史上移动止损后扩大亏损的概率为 78%',
    createdAt: '2026-07-01',
    triggerCount: 23,
    violationCount: 14,
    isActive: true,
    monthViolationPct: 65,
    monthTrend: 'up',
  },
  {
    id: 3,
    title: '单只个股仓位不超过总资金 20%',
    rationale: '控制集中度风险，防止单只股票行情对整体组合的冲击过大',
    createdAt: '2026-06-15',
    triggerCount: 18,
    violationCount: 0,
    isActive: false,
    monthViolationPct: 0,
    monthTrend: 'flat',
  },
]

function violationColor(pct: number) {
  if (pct >= 50) return { bar: 'bg-red-500', text: 'text-red-500', badge: 'bg-red-500/10 border-red-500/30 text-red-500' }
  if (pct >= 25) return { bar: 'bg-amber-400', text: 'text-amber-500', badge: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400' }
  return { bar: 'bg-green-500', text: 'text-green-500', badge: 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400' }
}

function ViolationBar({ pct }: { pct: number }) {
  const c = violationColor(pct)
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', c.bar)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={cn('text-[10.5px] font-semibold w-8 text-right', c.text)}>{pct}%</span>
    </div>
  )
}

function TrendLabel({ trend, value }: { trend?: 'up' | 'down' | 'flat'; value: number }) {
  if (value === 0) return <span className="text-[10.5px] text-green-500 font-semibold">0% ✓ 完美遵守</span>
  if (trend === 'down') return <span className="text-[10.5px] text-green-500">本月 {value}% ↓ 改善中</span>
  if (trend === 'up') return <span className="text-[10.5px] text-red-500">本月 {value}% ↑ 未改善 ⚠</span>
  return <span className="text-[10.5px] text-secondary-text">本月 {value}%</span>
}

export default function GrowthPrinciplesPage() {
  const [principles, setPrinciples] = useState(DEMO_PRINCIPLES)

  function toggleActive(id: number) {
    setPrinciples((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p))
    )
  }

  const active = principles.filter((p) => p.isActive)
  const inactive = principles.filter((p) => !p.isActive)
  const highViolation = active.filter((p) => (p.violationCount / Math.max(p.triggerCount, 1)) >= 0.5)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageTabNav />
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">我的交易原则</h1>
          <span className="text-xs text-secondary-text bg-muted/70 px-1.5 py-0.5 rounded-full">{active.length} 条活跃</span>
        </div>
        <Button variant="primary" size="sm">
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加原则
        </Button>
      </div>

      <div className="flex-1 px-5 py-4 space-y-3">

        {/* 高违规警示 */}
        {highViolation.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl bg-red-500/8 border border-red-500/20 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-500 mb-0.5">发现高违规率原则</p>
              <p className="text-xs text-secondary-text leading-relaxed">
                {highViolation.map((p) => `#${p.id}`).join('、')} 违规率超过 50%，这是你最需要关注的执行纪律问题。
                重新审视这些原则是否仍然适合，或思考如何改善执行。
              </p>
            </div>
          </div>
        )}

        {/* 活跃原则 */}
        {active.map((p) => {
          const violationPct = Math.round((p.violationCount / Math.max(p.triggerCount, 1)) * 100)
          const c = violationColor(violationPct)
          const isHigh = violationPct >= 50

          return (
            <div
              key={p.id}
              className={cn(
                'rounded-xl border bg-card shadow-sm overflow-hidden',
                isHigh ? 'border-red-500/40' : 'border-border/50',
              )}
            >
              <div className="px-4 pt-3 pb-2">
                {/* 头部：序号 + 标题 + 徽章 + 操作 */}
                <div className="flex items-start gap-2 mb-2">
                  <span className={cn(
                    'shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold mt-0.5',
                    isHigh ? 'bg-red-500/10 text-red-500' : 'bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))]',
                  )}>
                    {p.id}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground leading-snug">{p.title}</span>
                      {isHigh && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-500">
                          高违规警示
                        </span>
                      )}
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 flex items-center gap-0.5">
                        <CheckCircle className="w-2.5 h-2.5" /> 活跃
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" className="p-1.5 rounded-lg text-secondary-text hover:bg-muted/60 hover:text-foreground transition-colors" title="编辑">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => toggleActive(p.id)} className="p-1.5 rounded-lg text-secondary-text hover:bg-muted/60 hover:text-foreground transition-colors" title="停用">
                      <PauseCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 理由 */}
                <p className="text-xs text-secondary-text leading-relaxed ml-8 mb-2">{p.rationale}</p>

                {/* 统计行 */}
                <div className="ml-8 flex items-center gap-3 text-[11px] text-secondary-text flex-wrap">
                  <span>创建 {p.createdAt}</span>
                  <span>触发 {p.triggerCount} 次</span>
                  <span className={cn('font-semibold', c.text)}>
                    违规 {p.violationCount} 次（{violationPct}%）
                  </span>
                  <TrendLabel trend={p.monthTrend} value={p.monthViolationPct ?? 0} />
                </div>

                {/* 违规率进度条 */}
                <div className="ml-8 mt-1">
                  <ViolationBar pct={violationPct} />
                </div>

                {/* 高违规额外提示 */}
                {isHigh && (
                  <div className="ml-8 mt-2 rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                    <p className="text-[11.5px] text-red-500 leading-relaxed">
                      过去 {p.triggerCount} 次触发中，移动止损后扩大亏损的概率为 <strong>78%</strong>。建议重新建立自动止损委托习惯。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* 已停用 */}
        {inactive.length > 0 && (
          <div>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/40 bg-muted/30 text-xs text-secondary-text hover:bg-muted/50 transition-colors"
            >
              <span className="flex-1 text-left font-medium">已停用（{inactive.length} 条）</span>
              <span className="text-[10px]">点击展开 ▾</span>
            </button>
            <div className="mt-1.5 space-y-1.5">
              {inactive.map((p) => (
                <div key={p.id} className="rounded-xl border border-border/30 bg-card/60 px-4 py-3 opacity-60">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-muted flex items-center justify-center text-[10px] font-bold text-secondary-text shrink-0">{p.id}</span>
                    <span className="text-xs text-secondary-text font-medium">{p.title}</span>
                    <span className="text-[10px] text-secondary-text ml-auto">创建 {p.createdAt} · 违规率 0%</span>
                    <button type="button" onClick={() => toggleActive(p.id)} className="text-[10.5px] text-[hsl(var(--primary))] hover:underline ml-1">重新启用</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-secondary-text/50 text-center pb-2">
          以上为演示数据 · 后端接入后自动同步
        </p>
      </div>
    </div>
  )
}
