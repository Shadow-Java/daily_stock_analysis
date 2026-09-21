import { FileText, Edit2, Download } from 'lucide-react'
import { PageTabNav } from '../components/common/PageTabNav'

const SECTIONS = [
  {
    title: '我擅长的',
    icon: '✅',
    color: 'border-green-500/25 bg-green-500/5',
    titleColor: 'text-green-600 dark:text-green-400',
    items: [
      '趋势判断：方向准确率 72%，强于参考基准',
      '持仓周期：短线（3-5天）表现最佳，持仓超 10 天准确率下降',
      '市场状态：震荡市胜率 68%，单边趋势市 61%',
    ],
  },
  {
    title: '我的短板',
    icon: '⚠',
    color: 'border-red-500/25 bg-red-500/5',
    titleColor: 'text-red-500',
    items: [
      '止损执行率仅 11%，系统性问题',
      '反弹判断准确率 42%，下跌中做多风险高',
      '尾盘入场比开盘入场平均差 -1.2%',
    ],
  },
  {
    title: '我需要回避的情景',
    icon: '🚫',
    color: 'border-amber-500/25 bg-amber-500/5',
    titleColor: 'text-amber-600 dark:text-amber-400',
    items: [
      '大盘单日涨幅 > 2% 后追涨（历史亏损率 67%）',
      '周五下午新建仓（周末平均损耗 -0.8%）',
      '连续盈利超过 5 天后加仓（过度自信触发率 80%）',
    ],
  },
  {
    title: '我的最优交易状态',
    icon: '⚡',
    color: 'border-[hsl(var(--primary))/25] bg-[hsl(var(--primary))/5]',
    titleColor: 'text-[hsl(var(--primary))]',
    items: [
      '情绪指数 4-6 区间（准确率 71%）',
      '研究时间 > 60 分钟',
      '当前无持仓焦虑',
    ],
  },
  {
    title: '已验证有效的原则',
    icon: '📌',
    color: 'border-purple-500/25 bg-purple-500/5',
    titleColor: 'text-purple-500',
    items: [
      '原则#2：预期信心低于 3 星时只观察（违规后结果更差 -23%）',
      '原则#3：单股仓位不超过 20%（从未违规，有效控制波动）',
    ],
  },
]

export default function GrowthMethodologyPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageTabNav />
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-green-500" />
          <h1 className="text-sm font-semibold text-foreground">我的交易方法论</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-foreground px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted/40 transition-colors">
            <Download className="w-3.5 h-3.5" />导出
          </button>
          <button type="button" className="flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] px-3 py-1.5 rounded-lg border border-[hsl(var(--primary))/30] bg-[hsl(var(--primary))/8] hover:bg-[hsl(var(--primary))/12] transition-colors">
            <Edit2 className="w-3.5 h-3.5" />编辑
          </button>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 space-y-3">

        {/* 头部说明 */}
        <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
          <p className="text-xs text-secondary-text leading-relaxed">
            基于过去 <span className="font-semibold text-foreground">92 天</span>的数据自动生成，可手动修改。
            这份文档不是一次写完的，随着数据积累由系统辅助你逐步填充和验证。
          </p>
          <p className="text-[10.5px] text-secondary-text/60 mt-1.5">
            数据更新于 2026-09-19 · 下次自动更新：积累满 100 天后
          </p>
        </div>

        {/* 各板块 */}
        {SECTIONS.map((s) => (
          <div key={s.title} className={`rounded-xl border ${s.color} p-4`}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-base">{s.icon}</span>
              <span className={`text-sm font-semibold ${s.titleColor}`}>{s.title}</span>
            </div>
            <ul className="space-y-1.5">
              {s.items.map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-secondary-text leading-relaxed">
                  <span className="shrink-0 text-secondary-text/40 mt-0.5">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 解锁提示 */}
        <div className="rounded-xl border border-dashed border-border/50 px-4 py-4 text-center">
          <p className="text-xs text-secondary-text">还有 <span className="font-semibold text-foreground">8 天</span>数据即可解锁「我的方法论完整版」</p>
          <div className="mt-2 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div className="h-full bg-[hsl(var(--primary))] rounded-full" style={{ width: '92%' }} />
          </div>
          <p className="text-[10.5px] text-secondary-text/60 mt-1.5">92 / 100 天</p>
        </div>

        <p className="text-[11px] text-secondary-text/50 text-center pb-2">
          以上为演示数据 · 后端接入后自动生成
        </p>
      </div>
    </div>
  )
}
