// 大盘情绪页 — /sentiment
// 设计参考：redesign/features/market-sentiment/ui-design.md § 6
// 数据来源：/api/v1/market-sentiment/*（快照表 + data_provider 实时）
import { useEffect, useMemo, useState } from 'react'
import { Thermometer, AlertTriangle, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../utils/cn'
import {
  sentimentApi,
  type SentimentOverview,
  type SentimentOverseas,
  type SentimentTrendPoint,
  type LadderPoint,
  type LadderTodayResponse,
  type FocusResponse,
  type FocusScope,
  type FocusEventItem,
  type TomorrowFocus,
  type LimitUpPoolItem,
  type PoolType,
} from '../api/sentiment'

// ─── 小工具 ──────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtVol(v: number | null | undefined): string {
  // 亿元 → 万亿
  if (v === null || v === undefined) return '—'
  return `${(v / 10000).toFixed(2)}万亿`
}

function fmtSealTime(hhmmss: string): string {
  if (!hhmmss || hhmmss.length < 4) return '—'
  return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}`
}

function fmtDay(d: string): string {
  // '2026-09-25' → '9月25日'
  const md = d.slice(5)
  const [m, day] = md.split('-')
  return `${parseInt(m, 10)}月${parseInt(day, 10)}日`
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function fmtWeekday(d: string): string {
  // '2026-09-25' → '周五'（无效日期返回空串）
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? '' : WEEKDAY_NAMES[t.getDay()]
}

// 仪表 5 档标签（对齐 ui-mockup：冰点/低迷/中性/活跃/过热 · 空头/弱势/中性/强势/过热）
function shortStage5(st: number | null): string {
  if (st === null) return '—'
  if (st >= 80) return '过热'
  if (st >= 60) return '活跃'
  if (st >= 40) return '中性'
  if (st >= 20) return '低迷'
  return '冰点'
}

function trendStage5(v: number | null): string {
  if (v === null) return '—'
  if (v >= 80) return '过热'
  if (v >= 60) return '强势'
  if (v >= 40) return '中性'
  if (v >= 20) return '弱势'
  return '空头'
}

const SHORT_COLOR = '#dd6b20'   // 短线情绪（mockup 橙）
const TREND_COLOR = '#00b8d9'   // 趋势情绪（mockup 青）

// 阶段色阶：绿 → 浅绿 → 琥珀 → 橙 → 红；两个极端档（最冷/最热）加重（深色 + font-extrabold），
// 中间档常规字重 + 浅底色，形成平滑过渡（A 股语义：红 = 热/多，绿 = 冷/空）
interface StageStyle {
  tempCls: string     // 卡片大号温度数字
  pillCls: string     // 阶段结论胶囊
  textCls: string     // 结论提示中的阶段名
  tipCls: string      // 💡 结论提示框色底（五档全突出，靠颜色区分情绪）
  markerColor: string // 仪表指针边框
}

const _COLD_EXTREME: StageStyle = {
  tempCls: 'text-[#38a169] font-extrabold',
  pillCls: 'bg-green-500/15 text-green-500 ring-green-500/40 font-extrabold',
  textCls: 'text-green-500 font-extrabold',
  tipCls: 'bg-green-500/10 border-green-500/30',
  markerColor: '#38a169',
}
const _COLD_MID: StageStyle = {
  tempCls: 'text-green-400',
  pillCls: 'bg-green-400/15 text-green-400 ring-green-400/40',
  textCls: 'text-green-400',
  tipCls: 'bg-green-400/8 border-green-400/20',
  markerColor: '#68d391',
}
const _NEUTRAL: StageStyle = {
  tempCls: 'text-amber-400',
  pillCls: 'bg-amber-400/15 text-amber-400 ring-amber-400/40',
  textCls: 'text-amber-400',
  tipCls: 'bg-amber-400/10 border-amber-400/25',
  markerColor: '#ecc94b',
}
const _HOT_MID: StageStyle = {
  tempCls: 'text-orange-400',
  pillCls: 'bg-orange-400/15 text-orange-400 ring-orange-400/40',
  textCls: 'text-orange-400',
  tipCls: 'bg-orange-400/10 border-orange-400/25',
  markerColor: '#ed8936',
}
const _HOT_EXTREME: StageStyle = {
  tempCls: 'text-[#e53e3e] font-extrabold',
  pillCls: 'bg-red-500/15 text-red-500 ring-red-500/40 font-extrabold',
  textCls: 'text-red-500 font-extrabold',
  tipCls: 'bg-red-500/10 border-red-500/30',
  markerColor: '#e53e3e',
}

const SHORT_STAGE_STYLES: Record<string, StageStyle> = {
  冰点: _COLD_EXTREME,
  低迷: _COLD_MID,
  中性: _NEUTRAL,
  活跃: _HOT_MID,
  过热: _HOT_EXTREME,
}

const TREND_STAGE_STYLES: Record<string, StageStyle> = {
  空头: _COLD_EXTREME,
  弱势: _COLD_MID,
  中性: _NEUTRAL,
  强势: _HOT_MID,
  过热: _HOT_EXTREME,
}

// ─── 小工具组件 ──────────────────────────────────────────────────

function DeltaVal({ v, suffix = '°' }: { v: number | null; suffix?: string }) {
  if (v === null) return <span className="text-secondary-text">—</span>
  const cls = v > 0 ? 'text-red-400' : v < 0 ? 'text-green-400' : 'text-secondary-text'
  const rounded = Math.round(v * 100) / 100
  return (
    <span className={cn('tabular-nums', cls)}>
      {rounded > 0 ? '+' : ''}{rounded}{suffix}
    </span>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 px-4 py-6 text-center text-[11px] text-secondary-text">
      {text}
    </div>
  )
}

// ─── 外盘情绪卡 ──────────────────────────────────────────────────

function ChgChip({ label, v }: { label: string; v: number | null | undefined }) {
  if (v === null || v === undefined) return null
  return (
    <span className={cn(
      'text-[11.5px] px-2 py-0.5 rounded tabular-nums font-medium',
      v >= 0 ? 'bg-red-400/10 text-red-400' : 'bg-green-400/10 text-green-400',
    )}>
      {label} {v > 0 ? '+' : ''}{v.toFixed(2)}%
    </span>
  )
}

function OverseasCard({ overseas }: { overseas: SentimentOverseas | null }) {
  const hasUs = !!overseas && (
    overseas.spx_chg !== null || overseas.ndx_chg !== null || overseas.dji_chg !== null
  )
  const hasKr = !!overseas && (overseas.kospi_chg !== null || overseas.kosdaq_chg !== null)
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-3">外盘情绪（先行锚）</div>
      {overseas && (hasUs || hasKr) ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-secondary-text w-16 shrink-0">美股昨夜</span>
            <ChgChip label="标普500" v={overseas.spx_chg} />
            <ChgChip label="纳斯达克" v={overseas.ndx_chg} />
            <ChgChip label="道琼斯" v={overseas.dji_chg} />
            {overseas.vix !== null && overseas.vix !== undefined && (
              <span className="text-[11.5px] px-2 py-0.5 rounded tabular-nums bg-muted/60 text-secondary-text">
                VIX {overseas.vix}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-secondary-text w-16 shrink-0">韩股盘中</span>
            <ChgChip label="KOSPI" v={overseas.kospi_chg} />
            <ChgChip label="KOSDAQ" v={overseas.kosdaq_chg} />
          </div>
        </div>
      ) : (
        <EmptyHint text="外盘摘要待收盘采集后更新" />
      )}
    </div>
  )
}

// ─── 指数行情卡（盘中实时 / 收盘快照） ───────────────────────────

interface IndexQuoteRow {
  name: string
  close: number | null
  chgPct: number | null
}

function IndexQuotesCard({ overview }: { overview: SentimentOverview | null }) {
  if (!overview) return null
  const rtIndices = overview.realtime?.indices ?? []
  const live = rtIndices.length > 0
  // 旧后端响应可能缺少 sh_close/sh_chg_pct 等字段（undefined），统一归一为 null
  const rows: IndexQuoteRow[] = live
    ? rtIndices.map((idx) => ({
        name: idx.name ?? idx.code ?? '—',
        close: idx.current ?? null,
        chgPct: idx.change_pct ?? null,
      }))
    : [
        { name: '上证指数', close: overview.indices.sh_close ?? null, chgPct: overview.indices.sh_chg_pct ?? null },
        { name: '沪深300', close: overview.indices.hs300_close ?? null, chgPct: overview.indices.hs300_chg_pct ?? null },
        { name: '上证50', close: null, chgPct: overview.indices.sh50_chg_pct ?? null },
        { name: '创业板指', close: null, chgPct: overview.indices.chinext_chg_pct ?? null },
      ]
  const hasData = rows.some((r) => r.chgPct !== null || r.close !== null)
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide">指数行情</div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-secondary-text">
          {live ? '实时' : '收盘'}
        </span>
      </div>
      {hasData ? (
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <span key={r.name} className={cn(
              'text-[11.5px] px-2 py-0.5 rounded tabular-nums font-medium inline-flex items-center gap-1.5',
              r.chgPct === null
                ? 'bg-muted/60 text-secondary-text'
                : r.chgPct >= 0 ? 'bg-red-400/10 text-red-400' : 'bg-green-400/10 text-green-400',
            )}>
              <span>{r.name}</span>
              <span>{r.close != null ? r.close.toFixed(2) : '—'}</span>
              <span>{fmtPct(r.chgPct, 2)}</span>
            </span>
          ))}
        </div>
      ) : (
        <EmptyHint text="指数行情待采集" />
      )}
    </div>
  )
}

// ─── 情绪演化主轴 ─────────────────────────────────────────────────

const AXIS_W = 720
const AXIS_H = 150
const AXIS_Y_TOP = 30     // 分值 100
const AXIS_Y_BOTTOM = 110 // 分值 0

function DualLineChart({ shortTemps, trendTemps }: {
  shortTemps: (number | null)[]
  trendTemps: (number | null)[]
}) {
  const n = shortTemps.length
  // 与日期行/量能柱对齐：每个交易日占 1/n 槽位，数据点居中
  const xOf = (i: number) => (n === 0 ? AXIS_W / 2 : ((i + 0.5) / n) * AXIS_W)
  const yOf = (v: number) => AXIS_Y_BOTTOM - (v / 100) * (AXIS_Y_BOTTOM - AXIS_Y_TOP)

  const series = (arr: (number | null)[], color: string) => {
    const pts = arr
      .map((v, i) => ({ x: xOf(i), y: v === null ? null : yOf(v) }))
      .filter((p): p is { x: number; y: number } => p.y !== null)
    if (pts.length === 0) return null
    const peak = pts.reduce((a, b) => (b.y < a.y ? b : a)) // y 最小 = 分值最高
    return (
      <g>
        {pts.length >= 2 && (
          <polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke={color} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          />
        )}
        {/* 区间高点 */}
        {pts.length >= 3 && <circle cx={peak.x} cy={peak.y} r="3" fill={color} />}
        {/* 最新点 */}
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5" />
      </g>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${AXIS_W} ${AXIS_H}`} preserveAspectRatio="none"
      className="w-full block" style={{ height: AXIS_H }}
    >
      {/* 横向网格线：0 / 50 / 100 */}
      {[AXIS_Y_TOP, 70, AXIS_Y_BOTTOM].map((y) => (
        <line key={y} x1="0" y1={y} x2={AXIS_W} y2={y} stroke="hsl(var(--border))" strokeWidth="1" />
      ))}
      {/* 今日竖虚线 */}
      <line
        x1={xOf(n - 1)} y1="12" x2={xOf(n - 1)} y2="138"
        stroke={TREND_COLOR} strokeDasharray="4 4" strokeWidth="1"
      />
      {series(trendTemps, TREND_COLOR)}
      {series(shortTemps, SHORT_COLOR)}
    </svg>
  )
}

