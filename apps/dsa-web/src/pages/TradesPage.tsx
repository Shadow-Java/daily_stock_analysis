import { Upload, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { Button } from '../components/common/Button'
import { PageTabNav } from '../components/common/PageTabNav'

function ScoreChip({ score }: { score: number }) {
  const cls =
    score >= 70
      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
      : score >= 50
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : 'bg-red-500/10 text-red-500'
  return (
    <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      执行 {score}{score < 70 ? ' ⚠' : ' ✅'}
    </span>
  )
}

function StatChip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3 flex-1 min-w-0">
      <div className="text-[10.5px] text-secondary-text mb-1">{label}</div>
      <div className="text-lg font-bold text-foreground leading-tight">{value}</div>
      {sub && <div className="text-[10.5px] text-secondary-text mt-0.5">{sub}</div>}
    </div>
  )
}

function BarRow({ label, pct, color, note }: { label: string; pct: number; color: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-secondary-text w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] text-secondary-text w-28 text-right">{pct}%{note ? ` ${note}` : ''}</span>
    </div>
  )
}

// 示例交割单数据（演示用）
const DEMO_TRADES = [
  {
    id: 1,
    date: '09-26',
    direction: 'sell' as const,
    code: '600519',
    name: '贵州茅台',
    qty: 50,
    price: 1789.0,
    pnl: '+¥1,050',
    pnlPct: '+1.19%',
    score: 78,
    matchNote: '持仓 7 天 · 止盈出场',
  },
  {
    id: 2,
    date: '09-19',
    direction: 'buy' as const,
    code: '600519',
    name: '贵州茅台',
    qty: 50,
    price: 1768.0,
    pnl: null,
    pnlPct: null,
    score: 52,
    matchNote: '延迟53min · 仓位50% · 止损未设置',
  },
  {
    id: 3,
    date: '09-17',
    direction: 'buy' as const,
    code: '300750',
    name: '宁德时代',
    qty: 100,
    price: 218.5,
    pnl: '+¥620',
    pnlPct: '+2.84%',
    score: 91,
    matchNote: '按时入场 · 仓位100% · 止损已设',
  },
]

export default function TradesPage() {
  const hasData = true // 演示用，改为 false 可看空状态

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageTabNav />
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">交割单</h1>
          <p className="text-xs text-secondary-text mt-0.5">客观的执行记录，与预期形成对照</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">周度复盘</Button>
          <Button variant="primary" size="sm">
            <Upload className="w-3.5 h-3.5 mr-1" />
            导入交割单
          </Button>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 space-y-4">

        {!hasData ? (
          /* ── 空状态 ── */
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-secondary-text">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
              <Upload className="w-7 h-7 opacity-40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">还没有交割单记录</p>
              <p className="text-xs text-secondary-text mt-1">导入券商交割单，与预期形成闭环对照</p>
            </div>
            <Button variant="primary" size="sm">
              <Upload className="w-3.5 h-3.5 mr-1" />
              导入交割单
            </Button>
          </div>
        ) : (
          <>
            {/* ── 本月概览 ── */}
            <div className="flex gap-3">
              <StatChip label="本月净盈亏" value="+¥8,320" />
              <StatChip label="成交笔数" value="12" sub="笔" />
              <StatChip label="执行评分均值" value="64" sub="/ 100" />
              <StatChip label="盈亏比" value="0.67" sub="↓ 低于 1.0" />
            </div>

            {/* ── 盈亏归因 ── */}
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground mb-3">本月盈亏归因拆解</h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary-text">方向判断贡献</span>
                  <span className="font-semibold text-green-500 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3" /> +¥12,400
                    <span className="text-secondary-text font-normal ml-1">(准确率 72%)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary-text">执行损耗</span>
                  <span className="font-semibold text-amber-500 flex items-center gap-1">
                    <ArrowDownRight className="w-3 h-3" /> -¥3,250
                    <span className="text-secondary-text font-normal ml-1">(延迟入场/仓位减半)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary-text">止损未执行</span>
                  <span className="font-semibold text-red-500 flex items-center gap-1">
                    <ArrowDownRight className="w-3 h-3" /> -¥1,830
                    <span className="text-secondary-text font-normal ml-1">(3 次应止损未止)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-secondary-text">手续费 / 印花</span>
                  <span className="font-semibold text-secondary-text">-¥890</span>
                </div>
                <div className="border-t border-border/30 pt-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">实际到手</span>
                  <span className="font-bold text-green-500">+¥8,320</span>
                </div>
              </div>
              <p className="text-[11px] text-secondary-text mt-3 pt-3 border-t border-border/30">
                结论：判断能力在线，主要损耗来自执行纪律（占潜在收益 <span className="text-red-500 font-semibold">-20%</span>）
              </p>
            </div>

            {/* ── 交割单列表 ── */}
            <div>
              <h2 className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-2">最近成交记录</h2>
              <div className="space-y-2">
                {DEMO_TRADES.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl border border-border/50 bg-card px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base
                        ${t.direction === 'buy' ? 'bg-green-500/10' : 'bg-red-500/10'}`}
                    >
                      {t.direction === 'buy'
                        ? <TrendingUp className="w-4 h-4 text-green-500" />
                        : <TrendingDown className="w-4 h-4 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{t.code} {t.name}</span>
                        <span
                          className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded
                            ${t.direction === 'buy'
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                              : 'bg-red-500/10 text-red-500'}`}
                        >
                          {t.direction === 'buy' ? '买入' : '卖出'}
                        </span>
                        <span className="text-[10.5px] text-secondary-text">
                          {t.date} · {t.qty}股 @ {t.price.toFixed(2)}
                        </span>
                        {t.pnl && (
                          <span className="text-[10.5px] font-semibold text-green-500">
                            {t.pnl} ({t.pnlPct})
                          </span>
                        )}
                        <ScoreChip score={t.score} />
                      </div>
                      <p className="text-[11px] text-secondary-text">{t.matchNote}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 交易习惯小结 ── */}
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <h2 className="text-xs font-semibold text-foreground mb-3">近 90 天交易习惯画像</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[10.5px] text-secondary-text uppercase tracking-wide font-semibold mb-2">出场习惯</p>
                  <BarRow label="止盈出场" pct={42} color="#68d391" />
                  <BarRow label="止损出场" pct={11} color="#fc8181" note="⚠ 严重不足" />
                  <BarRow label="时间到期" pct={31} color="#a0aec0" />
                  <BarRow label="情绪性卖出" pct={16} color="#f6ad55" />
                </div>
                <div>
                  <p className="text-[10.5px] text-secondary-text uppercase tracking-wide font-semibold mb-2">处置效应警告</p>
                  <div className="rounded-lg bg-red-500/8 border border-red-500/20 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-xs font-semibold text-red-500">发现处置效应</span>
                    </div>
                    <div className="text-xs text-secondary-text space-y-1">
                      <div>盈利单平均持仓 <span className="font-semibold text-foreground">2.8 天</span></div>
                      <div>亏损单平均持仓 <span className="font-semibold text-red-500">7.1 天</span></div>
                    </div>
                    <p className="text-[10.5px] text-secondary-text mt-2">赢家卖太快，输家持太久</p>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-secondary-text/60 text-center pb-2">
              以上数据为演示占位，导入真实交割单后自动更新
            </p>
          </>
        )}
      </div>
    </div>
  )
}
