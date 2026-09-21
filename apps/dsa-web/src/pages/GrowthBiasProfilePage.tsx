import { Brain } from 'lucide-react'
import { PageTabNav } from '../components/common/PageTabNav'

const BIASES = [
  { name: '确认偏差', count: 32, pct: 38, color: '#fc8181', desc: '理由全部支持自己方向，无反例考虑', impact: '含此偏差预期准确率 52%，不含时 78%，差距 26%', tip: '下次提交前，主动写出一条反对自己判断的理由', lastTriggered: '09-18', monthCount: 8, lastMonthCount: 13 },
  { name: '近因效应', count: 20, pct: 24, color: '#f6ad55', desc: '过于看重最近几天的走势，忽视均值回归', impact: '影响短线反弹判断，历史上跟随近期趋势的操作胜率 44%', tip: '拉长时间维度，看 20日/60日 均线是否一致', lastTriggered: '09-17', monthCount: 5, lastMonthCount: 5 },
  { name: '损失厌恶', count: 16, pct: 19, color: '#f6ad55', desc: '亏损单"等回来"，频繁调整止损位', impact: '亏损单平均持仓 7.1 天，比盈利单多持仓 4.3 天', tip: '用「今天新建仓，还会买吗」重新评估亏损仓', lastTriggered: '09-16', monthCount: 4, lastMonthCount: 4 },
  { name: 'FOMO', count: 12, pct: 14, color: '#68d391', desc: '理由中包含「怕踏空」/ 「别人都在买」', impact: '追涨操作平均收益 -0.8%，相比基准更差', tip: '确保有独立逻辑支撑，不以别人动作作为理由', lastTriggered: '09-12', monthCount: 2, lastMonthCount: 5 },
  { name: '过度自信', count: 6, pct: 7, color: '#68d391', desc: '信心 5 星但历史准确率不足 50%', impact: '5星信心预期实际准确率 48%，低于平均', tip: '连续盈利后主动降低一档信心等级', lastTriggered: '09-05', monthCount: 1, lastMonthCount: 1 },
  { name: '处置效应', count: 4, pct: 5, color: '#a0aec0', desc: '赢家卖太快，输家持太久', impact: '盈利单平均 2.8 天 vs 亏损单 7.1 天', tip: '设置统一的持仓周期规则，不受盈亏影响', lastTriggered: '09-03', monthCount: 1, lastMonthCount: 2 },
]

function BiasBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-2.5 bg-muted/60 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function TrendChip({ cur, last }: { cur: number; last: number }) {
  const diff = cur - last
  if (diff < 0) return <span className="text-[10.5px] text-green-500 font-semibold">↓{Math.abs(diff)}次 改善</span>
  if (diff > 0) return <span className="text-[10.5px] text-red-500 font-semibold">↑{diff}次 增加</span>
  return <span className="text-[10.5px] text-secondary-text">持平</span>
}

export default function GrowthBiasProfilePage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageTabNav />
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-red-500" />
          <h1 className="text-sm font-semibold text-foreground">认知偏差画像</h1>
        </div>
        <span className="text-xs text-secondary-text bg-muted/70 px-2 py-1 rounded-full">近 90 天</span>
      </div>

      <div className="flex-1 px-5 py-4 space-y-4">

        {/* 总览条形图 */}
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs font-semibold text-foreground mb-3">你的高频认知偏差分布</div>
          <div className="space-y-2.5">
            {BIASES.map((b) => (
              <div key={b.name} className="flex items-center gap-3">
                <span className="text-xs text-secondary-text w-20 shrink-0">{b.name}</span>
                <BiasBar pct={b.pct * 2} color={b.color} />
                <span className="text-[11px] text-secondary-text w-20 text-right shrink-0">
                  {b.count}次 · {b.pct}%
                  {b.pct >= 30 && <span className="text-red-500 ml-1">← 重点</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 本月 vs 上月对比 */}
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs font-semibold text-foreground mb-3">趋势对比（本月 vs 上月）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left text-secondary-text font-medium pb-2 pr-4">偏差类型</th>
                  <th className="text-right text-secondary-text font-medium pb-2 px-3">本月</th>
                  <th className="text-right text-secondary-text font-medium pb-2 px-3">上月</th>
                  <th className="text-right text-secondary-text font-medium pb-2 pl-3">变化</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {BIASES.map((b) => (
                  <tr key={b.name}>
                    <td className="py-2 pr-4 text-foreground font-medium">{b.name}</td>
                    <td className="py-2 px-3 text-right text-foreground">{b.monthCount}次</td>
                    <td className="py-2 px-3 text-right text-secondary-text">{b.lastMonthCount}次</td>
                    <td className="py-2 pl-3 text-right"><TrendChip cur={b.monthCount} last={b.lastMonthCount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 偏差详情（可折叠） */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide">偏差详情</div>
          {BIASES.map((b) => (
            <details key={b.name} className="rounded-xl border border-border/50 bg-card overflow-hidden group">
              <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                <span className="text-sm font-semibold text-foreground flex-1">{b.name}</span>
                <span className="text-xs text-secondary-text">{b.count}次 · 最近触发 {b.lastTriggered}</span>
                <span className="text-secondary-text text-xs group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-4 pb-4 space-y-3 border-t border-border/40">
                <div className="pt-3">
                  <div className="text-[10.5px] font-semibold text-secondary-text uppercase tracking-wide mb-1">识别特征</div>
                  <p className="text-xs text-secondary-text leading-relaxed">{b.desc}</p>
                </div>
                <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-red-500/80 mb-1">对你准确率的影响</div>
                  <p className="text-xs text-secondary-text leading-relaxed">{b.impact}</p>
                </div>
                <div className="rounded-lg bg-[hsl(var(--primary))/5] border border-[hsl(var(--primary))/15] px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-[hsl(var(--primary))] mb-1">💡 处置建议</div>
                  <p className="text-xs text-secondary-text leading-relaxed">{b.tip}</p>
                </div>
              </div>
            </details>
          ))}
        </div>

        <p className="text-[11px] text-secondary-text/50 text-center pb-2">
          以上为演示数据 · 偏差标签由 Agent 评价时自动标注
        </p>
      </div>
    </div>
  )
}