function VolStrip({ vols }: { vols: (number | null)[] }) {
  const valid = vols.filter((v): v is number => v !== null)
  if (valid.length === 0) return null
  const max = Math.max(...valid)
  return (
    <div className="mt-4 pt-3 border-t border-border/40">
      <div className="text-[11px] text-secondary-text mb-3">
        量能轨迹（单位万亿）· <span className="text-red-400">红=放量</span> <span className="text-green-400">绿=缩量</span>
      </div>
      <div className="flex items-end gap-2 h-16 mt-4">
        {vols.map((v, i) => {
          if (v === null) return <div key={i} className="flex-1" />
          const isToday = i === vols.length - 1
          const prev = i > 0 ? vols[i - 1] : null
          const kind = isToday
            ? 'today'
            : prev !== null && prev !== undefined ? (v > prev ? 'up' : v < prev ? 'down' : 'flat') : 'flat'
          const bg = kind === 'up' ? '#fc8181' : kind === 'down' ? '#68d391' : kind === 'today' ? TREND_COLOR : '#cbd5e0'
          return (
            <div
              key={i}
              className="flex-1 relative rounded-t-[3px]"
              style={{ height: `${Math.max((v / max) * 100, 10)}%`, background: bg, minWidth: 0 }}
            >
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[11px] text-secondary-text whitespace-nowrap tabular-nums">
                {(v / 10000).toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MainAxis({ overview, trend }: { overview: SentimentOverview | null; trend: SentimentTrendPoint[] }) {
  const days = trend.map((p) => p.trade_date.slice(5))
  const shortTemps = trend.map((p) => p.sentiment_st)
  const trendTemps = trend.map((p) => p.sentiment_trend)
  const vols = trend.map((p) => p.total_amount)
  const n = days.length

  const st = overview?.temperature.st ?? (n > 0 ? shortTemps[n - 1] : null)
  const tr = overview?.temperature.trend ?? (n > 0 ? trendTemps[n - 1] : null)
  const todayVol = overview?.amount.total ?? (n > 0 ? vols[n - 1] : null)
  const vsPrev: number | null = overview?.amount.vs_prev_pct ?? null

  // 较昨日 / 较5日均值
  const delta = (series: (number | null)[], against: 'prev' | 'avg5'): number | null => {
    if (st === null || n === 0) return null
    const cur = series[n - 1]
    if (cur === null) return null
    if (against === 'prev') {
      const prev = n >= 2 ? series[n - 2] : null
      return prev === null ? null : cur - prev
    }
    const base = series.slice(Math.max(0, n - 6), n - 1).filter((v): v is number => v !== null)
    if (base.length === 0) return null
    return cur - base.reduce((a, b) => a + b, 0) / base.length
  }
  const stVsPrev = n >= 2 ? delta(shortTemps, 'prev') : null
  const stVsAvg5 = delta(shortTemps, 'avg5')
  const trVsPrev = n >= 2 ? delta(trendTemps, 'prev') : null
  const trVsAvg5 = delta(trendTemps, 'avg5')

  const volTag = vsPrev === null ? null : vsPrev >= 5 ? '放量' : vsPrev <= -5 ? '缩量' : '平量'

  // 动态过程：规则版文案
  let processText: string | null = null
  if (st !== null || tr !== null) {
    const parts: string[] = []
    if (st !== null) parts.push(`短线情绪 ${st}°（${shortStage5(st)}）`)
    if (tr !== null) parts.push(`趋势情绪 ${tr}°（${trendStage5(tr)}）`)
    if (st !== null && tr !== null && Math.abs(st - tr) >= 15) {
      parts.push(st < tr ? '两维度背离：题材弱、指数稳，注意节奏' : '短线强于趋势：题材活跃，留意持续性')
    }
    processText = parts.join('；')
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-3">
        情绪演化主轴（近 {n || '—'} 交易日）
      </div>

      {/* evo-stats：今日三要素 */}
      <div className="flex gap-7 flex-wrap mb-3">
        <div>
          <div className="text-[11px] text-secondary-text mb-0.5">短线温度</div>
          <div className="text-lg font-bold flex items-baseline gap-2 flex-wrap">
            <span style={{ color: SHORT_COLOR }}>{st === null ? '—' : `${st}°`}</span>
            <span className="text-[11px] font-medium text-secondary-text">较昨日 <DeltaVal v={stVsPrev} /></span>
            <span className="text-[11px] font-medium text-secondary-text">较5日均值 <DeltaVal v={stVsAvg5} /></span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-secondary-text mb-0.5">趋势温度</div>
          <div className="text-lg font-bold flex items-baseline gap-2 flex-wrap">
            <span style={{ color: TREND_COLOR }}>{tr === null ? '—' : `${tr}°`}</span>
            <span className="text-[11px] font-medium text-secondary-text">较昨日 <DeltaVal v={trVsPrev} /></span>
            <span className="text-[11px] font-medium text-secondary-text">较5日均值 <DeltaVal v={trVsAvg5} /></span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-secondary-text mb-0.5">量能（两市成交额）</div>
          <div className="text-lg font-bold flex items-baseline gap-2 flex-wrap">
            <span className="tabular-nums">{fmtVol(todayVol)}</span>
            <span className="text-[11px] font-medium text-secondary-text">较昨日 <DeltaVal v={vsPrev} suffix="%" /></span>
            {volTag && (
              <span className={cn(
                'text-[11px] font-semibold px-1.5 py-px rounded',
                volTag === '放量' ? 'bg-red-400/10 text-red-400' : volTag === '缩量' ? 'bg-green-400/10 text-green-400' : 'bg-muted/60 text-secondary-text',
              )}>
                {volTag}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 图例 + 日期区间 */}
      <div className="flex items-center gap-3.5 text-[11px] text-secondary-text mb-1">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-[3px] rounded-sm" style={{ background: SHORT_COLOR }} />短线情绪
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-[3px] rounded-sm" style={{ background: TREND_COLOR }} />趋势情绪
        </span>
        {n > 0 && (
          <span className="ml-auto text-[11px]">{days[0]} → {days[n - 1]} · 今日高亮</span>
        )}
      </div>

      <DualLineChart shortTemps={shortTemps} trendTemps={trendTemps} />

      {/* 日期轴（与量能柱槽位对齐，每日居中） */}
      {n > 0 && (
        <div className="flex mt-1">
          {days.map((d, i) => (
            <span
              key={i}
              className={cn(
                'flex-1 text-center text-[11px] tabular-nums',
                i === n - 1 ? 'font-bold text-foreground' : 'text-secondary-text',
              )}
            >
              {d}
            </span>
          ))}
        </div>
      )}

      <VolStrip vols={vols} />

      {/* 阶段轨迹 */}
      {n > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-3 text-[11px]">
          {days.slice(-5).map((d, idx) => {
            const i = n - Math.min(n, 5) + idx
            const isCur = i === n - 1
            return (
              <span
                key={i}
                className={cn(
                  'px-2 py-0.5 rounded border',
                  isCur
                    ? 'bg-[hsl(var(--primary))/10] border-[hsl(var(--primary))/30] text-[hsl(var(--primary))] font-semibold'
                    : 'bg-muted/30 border-border/50 text-secondary-text',
                )}
              >
                {d} {shortStage5(shortTemps[i])}
              </span>
            )
          })}
        </div>
      )}

      {/* 动态过程 */}
      <div className="rounded-lg bg-muted/40 border border-border/40 px-3 py-2.5 mt-3">
        <div className="text-[11px] font-semibold text-secondary-text uppercase tracking-wide mb-1.5">🧭 动态过程</div>
        {processText ? (
          <p className="text-xs text-foreground/90 leading-relaxed">{processText}</p>
        ) : (
          <p className="text-xs text-secondary-text">快照数据采集中，收盘后自动生成</p>
        )}
      </div>
    </div>
  )
}

// ─── 双维度情绪演化 ───────────────────────────────────────────────

interface MetricRow {
  label: string
  value: string
  valueCls?: string
  traj?: string | null
}

// 阶段结论提示（对齐 mockup senti-tip 文案风格）
const SHORT_ADVICE: Record<string, string> = {
  冰点: '忌追高接力，低位新题材首发属冰点试错，轻仓观察',
  低迷: '控制仓位，等情绪企稳信号再参与',
  中性: '正常节奏参与，聚焦主线题材，快进快出',
  活跃: '可适度打板接力，紧盯空间板高度与炸板率',
  过热: '警惕高潮后退潮，以兑现为主，勿追高',
}

const TREND_ADVICE: Record<string, string> = {
  空头: '空仓或轻仓观望，等右侧企稳信号',
  弱势: '小仓位试错，严格止损',
  中性: '可持仓优质趋势股，等放量突破再加仓',
  强势: '以持仓为主，回踩均线不破可加仓',
  过热: '逐步兑现利润，防冲高回落',
}

function SentimentCard({ icon, name, temp, stageLabel, style, fallbackColor, advice, gaugeLabels, metrics }: {
  icon: string
  name: string
  temp: number | null
  stageLabel: string
  style: StageStyle | null
  fallbackColor: string
  advice: string
  gaugeLabels: string[]
  metrics: MetricRow[]
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <span className="text-[13.5px] font-bold text-foreground">{name}</span>
        <span className={cn('text-[26px] ml-auto leading-none tabular-nums',
          temp === null ? 'font-extrabold text-foreground' : style?.tempCls)}>
          {temp === null ? '—' : `${temp}°`}
        </span>
        {/* 阶段结论（着重突出，随档位色阶） */}
        <span className={cn('text-[13px] px-3.5 py-1 rounded-full ring-1',
          style ? style.pillCls : 'bg-slate-400/15 text-slate-400 ring-slate-400/30')}>{stageLabel}</span>
      </div>
      {/* 仪表：渐变轨道 + 白芯指针 + 5 档标签（指针随档位色阶） */}
      <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#4299e1,#48bb78,#ecc94b,#ed8936,#e53e3e)' }}>
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-background shadow-md"
          style={{ left: `${Math.min(100, Math.max(0, temp ?? 0))}%`, border: `3px solid ${style?.markerColor ?? fallbackColor}` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-secondary-text">
        {gaugeLabels.map((l) => <span key={l}>{l}</span>)}
      </div>
      {/* 指标明细（含演变轨迹） */}
      <div className="border-t border-border/40 mt-3 pt-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex justify-between items-center text-xs py-[3.5px]">
            <span className="text-secondary-text">{m.label}</span>
            <span className="font-semibold text-foreground tabular-nums">
              <span className={m.valueCls}>{m.value}</span>
              {m.traj && <span className="ml-1.5 text-[11px] text-secondary-text font-normal tabular-nums">{m.traj}</span>}
            </span>
          </div>
        ))}
      </div>
      {/* 结论提示（五档全带档位色底，阶段名同步档位颜色加粗） */}
      {temp !== null && (
        <div className={cn('mt-3 rounded-lg border px-2.5 py-2 text-[11.5px] text-secondary-text leading-relaxed',
          style?.tipCls ?? 'bg-muted/40 border-border/50')}>
          💡 <b className={style?.textCls}>{stageLabel}</b>：{advice}
        </div>
      )}
    </div>
  )
}

function DualDimension({ overview, trend, ladderTrend }: {
  overview: SentimentOverview | null
  trend: SentimentTrendPoint[]
  ladderTrend: LadderPoint[]
}) {
  const st = overview?.temperature.st ?? null
  const tr = overview?.temperature.trend ?? null
  const stStage = shortStage5(st)
  const trStage = trendStage5(tr)

  // 轨迹均为 时间正序（旧 → 新），trend/ladderTrend 接口已按旧→新返回
  const traj = (arr: (number | null)[], fmt: (v: number) => string = String): string | null => {
    const vals = arr.filter((v): v is number => v !== null)
    return vals.length >= 2 ? vals.map(fmt).join('→') : null
  }
  const heights = ladderTrend.map((p) => p.max_height)
  const firstBoards = ladderTrend.map((p) => p.height_1)
  const limitUps = trend.map((p) => p.limit_up_count)
  const amounts = trend.map((p) => p.total_amount)
  const ad = overview?.advance_decline

  const stStyle = st !== null ? SHORT_STAGE_STYLES[stStage] ?? null : null
  const trStyle = tr !== null ? TREND_STAGE_STYLES[trStage] ?? null : null

  // 上证指数涨跌幅：盘中取实时行，盘后回落快照字段
  const shChg = overview?.realtime?.indices?.find((i) => i.name === '上证指数')
    ?.change_pct ?? overview?.indices.sh_chg_pct ?? null

  const SHORT_METRICS: MetricRow[] = [
    {
      label: '空间高度',
      value: `${heights[heights.length - 1] ?? '—'}板`,
      traj: traj(heights),
    },
    {
      label: '涨停家数',
      value: ad?.limit_up !== null && ad?.limit_up !== undefined ? String(ad.limit_up) : '—',
      traj: traj(limitUps),
    },
    {
      label: '首板家数',
      value: firstBoards[firstBoards.length - 1] !== null && firstBoards[firstBoards.length - 1] !== undefined
        ? String(firstBoards[firstBoards.length - 1]) : '—',
      traj: traj(firstBoards),
    },
    {
      label: '炸板率',
      value: ad?.blown_rate !== null && ad?.blown_rate !== undefined ? `${ad.blown_rate}%` : '—',
      valueCls: (ad?.blown_rate ?? 0) >= 20 ? 'text-red-400' : (ad?.blown_rate ?? 1) < 10 ? 'text-green-400' : '',
    },
    {
      label: '跌停家数',
      value: ad?.limit_down !== null && ad?.limit_down !== undefined ? String(ad.limit_down) : '—',
      valueCls: 'text-green-400',
    },
  ]

  const TREND_METRICS: MetricRow[] = [
    {
      label: '上证指数',
      value: shChg !== null ? fmtPct(shChg, 2) : '—',
      valueCls: shChg !== null
        ? shChg >= 0 ? 'text-red-400' : 'text-green-400'
        : undefined,
    },
    {
      label: '涨跌家数',
      value: ad?.up != null && ad?.down != null ? `${ad.up}/${ad.down}` : '—',
    },
    {
      label: '新高/新低',
      value: overview ? `${overview.new_high_60d ?? '—'}/${overview.new_low_60d ?? '—'}` : '—',
    },
    {
      label: '成交额',
      value: fmtVol(amounts[amounts.length - 1] ?? overview?.amount.total ?? null),
      traj: traj(amounts, (v) => (v / 10000).toFixed(2)),
    },
    {
      // 占位：两融余额暂无数据源，接入后自动生效
      label: '两融余额',
      value: '—',
    },
  ]

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-3">双维度情绪演化（短线 × 趋势）</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SentimentCard
          icon="⚡"
          name="短线情绪"
          temp={st}
          stageLabel={stStage}
          style={stStyle}
          fallbackColor={SHORT_COLOR}
          advice={SHORT_ADVICE[stStage] ?? '数据采集中'}
          gaugeLabels={['冰点', '低迷', '中性', '活跃', '过热']}
          metrics={SHORT_METRICS}
        />
        <SentimentCard
          icon="📈"
          name="趋势情绪"
          temp={tr}
          stageLabel={trStage}
          style={trStyle}
          fallbackColor={TREND_COLOR}
          advice={TREND_ADVICE[trStage] ?? '数据采集中'}
          gaugeLabels={['空头', '弱势', '中性', '强势', '过热']}
          metrics={TREND_METRICS}
        />
      </div>
      {/* 背离提示 */}
      {st !== null && tr !== null && Math.abs(st - tr) >= 15 && (
        <div className="mt-3 rounded-lg bg-amber-400/8 border border-amber-400/25 px-3 py-2 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
            <strong>维度背离</strong>：短线 {stStage} × 趋势 {trStage} → 关注节奏，勿追高。
          </p>
        </div>
      )}
    </div>
  )
}

// ─── 涨停聚焦（涨停/跌停个股池） ──────────────────────────────────

function LimitFocus({ ladderUp, ladderDown, ladderTrend, overview, onPoolFirstOpen }: {
  ladderUp: LadderTodayResponse | null
  ladderDown: LadderTodayResponse | null
  ladderTrend: LadderPoint[]
  overview: SentimentOverview | null
  onPoolFirstOpen: (t: PoolType) => void
}) {
  const [poolTab, setPoolTab] = useState<PoolType>('limit_up')
  const [groupMode, setGroupMode] = useState<'height' | 'sector'>('height')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const navigate = useNavigate()

  const isDown = poolTab === 'limit_down'
  const data = isDown ? ladderDown : ladderUp
  const pool = data?.pool ?? []

  // 连板数（涨停池） / 连续跌停天数（跌停池）
  const boardOf = (s: LimitUpPoolItem) =>
    (isDown ? (s.continuous_down_days ?? 1) : (s.consecutive_boards ?? 1))
  const boardLabel = (b: number) => (isDown ? `${b}天` : `${b}板`)

  const heights = ladderTrend.map((p) => p.max_height)
  const firstBoards = ladderTrend.map((p) => p.height_1)
  const maxBoards = Math.max(0, ...pool.map((s) => boardOf(s)))

  // 按高度分组（从高到低）：同一连板数的在一起；按板块分组（按家数从多到少）：行业聚合
  // 层级下钻：横排档位导航，同一时间只展开一档，默认选中第一档（最高板 / 家数最多板块）
  const groups = useMemo(() => {
    if (groupMode === 'height') {
      const map = new Map<number, LimitUpPoolItem[]>()
      for (const s of pool) {
        const b = boardOf(s)
        if (!map.has(b)) map.set(b, [])
        map.get(b)!.push(s)
      }
      return [...map.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([b, items]) => ({ key: boardLabel(b), label: isDown ? `连续${b}天` : `${b}板`, items }))
    }
    const map = new Map<string, LimitUpPoolItem[]>()
    for (const s of pool) {
      const sector = s.industry || '其他'
      if (!map.has(sector)) map.set(sector, [])
      map.get(sector)!.push(s)
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([sector, items]) => ({ key: sector, label: sector, items }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, groupMode])

  // 选中档位失效（切换池/分组模式）时自动回落到第一档
  const activeKey = selectedGroup && groups.some((g) => g.key === selectedGroup)
    ? selectedGroup
    : groups[0]?.key ?? null
  const activeGroup = groups.find((g) => g.key === activeKey) ?? null

  const isLeader = (s: LimitUpPoolItem) => boardOf(s) >= maxBoards && maxBoards > 0

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      {/* 近5日轨迹 */}
      <div className="flex items-center gap-4 text-[11px] text-secondary-text border-b border-border/30 pb-3 flex-wrap">
        <span>近{heights.length}日空间高度：<span className="text-foreground font-semibold">{heights.map((v) => v ?? '—').join(' → ') || '—'}</span> 板</span>
        <span>首板：<span className="text-foreground font-semibold">{firstBoards.map((v) => v ?? '—').join(' / ') || '—'}</span> 只</span>
        <span>今日涨停 <span className="text-red-400 font-bold">{overview?.advance_decline.limit_up ?? '—'}</span></span>
        <span>跌停 <span className="text-green-400 font-bold">{overview?.advance_decline.limit_down ?? '—'}</span></span>
        {!isDown && ladderUp?.snapshot?.max_height_name && (
          <span>空间板 <span className="text-foreground font-bold">{ladderUp.snapshot.max_height_name} {ladderUp.snapshot.max_height}板</span></span>
        )}
      </div>

      {/* 池 tab + 分组切换 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {([['limit_up', '🔴 涨停个股'], ['limit_down', '🟢 跌停个股']] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setPoolTab(k); setSelectedGroup(null); onPoolFirstOpen(k) }}
              className={cn('text-[11px] px-3 py-1.5 rounded-md border transition-colors font-medium',
                poolTab === k
                  ? k === 'limit_up'
                    ? 'bg-red-400/10 border-red-400/30 text-red-400 font-semibold'
                    : 'bg-green-400/10 border-green-400/30 text-green-400 font-semibold'
                  : 'border-border/40 text-secondary-text hover:border-border')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {(['height', 'sector'] as const).map((m) => (
            <button key={m} onClick={() => { setGroupMode(m); setSelectedGroup(null) }}
              className={cn('text-[11px] px-2.5 py-1 rounded-md border transition-colors',
                groupMode === m ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/30] text-[hsl(var(--primary))] font-semibold' : 'border-border/40 text-secondary-text hover:border-border')}>
              {m === 'height' ? (isDown ? '按连续跌停天数' : '按高度分组') : '按板块分类'}
            </button>
          ))}
        </div>
        {data?.pool_source && data.pool_source !== 'snapshot' && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/60 text-secondary-text">
            {data.pool_source === 'realtime' ? '实时数据' : '最近交易日'}
          </span>
        )}
      </div>

      {/* 层级下钻：档位导航横排（高度组从高到低 / 板块组按家数从多到少），默认选中第一档 */}
      {groups.length === 0 ? (
        <EmptyHint text={isDown ? '跌停池暂无数据（今日可能无跌停）' : '涨停池数据采集中（收盘后更新）'} />
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <button key={g.key} onClick={() => setSelectedGroup(g.key)}
                className={cn('text-[11.5px] px-3 py-1.5 rounded-full border transition-colors',
                  g.key === activeKey
                    ? isDown
                      ? 'bg-green-500/15 border-green-500/40 text-green-500 font-bold'
                      : 'bg-red-500/15 border-red-500/40 text-red-500 font-bold'
                    : 'border-border/40 text-secondary-text hover:border-border hover:text-foreground')}>
                {g.label} <span className="ml-0.5 tabular-nums">×{g.items.length}</span>
              </button>
            ))}
          </div>
          {/* 选中档位的富信息行卡片 */}
          {activeGroup && (
            <div className="space-y-1.5">
              {activeGroup.items.map((s) => {
                const board = boardOf(s)
                return (
                  <div key={s.code}
                    className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border/40 bg-card hover:bg-muted/30 transition-colors flex-wrap">
                    {!isDown && isLeader(s) && <span className="text-[12px] leading-none" title="空间板">👑</span>}
                    <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0',
                      isDown ? 'bg-green-400/15 text-green-400'
                        : board >= 3 ? 'bg-red-400/15 text-red-400'
                          : board === 2 ? 'bg-amber-400/15 text-amber-400'
                            : 'bg-muted text-secondary-text')}>
                      {boardLabel(board)}
                    </span>
                    <span className="text-[12.5px] font-bold text-foreground tabular-nums whitespace-nowrap">{s.code}</span>
                    <span className="text-[12.5px] font-semibold text-foreground whitespace-nowrap">{s.name}</span>
                    {s.industry && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 whitespace-nowrap">{s.industry}</span>
                    )}
                    <span className={cn('text-[12px] font-bold tabular-nums whitespace-nowrap',
                      (s.change_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400')}>
                      {s.change_pct !== null ? `${s.change_pct > 0 ? '+' : ''}${s.change_pct.toFixed(2)}%` : '—'}
                    </span>
                    <div className="flex items-center gap-2.5 text-[11px] text-secondary-text whitespace-nowrap ml-auto">
                      {s.seal_amount !== null && (
                        <span>封单 <span className="text-foreground font-semibold tabular-nums">{(s.seal_amount / 1e8).toFixed(2)}亿</span></span>
                      )}
                      {s.first_limit_time && (
                        <span>首封 <span className="text-foreground font-semibold tabular-nums">{fmtSealTime(s.first_limit_time)}</span></span>
                      )}
                      {s.break_count != null && (
                        <span>
                          {isDown ? '撬板' : '开板'}{' '}
                          <span className={cn('font-semibold tabular-nums', s.break_count > 0 ? 'text-amber-400' : 'text-foreground')}>
                            {s.break_count}次
                          </span>
                        </span>
                      )}
                      {s.limit_stat && <span className="tabular-nums">{s.limit_stat}</span>}
                    </div>
                    <button
                      onClick={() => navigate('/expectations/new')}
                      title="写入预期"
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/10] rounded p-1 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 市场聚焦演化 ─────────────────────────────────────────────────

const FOCUS_TABS = [
  { key: 'event' as const, label: '🔥 事件' },
  { key: 'sector' as const, label: '📊 板块' },
  { key: 'stock'  as const, label: '⭐ 个股' },
]

function LookbackNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11.5px] text-amber-500 leading-relaxed">
      {text}
    </div>
  )
}

// 影响级 chip：全页扫读锚点，11px/600 + ring 描边，与 meta chip 视觉分层
function impactChipCls(label: string | null): string {
  if (label === '重点关注') return 'bg-red-400/10 text-red-400 ring-1 ring-red-400/30'
  if (label === '全球关注') return 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/30'
  if (label === '延续关注') return 'bg-slate-400/10 text-slate-400'
  return 'bg-muted/60 text-secondary-text'
}

// 榜单序号方块（第一名红底）
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={cn('w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold shrink-0',
      rank === 1 ? 'bg-red-400/10 text-red-400' : 'bg-muted text-secondary-text')}>
      {rank}
    </span>
  )
}

// ── 事件时间与地区工具 ──
// 财经日历时间均为北京时间；非中国区事件附当地换算（浏览器 Intl，含夏令时）

const REGION_TZ: Record<string, { tz: string; label: string }> = {
  美国: { tz: 'America/New_York', label: '美东' },
  加拿大: { tz: 'America/Toronto', label: '美东' },
  英国: { tz: 'Europe/London', label: '伦敦' },
  欧元区: { tz: 'Europe/Berlin', label: '欧中' },
  德国: { tz: 'Europe/Berlin', label: '柏林' },
  法国: { tz: 'Europe/Berlin', label: '巴黎' },
  瑞士: { tz: 'Europe/Zurich', label: '苏黎世' },
  日本: { tz: 'Asia/Tokyo', label: '东京' },
  韩国: { tz: 'Asia/Seoul', label: '首尔' },
  澳大利亚: { tz: 'Australia/Sydney', label: '悉尼' },
  新西兰: { tz: 'Pacific/Auckland', label: '奥克兰' },
  印度: { tz: 'Asia/Kolkata', label: '新德里' },
  新加坡: { tz: 'Asia/Singapore', label: '新加坡' },
}

function regionOf(title: string): string | null {
  return title.match(/^\[([^\]]+)\]/)?.[1] ?? null
}

// 'HH:MM'（北京时间）→ 展示标签：外国事件 "20:30 北京（美东 08:30）"，中国事件原样
function eventTimeLabel(date: string, time: string | null | undefined, region: string | null): string | null {
  const m = (time || '').match(/^(\d{1,2}:\d{2})/)
  if (!m) return null
  const entry = region ? REGION_TZ[region] : undefined
  if (!entry) return m[1]
  try {
    const dt = new Date(`${date}T${m[1]}:00+08:00`)
    if (Number.isNaN(dt.getTime())) return m[1]
    const loc = new Intl.DateTimeFormat('zh-CN', {
      timeZone: entry.tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(dt)
    return `${m[1]} 北京（${entry.label} ${loc}）`
  } catch {
    return m[1]
  }
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MarketFocus({ tomorrow, focusWeek, focusMonth, onScopeFirstOpen }: {
  tomorrow: TomorrowFocus | null
  focusWeek: FocusResponse | null
  focusMonth: FocusResponse | null
  onScopeFirstOpen: (scope: FocusScope) => void
}) {
  const [scope, setScope] = useState<'tomorrow' | 'week' | 'month'>('tomorrow')
  const [focusTab, setFocusTab] = useState<'event' | 'stock' | 'sector'>('event')
  const [weekDay, setWeekDay] = useState<string | null>(null)  // 选中的日期，null = 全部 7 天
  const navigate = useNavigate()

  const SCOPE_TABS = [
    { key: 'tomorrow' as const, label: '🎯 明日重点' },
    { key: 'week'     as const, label: '📅 周聚焦'   },
    { key: 'month'    as const, label: '🌙 月聚焦'   },
  ]

  const statusStyle = (status: string) =>
    status === 'continue' ? 'bg-orange-400/10 text-orange-400 border border-orange-400/25'
      : status === 'fade_risk' ? 'bg-slate-400/10 text-slate-400 border border-slate-400/25'
        : 'bg-blue-400/10 text-blue-400 border border-blue-400/25'

  // 周期聚焦事件卡（前瞻 + 回顾共用）：日历行摘要含 "HH:MM ｜ 预期 x ｜ 前值 y"，
  // 时间前缀拆出为 chip；快讯行保留写入预期入口
  const renderEventCard = (e: FocusEventItem, idx: number, showDate = false) => {
    const timeMatch = e.summary?.match(/^(\d{1,2}:\d{2})\s*｜\s*(.*)$/)
    const time = timeMatch?.[1]
    const desc = timeMatch ? timeMatch[2] : (e.summary || '')
    const isCalendar = e.event_type === 'calendar'
    const isKey = e.impact_label === '重点关注'
    return (
      <div key={`${e.event_date}-${idx}`} className={cn('rounded-lg border p-3 space-y-1',
        isKey ? 'bg-red-400/[0.08] border-red-400/40 border-l-[3px] border-l-red-400'
          : e.impact_label === '延续关注' ? 'bg-muted/30 border-border/40'
            : e.sentiment === 'positive' ? 'bg-green-400/10 border-green-400/25'
              : e.sentiment === 'negative' ? 'bg-red-400/10 border-red-400/25'
                : 'bg-card border-border/40')}>
        <div className="flex items-center gap-2 flex-wrap">
          {(showDate || time) && (
            <span className="text-[11px] text-secondary-text tabular-nums">
              {[showDate ? `${e.event_date.slice(5)} ${fmtWeekday(e.event_date)}` : null,
                eventTimeLabel(e.event_date, time, regionOf(e.title)) ?? time].filter(Boolean).join(' · ')}
            </span>
          )}
          {e.impact_label && (
            <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md', impactChipCls(e.impact_label))}>
              {isKey ? '⭐ ' : ''}{e.impact_label}
            </span>
          )}
          {e.event_type && !isCalendar && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted/60 text-secondary-text">{e.event_type}</span>
          )}
          {e.related_sectors.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-md bg-blue-400/10 text-blue-400">{s}</span>)}
        </div>
        <p className="text-[13px] text-foreground font-semibold leading-snug">{e.title}</p>
        {desc && <p className="text-[11.5px] text-secondary-text leading-relaxed tabular-nums">{desc}</p>}
        {!isCalendar && (
          <div className="flex justify-end">
            <button onClick={() => navigate('/expectations/new')} className="flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] border border-[hsl(var(--primary))/30] px-2 py-0.5 rounded hover:bg-[hsl(var(--primary))/8] transition-colors">
              <Plus className="w-3 h-3" />写入预期
            </button>
          </div>
        )}
      </div>
    )
  }

  // 前瞻事件按日期分组（后端按日期升序返回）
  const groupEventsByDate = (events: FocusEventItem[]) => {
    const groups: { date: string; items: FocusEventItem[] }[] = []
    for (const e of events) {
      const last = groups[groups.length - 1]
      if (last && last.date === e.event_date) last.items.push(e)
      else groups.push({ date: e.event_date, items: [e] })
    }
    return groups
  }

  // 内层分段控件：与外层 scope 同规格、占满整行
  const renderTabRow = (
    <div className="flex gap-1 p-1 rounded-lg bg-muted/70">
      {FOCUS_TABS.map(({ key, label }) => (
        <button key={key} onClick={() => setFocusTab(key)}
          className={cn('flex-1 text-center py-2 px-3 rounded-md text-[13px] font-medium transition-all',
            focusTab === key ? 'bg-card text-foreground font-semibold shadow-sm' : 'text-secondary-text hover:text-foreground')}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">

      {/* ── 顶部 scope tab ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/70">
        {SCOPE_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => { setScope(key); if (key !== 'tomorrow') onScopeFirstOpen(key) }}
            className={cn(
              'flex-1 text-center py-2 px-3 rounded-md text-[13px] font-medium transition-all',
              scope === key
                ? 'bg-card text-foreground font-semibold shadow-sm'
                : 'text-secondary-text hover:text-foreground',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ① 明日重点聚焦 ── */}
      {scope === 'tomorrow' && <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-bold text-foreground">🎯 明日重点聚焦</span>
          {tomorrow && <span className="text-[12px] text-secondary-text tabular-nums">{fmtDay(tomorrow.for_date)} {fmtWeekday(tomorrow.for_date)}</span>}
          <span className="text-[11px] px-2 py-px rounded bg-muted/70 text-secondary-text">每日收盘采集后生成</span>
        </div>
        {!tomorrow ? (
          <EmptyHint text="待生成，预计收盘后更新" />
        ) : (
          <>
            {renderTabRow}

            {focusTab === 'event' && (
              <div className="space-y-1.5">
                {tomorrow.key_events.length === 0 ? (
                  <EmptyHint text="明日无重点财经事件（日历未生成或当日无重要数据发布）" />
                ) : tomorrow.key_events.map((e, i) => {
                  const isKey = e.sentiment === 'key'
                  return (
                    <div key={i} className={cn('rounded-lg border px-3 py-2.5 space-y-1',
                      isKey ? 'bg-red-400/[0.08] border-red-400/40 border-l-[3px] border-l-red-400' : 'bg-card border-border/40')}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {e.time && (
                          <span className="text-[12px] font-bold text-[hsl(var(--primary))] tabular-nums shrink-0">
                            {eventTimeLabel(tomorrow.for_date, e.time, e.code ?? regionOf(e.title)) ?? e.time}
                          </span>
                        )}
                        {e.code && <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-400/10 text-blue-400 shrink-0">{e.code}</span>}
                        {isKey && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-400/10 text-red-400 ring-1 ring-red-400/30 shrink-0">⭐ 重点关注</span>}
                      </div>
                      <p className="text-[13px] text-foreground font-semibold leading-snug">{e.title}</p>
                      {e.impact && <p className="text-[11.5px] text-secondary-text tabular-nums">{e.impact}</p>}
                    </div>
                  )
                })}
              </div>
            )}

            {focusTab === 'sector' && (
              <div className="space-y-2">
                <LookbackNote text="🧭 明日板块无法预知，以下为今日发酵回溯：涨停聚集 = 延续发酵，冷清 = 退潮风险" />
                {tomorrow.sector_watch.length === 0 ? (
                  <EmptyHint text="暂无板块数据" />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {tomorrow.sector_watch.map((s, i) => (
                      <div key={s.name} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 bg-card',
                        i === 0 ? 'border-red-400/40 bg-red-400/[0.06]' : 'border-border/40')}>
                        <RankBadge rank={i + 1} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold text-foreground">{s.name}</div>
                          <div className="text-[11px] text-secondary-text truncate">{s.reason}</div>
                        </div>
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0', statusStyle(s.status))}>
                          {s.status === 'continue' ? '延续发酵' : s.status === 'fade_risk' ? '退潮风险' : '转强观察'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {focusTab === 'stock' && (
              <div className="space-y-2">
                <LookbackNote text="🧭 以下为今日涨停梯队回溯：按连板高度排列，关注晋级与断板" />
                {tomorrow.stock_watch.length === 0 ? (
                  <EmptyHint text="今日无连板梯队" />
                ) : (
                  <div className="space-y-1.5">
                    {tomorrow.stock_watch.map((s, i) => (
                      <div key={s.code} className={cn('rounded-lg border px-3 py-2.5 bg-card space-y-1',
                        i === 0 ? 'border-red-400/40 bg-red-400/[0.06]' : 'border-border/40')}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-bold text-foreground tabular-nums">{s.code}</span>
                          <span className="text-[13px] font-semibold text-foreground">{s.name}</span>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-400/10 text-orange-400 border border-orange-400/25 shrink-0">{s.label}</span>
                          {s.concept && <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-400/10 text-blue-400">{s.concept}</span>}
                        </div>
                        {s.reason && <p className="text-[11.5px] text-secondary-text">{s.reason}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5">
              <div className="text-[11.5px] font-bold text-amber-500 mb-1">🧭 AI 前瞻</div>
              <p className="text-[12.5px] text-foreground/80 leading-relaxed">{tomorrow.ai_preview || '待生成'}</p>
            </div>
          </>
        )}
      </div>}

      {/* ── ② / ③ 周聚焦 / 月聚焦 ── */}
      {(scope === 'week' || scope === 'month') && (() => {
        const data = scope === 'week' ? focusWeek : focusMonth
        const isWeek = scope === 'week'
        const reviewLabel = isWeek ? '近 7 天回顾' : '上月回顾'
        const lookbackNote = isWeek
          ? '🧭 未来无板块/个股数据，以下回溯近 7 天：区间涨幅榜 + 最高连板空间榜'
          : '🧭 未来无板块/个股数据，以下回溯上月：整月涨幅最大板块 + 最高连板个股'
        const events = data?.events ?? []
        const keyCount = events.filter((e) => e.impact_label === '重点关注').length
        // 周聚焦 = 未来 7 天滚动窗口：逐日渲染（无日程的日子也罗列），星期导航锚点跳转
        const weekDays = isWeek ? Array.from({ length: 7 }, (_, i) => addDaysISO(todayISO(), i)) : []
        const byDate = new Map(groupEventsByDate(events).map((g) => [g.date, g.items]))
        return (
          <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-bold text-foreground">{isWeek ? '📅 周聚焦' : '🌙 月聚焦'}</span>
              <span className="text-[11px] px-2 py-px rounded bg-muted/70 text-secondary-text">
                {isWeek ? '未来 7 天滚动 · 每日采集刷新' : '本月首个采集日生成 · 整月固定'}
              </span>
            </div>

            {events.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-muted/70 text-secondary-text">
                  {isWeek ? '未来 7 天' : '本月'}前瞻 <b className="text-foreground ml-0.5">{events.length}</b>
                </span>
                {keyCount > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-red-400/10 text-red-400">
                    ⭐ 重点关注 <b className="ml-0.5">{keyCount}</b>
                  </span>
                )}
              </div>
            )}

            {renderTabRow}

            {focusTab === 'event' && (
              <div className="space-y-3">
                {isWeek ? (
                  <>
                    <div className="flex gap-1">
                      <button onClick={() => setWeekDay(null)}
                        className={cn('flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                          weekDay === null ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-bold'
                            : 'bg-muted/60 text-secondary-text hover:text-foreground')}>
                        全部
                      </button>
                      {weekDays.map((d, i) => (
                        <button key={d} onClick={() => setWeekDay(d)}
                          className={cn('flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                            weekDay === d ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-bold'
                              : 'bg-muted/60 text-secondary-text hover:text-foreground')}>
                          {i === 0 ? '今天' : fmtWeekday(d)}
                        </button>
                      ))}
                    </div>
                    {(weekDay ? [weekDay] : weekDays).map((d) => {
                      const items = byDate.get(d) ?? []
                      const isToday = d === todayISO()
                      return (
                        <div key={d} className="space-y-1.5">
                          <div className="flex items-center gap-2 rounded-md bg-muted/60 border border-border/30 px-2.5 py-1.5">
                            <span className="text-[12px] font-bold text-foreground tabular-nums">{fmtDay(d)}</span>
                            <span className="text-[11px] font-medium text-secondary-text">{isToday ? '今天 · ' : ''}{fmtWeekday(d)}</span>
                            <span className="ml-auto text-[11px] font-medium text-secondary-text">
                              {items.length > 0 ? `${items.length} 条` : '无重点日程'}
                            </span>
                          </div>
                          {items.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border/40 bg-muted/20 px-3 py-2 text-[11.5px] text-secondary-text">
                              无重点日程（休市或无重要数据发布）
                            </div>
                          ) : items.map((e, i) => renderEventCard(e, i))}
                        </div>
                      )
                    })}
                  </>
                ) : events.length === 0 ? (
                  <EmptyHint text="本月前瞻事件未生成（本月首个采集日自动生成）" />
                ) : groupEventsByDate(events).map(({ date, items }) => (
                  <div key={date} className="space-y-1.5">
                    <div className="flex items-center gap-2 rounded-md bg-muted/60 border border-border/30 px-2.5 py-1.5">
                      <span className="text-[12px] font-bold text-foreground tabular-nums">{fmtDay(date)}</span>
                      <span className="text-[11px] font-medium text-secondary-text">{fmtWeekday(date)}</span>
                      <span className="ml-auto text-[11px] font-medium text-secondary-text">{items.length} 条</span>
                    </div>
                    {items.map((e, i) => renderEventCard(e, i))}
                  </div>
                ))}
                {(data?.review_events ?? []).length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-secondary-text">🕘 {reviewLabel}（延续关注）</span>
                      <div className="flex-1 border-t border-dashed border-border/50" />
                    </div>
                    {data!.review_events.map((e, i) => renderEventCard(e, i, true))}
                  </div>
                )}
              </div>
            )}

            {focusTab === 'sector' && (
              <div className="space-y-2">
                <LookbackNote text={lookbackNote} />
                {(data?.sectors ?? []).length === 0 ? (
                  <EmptyHint text={isWeek ? '近 7 天回溯数据未生成（每日采集自动生成）' : '上月回溯数据未生成（本月首个采集日自动生成）'} />
                ) : data!.sectors.map((sec, i) => (
                  <div key={sec.sector_name} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 bg-card',
                    i === 0 ? 'border-red-400/40 bg-red-400/[0.06]' : 'border-border/40')}>
                    <RankBadge rank={i + 1} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] font-bold text-foreground shrink-0">{sec.sector_name}</span>
                        {sec.leader_code && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] truncate">
                            龙头 {sec.leader_code} {sec.leader_name}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-secondary-text mt-0.5 truncate">
                        {sec.lifecycle_stage}{sec.lifecycle_day ? ` · 最高 ${sec.lifecycle_day} 板` : ''}
                      </div>
                    </div>
                    {sec.limit_up_trend && sec.limit_up_trend.length > 0 && (
                      <div className="flex items-end gap-0.5 h-6 shrink-0">
                        {sec.limit_up_trend.map((v, j) => (
                          <div key={j} className={cn('w-2.5 rounded-sm', j === sec.limit_up_trend!.length - 1 ? 'bg-[hsl(var(--primary))]' : 'bg-muted')} style={{ height: `${Math.max(v * 14, 8)}%` }} />
                        ))}
                      </div>
                    )}
                    <span className={cn('text-[15px] font-extrabold tabular-nums text-right shrink-0',
                      (sec.chg_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400')}>
                      {fmtPct(sec.chg_pct)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {focusTab === 'stock' && (
              <div className="space-y-2">
                <LookbackNote text={lookbackNote} />
                {(data?.stocks ?? []).length === 0 ? (
                  <EmptyHint text={isWeek ? '近 7 天回溯数据未生成（每日采集自动生成）' : '上月回溯数据未生成（本月首个采集日自动生成）'} />
                ) : data!.stocks.map((s, i) => (
                  <div key={s.stock_code} className={cn('rounded-lg border px-3 py-2.5 bg-card space-y-1',
                    i === 0 ? 'border-red-400/40 bg-red-400/[0.06]' : 'border-border/40')}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-foreground tabular-nums">{s.stock_code}</span>
                      <span className="text-[13px] font-semibold text-foreground">{s.stock_name}</span>
                      {(s.boards ?? 0) > 0 && (
                        <span className={cn('text-[11px] font-extrabold px-2 py-0.5 rounded-md ring-1 shrink-0',
                          (s.boards ?? 0) >= 5
                            ? 'bg-gradient-to-br from-red-400/15 to-orange-400/15 text-red-400 ring-red-400/30'
                            : 'bg-gradient-to-br from-orange-400/15 to-amber-400/15 text-orange-400 ring-orange-400/30')}>
                          {(s.boards ?? 0) >= 5 ? '👑 ' : ''}{s.boards}连板
                        </span>
                      )}
                      <span className={cn('text-[15px] font-extrabold tabular-nums',
                        (s.chg_pct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400')}>
                        {s.chg_pct !== null ? `${s.chg_pct > 0 ? '+' : ''}${s.chg_pct.toFixed(2)}%` : '—'}
                      </span>
                      {s.concept_tags.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-md bg-blue-400/10 text-blue-400">{t}</span>)}
                    </div>
                    {s.reason && <p className="text-[11.5px] text-secondary-text">{s.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────

type SubView = 'emotion' | 'ladder' | 'focus'

export default function SentimentPage() {
  const [subView, setSubView] = useState<SubView>('emotion')

  const [overview, setOverview] = useState<SentimentOverview | null>(null)
  const [trend, setTrend] = useState<SentimentTrendPoint[]>([])
  const [ladderTrend, setLadderTrend] = useState<LadderPoint[]>([])
  const [ladderUp, setLadderUp] = useState<LadderTodayResponse | null>(null)
  const [ladderDown, setLadderDown] = useState<LadderTodayResponse | null>(null)
  const [focusWeek, setFocusWeek] = useState<FocusResponse | null>(null)
  const [focusMonth, setFocusMonth] = useState<FocusResponse | null>(null)
  const [tomorrow, setTomorrow] = useState<TomorrowFocus | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setFailed([])
      const results = await Promise.allSettled([
        sentimentApi.getOverview(),
        sentimentApi.getTrend(10),
        sentimentApi.getLadderTrend(5),
        sentimentApi.getLadderToday('limit_up'),
        sentimentApi.getFocus('week'),
        sentimentApi.getTomorrow(),
      ])
      if (cancelled) return
      const failures: string[] = []
      if (results[0].status === 'fulfilled') setOverview(results[0].value); else failures.push('overview')
      if (results[1].status === 'fulfilled') setTrend(results[1].value.items); else failures.push('trend')
      if (results[2].status === 'fulfilled') setLadderTrend(results[2].value.items); else failures.push('ladder')
      if (results[3].status === 'fulfilled') setLadderUp(results[3].value); else failures.push('ladder-today')
      if (results[4].status === 'fulfilled') setFocusWeek(results[4].value); else failures.push('focus-week')
      if (results[5].status === 'fulfilled') setTomorrow(results[5].value); else failures.push('tomorrow')
      setFailed(failures)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // 盘中 60s 轮询：仅交易阶段启用，页面不可见时暂停，恢复可见立即刷新一次
  const phaseLive = ['intraday', 'lunch_break', 'closing_auction'].includes(
    overview?.market_phase ?? ''
  )
  useEffect(() => {
    if (!phaseLive) return
    let cancelled = false
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const fresh = await sentimentApi.getOverview()
        if (!cancelled) setOverview(fresh)   // 失败保留旧数据
      } catch { /* 保留旧数据 */ }
    }
    const timer = window.setInterval(tick, 60_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phaseLive])

  // 月聚焦 / 跌停池懒加载（缓存）
  const [monthLoaded, setMonthLoaded] = useState(false)
  const [downLoaded, setDownLoaded] = useState(false)
  const handleScopeFirstOpen = (scope: FocusScope) => {
    if (scope === 'month' && !monthLoaded) {
      setMonthLoaded(true)
      sentimentApi.getFocus('month')
        .then(setFocusMonth)
        .catch(() => setFocusMonth(null))
    }
  }
  const handlePoolFirstOpen = (t: PoolType) => {
    if (t === 'limit_down' && !downLoaded) {
      setDownLoaded(true)
      sentimentApi.getLadderToday('limit_down')
        .then(setLadderDown)
        .catch(() => setLadderDown(null))
    }
  }

  const SUB_VIEWS: { key: SubView; label: string }[] = [
    { key: 'emotion', label: '① 情绪演化' },
    { key: 'ladder', label: '② 涨停聚焦' },
    { key: 'focus',  label: '③ 市场聚焦演化' },
  ]

  const headerPhase = (() => {
    switch (overview?.market_phase) {
      case 'intraday':
      case 'lunch_break':
      case 'closing_auction':
        return '· 盘中实时'
      case 'postmarket':
        return overview.is_complete ? '· 收盘快照' : '· 盘后采集中'
      case 'premarket':
      case 'non_trading':
        return '· 非交易时段'
      default:
        return overview?.is_complete ? '· 收盘快照' : '· 盘中/未采集'
    }
  })()
  const headerDate = overview?.trade_date
    ? `${overview.trade_date} ${headerPhase}`
    : '数据加载中…'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">大盘情绪</h1>
        </div>
        <span className="text-xs text-secondary-text">{headerDate}</span>
      </div>

      {/* 子视图导航 */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-border/40 shrink-0 bg-card">
        {SUB_VIEWS.map(({ key, label }) => (
          <button key={key} onClick={() => setSubView(key)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-medium transition-colors',
              subView === key
                ? 'bg-[hsl(var(--primary))/15] text-[hsl(var(--primary))] font-semibold border border-[hsl(var(--primary))/25]'
                : 'text-secondary-text hover:text-foreground hover:bg-muted/40',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 space-y-4">

          {loading && (
            <div className="rounded-xl border border-border/50 bg-card px-4 py-10 text-center text-xs text-secondary-text">
              情绪数据加载中…
            </div>
          )}

          {!loading && subView === 'emotion' && (
            <>
              <OverseasCard overseas={overview?.overseas ?? null} />
              <IndexQuotesCard overview={overview} />
              <MainAxis overview={overview} trend={trend} />
              <DualDimension overview={overview} trend={trend} ladderTrend={ladderTrend} />
            </>
          )}

          {!loading && subView === 'ladder' && (
            <LimitFocus
              ladderUp={ladderUp}
              ladderDown={ladderDown}
              ladderTrend={ladderTrend}
              overview={overview}
              onPoolFirstOpen={handlePoolFirstOpen}
            />
          )}

          {!loading && subView === 'focus' && (
            <MarketFocus
              tomorrow={tomorrow}
              focusWeek={focusWeek}
              focusMonth={focusMonth}
              onScopeFirstOpen={handleScopeFirstOpen}
            />
          )}

          {!loading && failed.length > 0 && (
            <div className="rounded-lg bg-amber-400/8 border border-amber-400/25 px-3 py-2 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                部分数据加载失败（{failed.join('、')}），可刷新重试；确认后端已启动且已登录。
              </p>
            </div>
          )}

          <p className="text-[11px] text-secondary-text/40 text-center pb-2">
            数据来源：data_provider 多源自动回退 · 收盘采集后以快照表为准
          </p>
        </div>
      </div>
    </div>
  )
}
