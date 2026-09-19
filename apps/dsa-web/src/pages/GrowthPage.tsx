import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight, Trophy, BookOpen, Brain, FileText } from 'lucide-react'
import { PageTabNav } from '../components/common/PageTabNav'

// ── 小工具组件 ──────────────────────────────────────────────

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <ArrowUpRight className="w-3.5 h-3.5 text-green-500" />
  if (trend === 'down') return <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
  return <Minus className="w-3.5 h-3.5 text-secondary-text" />
}

function MetricRow({
  label,
  value,
  trend,
  highlight,
}: {
  label: string
  value: string
  trend?: 'up' | 'down' | 'flat'
  highlight?: 'green' | 'red' | 'yellow'
}) {
  const valClass =
    highlight === 'green'
      ? 'text-green-500'
      : highlight === 'red'
        ? 'text-red-500'
        : highlight === 'yellow'
          ? 'text-amber-500'
          : 'text-foreground'

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-secondary-text">{label}</span>
      <div className="flex items-center gap-1">
        <span className={`text-xs font-semibold ${valClass}`}>{value}</span>
        {trend && <TrendIcon trend={trend} />}
      </div>
    </div>
  )
}

function BiasBar({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-secondary-text w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] text-secondary-text w-12 text-right">{count}次 {pct}%</span>
    </div>
  )
}

function AchievementBadge({ emoji, label, desc, unlocked }: { emoji: string; label: string; desc: string; unlocked: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium
        ${unlocked
          ? 'bg-[hsl(var(--primary))/8] border-[hsl(var(--primary))/25] text-[hsl(var(--primary))]'
          : 'bg-muted/40 border-border/40 text-secondary-text'
        }`}
    >
      <span className="text-base">{unlocked ? emoji : '○'}</span>
      <div>
        <div className="font-semibold leading-tight">{label}</div>
        <div className="text-[10.5px] opacity-70 font-normal leading-tight mt-0.5">{desc}</div>
      </div>
    </div>
  )
}

// ── 页面主体 ──────────────────────────────────────────────────

export default function GrowthPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageTabNav />
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">成长仪表盘</h1>
          <p className="text-xs text-secondary-text mt-0.5">这是一面镜子，而不是 KPI 墙</p>
        </div>
        <span className="text-xs text-secondary-text bg-muted/70 px-2 py-1 rounded-full">近 90 天</span>
      </div>

      <div className="flex-1 px-5 py-4 space-y-4">

        {/* ── 4 个指标卡 ── */}
        <div className="grid grid-cols-2 gap-3">

          {/* 思维质量 */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="text-[10.5px] font-bold text-secondary-text uppercase tracking-wide mb-2">🧠 思维质量</div>
            <MetricRow label="推理质量均值" value="3.8 / 5" trend="up" highlight="green" />
            <MetricRow label="信息利用完整性" value="3.2 / 5" trend="flat" />
            <MetricRow label="假设显式化率" value="89%" trend="up" highlight="green" />
            <MetricRow label="反对意见考虑率" value="41%" trend="up" />
          </div>

          {/* 执行纪律 */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="text-[10.5px] font-bold text-secondary-text uppercase tracking-wide mb-2">🎯 执行纪律</div>
            <MetricRow label="原则违规率" value="18%" trend="down" highlight="green" />
            <MetricRow label="止损执行率" value="67%" trend="up" highlight="yellow" />
            <MetricRow label="仓位按计划率" value="74%" trend="up" />
            <MetricRow label="入场时机偏差" value="±45 min" trend="flat" />
          </div>

          {/* 认知偏差 */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="text-[10.5px] font-bold text-secondary-text uppercase tracking-wide mb-3">🔍 认知偏差频率（近90天）</div>
            <BiasBar label="确认偏差" count={32} pct={70} color="#fc8181" />
            <BiasBar label="近因效应" count={20} pct={44} color="#f6ad55" />
            <BiasBar label="损失厌恶" count={16} pct={35} color="#f6ad55" />
            <BiasBar label="FOMO" count={12} pct={26} color="#68d391" />
            <BiasBar label="过度自信" count={6} pct={13} color="#68d391" />
            <div className="mt-2 pt-2 border-t border-border/30">
              <Link to="/growth/bias-profile" className="flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline">
                查看偏差详情 <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* 情绪分析 */}
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <div className="text-[10.5px] font-bold text-secondary-text uppercase tracking-wide mb-2">😌 情绪状态分析</div>
            <MetricRow label="最优情绪区间" value="4 – 6" highlight="green" />
            <MetricRow label="平静时准确率" value="71%" highlight="green" />
            <MetricRow label="高压时准确率" value="43%" highlight="red" />
            <MetricRow label="情绪-执行相关性" value="-0.62" highlight="red" />
            <div className="mt-3 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2">
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                高压状态下准确率比平静时低 <strong>28%</strong>，建议高情绪时先暂停录入。
              </p>
            </div>
          </div>
        </div>

        {/* ── 成就解锁 ── */}
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-foreground">成就解锁</span>
          </div>
          <div className="mb-3">
            <p className="text-[10.5px] text-secondary-text uppercase tracking-wide font-semibold mb-2">已解锁</p>
            <div className="grid grid-cols-2 gap-2">
              <AchievementBadge emoji="🔵" label="坚持记录" desc="连续记录超过 30 天" unlocked />
              <AchievementBadge emoji="🟢" label="止损进化" desc="止损执行率首次超过 60%" unlocked />
              <AchievementBadge emoji="🟡" label="偏差意识" desc="识别并标记超过 50 次认知偏差" unlocked />
              <AchievementBadge emoji="🟠" label="原则制定者" desc="建立个人原则库超过 5 条" unlocked />
            </div>
          </div>
          <div>
            <p className="text-[10.5px] text-secondary-text uppercase tracking-wide font-semibold mb-2">待解锁</p>
            <div className="grid grid-cols-2 gap-2">
              <AchievementBadge emoji="○" label="知行合一" desc="原则违规率连续 4 周 < 10%" unlocked={false} />
              <AchievementBadge emoji="○" label="逻辑严谨" desc="连续 10 次预期含 ≥ 2 条假设" unlocked={false} />
              <AchievementBadge emoji="○" label="复盘大师" desc="连续 30 天完成自我复盘" unlocked={false} />
              <AchievementBadge emoji="○" label="系统成型" desc="完整填写「我的交易方法论」" unlocked={false} />
            </div>
          </div>
        </div>

        {/* ── 快速入口 ── */}
        <div className="grid grid-cols-3 gap-3">
          <Link
            to="/growth/principles"
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--primary))/10] flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">我的原则库</div>
              <div className="text-[10.5px] text-secondary-text">5 条原则 · 违规率 18%</div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-secondary-text ml-auto" />
          </Link>

          <Link
            to="/growth/bias-profile"
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Brain className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">偏差画像</div>
              <div className="text-[10.5px] text-secondary-text">86 次标注 · 6 种偏差</div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-secondary-text ml-auto" />
          </Link>

          <Link
            to="/growth/methodology"
            className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-green-500" />
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">我的方法论</div>
              <div className="text-[10.5px] text-secondary-text">基于 92 天数据 · 可编辑</div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-secondary-text ml-auto" />
          </Link>
        </div>

        {/* 数据说明 */}
        <p className="text-[11px] text-secondary-text/60 text-center pb-2">
          以上数据为演示占位，接入后端后自动更新 · 至少 7 天记录后指标完整展示
        </p>
      </div>
    </div>
  )
}
