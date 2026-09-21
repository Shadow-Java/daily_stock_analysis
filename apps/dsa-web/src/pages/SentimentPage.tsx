// 大盘情绪页 — /sentiment
// 设计参考：feture-ui/design/ui-design.md § 6
import { useState } from 'react'
import { Thermometer, AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../utils/cn'

// ─── 演示数据 ────────────────────────────────────────────────────

const DAYS = ['09-10','09-11','09-12','09-13','09-16','09-17','09-18','09-19','09-20','09-21']

// 短线温度（近10日）
const SHORT_TEMPS  = [45, 52, 60, 71, 78, 65, 52, 38, 32, 32]
// 趋势温度（近10日）
const TREND_TEMPS  = [55, 57, 58, 60, 62, 61, 61, 61, 61, 61]
// 成交额（万亿）
const VOLUMES      = [1.28, 1.35, 1.41, 1.38, 1.30, 1.25, 1.22, 1.20, 1.18, 1.18]
// 涨停梯队高度（近5日）
const HEIGHTS      = [6, 4, 3, 3, 3]
// 涨停家数（近5日）
const LIMIT_UP     = [42, 38, 31, 26, 19]

const STAGE_LABELS: Record<string, { label: string; day: string; color: string }> = {
  '09-16': { label: '冰点',  day: '09-16', color: 'text-blue-400' },
  '09-17': { label: '启动',  day: '09-17', color: 'text-green-400' },
  '09-19': { label: '高潮',  day: '09-19', color: 'text-red-400' },
  '09-21': { label: '退潮',  day: '09-21', color: 'text-amber-400' },
}

const LIMIT_UP_LIST = [
  { code: '600713', name: 'XX股份',   boards: 3, sector: '算力租赁', role: '龙头', feature: '空间龙头·带领板块', seal: '0.8亿', time: '13:05', note: '弱转强', catalyst: '中标智算中心项目' },
  { code: '300424', name: 'XX能源',   boards: 2, sector: '固态电池', role: '龙头', feature: '带领板块上涨',       seal: '1.2亿', time: '10:02', note: '一字板', catalyst: '工信部固态电池路线图' },
  { code: '002480', name: 'XX装备',   boards: 2, sector: '固态电池', role: '小弟', feature: '',                  seal: '0.3亿', time: '13:20', note: '',      catalyst: '' },
  { code: '300831', name: 'XX科技',   boards: 2, sector: 'CPO·光模块', role: '龙头', feature: '孤立龙头',        seal: '0.5亿', time: '10:22', note: '',      catalyst: '' },
  { code: '600922', name: 'XX数据',   boards: 2, sector: '算力租赁', role: '小弟', feature: '',                  seal: '0.2亿', time: '14:35', note: '尾盘板', catalyst: '' },
]

const LIMIT_BLOWN = [
  { code: '600514', name: 'XX控股', sector: '固态电池', peak: '+7.2%', close: '+2.1%' },
  { code: '000785', name: 'XX材料', sector: '半导体',   peak: '+9.8%', close: '+1.3%' },
]

const EVENTS = [
  { time: '10:02', type: '政策', signal: 'bull', title: '工信部发布固态电池标准路线图，明确 2027 量产目标', sectors: ['固态电池','锂矿'], life: '🆕 今日首发', lifeStage: 'new', bg: '退潮期 × 利好 → 利好钝化，防高开低走', stocks: [{ code: '300424', pct: '+20.0%' }, { code: '002480', pct: '+10.0%' }] },
  { time: '09-19 15:30', type: '产业', signal: 'bull', title: '头部算力厂商宣布新一轮 GPU 集群扩容计划', sectors: ['算力租赁'], life: '🔥 发酵中（第3天）', lifeStage: 'hot', bg: '退潮期 × 延续热点 → 主线分化，龙头续涨但跟风炸板', stocks: [{ code: '600713', pct: '+10.0%' }, { code: '600922', pct: '+5.1%' }] },
  { time: '09-18 14:00', type: '海外', signal: 'bear', title: '美国发布新一批半导体设备出口管制清单', sectors: ['半导体设备'], life: '🧊 退潮（第2天）', lifeStage: 'cool', bg: '利空已部分消化，板块开始企稳', stocks: [{ code: '688819', pct: '-3.2%' }] },
]

const FOCUS_STOCKS = [
  { code: '300XXX', name: 'XX电力',  pct: '+19.9%', vol: '82亿', sector: '算力租赁', days: 3, trend: 'up',   reason: '三日两现机构专用席位买入，叠加热点空间板带动' },
  { code: '600713', name: 'XX股份',  pct: '+10.0%', vol: '38亿', sector: '算力租赁', days: 2, trend: 'flat', reason: '连续入选龙虎榜，今日卡位新高度' },
  { code: '300424', name: 'XX能源',  pct: '+20.0%', vol: '65亿', sector: '固态电池', days: 1, trend: 'new',  reason: '今日政策催化首板，封单强劲，为首发龙头' },
  { code: '688819', name: 'XX设备',  pct: '-3.2%',  vol: '12亿', sector: '半导体设备', days: 0, trend: 'out', reason: '昨日上榜，今日受出口管制影响出局' },
]

const HOT_SECTORS = [
  { name: '固态电池', pct: '+4.2%', flow: '+23.4亿', leader: '300424', hist: [1,3,5,7,7] },
  { name: '算力租赁', pct: '+3.1%', flow: '+18.2亿', leader: '600713', hist: [1,3,4,5,5] },
  { name: '半导体设备', pct: '-1.8%', flow: '-5.6亿', leader: '688819', hist: [5,3,2,1,0] },
]

// ─── 小工具组件 ──────────────────────────────────────────────────

function TempGauge({ value, stage, stageLabel }: { value: number; stage: 'short' | 'trend'; stageLabel: string }) {
  const color = value >= 70 ? 'text-red-400' : value >= 45 ? 'text-amber-400' : 'text-blue-400'
  const bg    = value >= 70 ? 'bg-red-400' : value >= 45 ? 'bg-amber-400' : 'bg-blue-400'
  return (
    <div className="flex items-center gap-3">
      <div className={cn('text-3xl font-bold tabular-nums leading-none', color)}>{value}°</div>
      <div>
        <div className={cn('text-xs font-semibold', color)}>{stageLabel}</div>
        <div className="text-[10.5px] text-secondary-text">{stage === 'short' ? '短线情绪' : '趋势情绪'}</div>
      </div>
      <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden ml-2">
        <div className={cn('h-full rounded-full transition-all', bg)} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function MiniLine({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data); const min = Math.min(...data)
  const h = 32; const w = 100
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / (max - min || 1)) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(' ').at(-1)!.split(',')[0]} cy={pts.split(' ').at(-1)!.split(',')[1]} r="3" fill={color} />
    </svg>
  )
}

function VolBar({ val, avg }: { val: number; avg: number }) {
  const ratio = val / avg
  const color = ratio > 1.15 ? '#fc8181' : ratio < 0.85 ? '#68d391' : '#a0aec0'
  const label = ratio > 1.15 ? '放量' : ratio < 0.85 ? '缩量' : '平量'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(ratio * 60, 100)}%`, background: color }} />
      </div>
      <span className="text-[10.5px] font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

function StageDot({ label, day, color }: { label: string; day: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn('w-2 h-2 rounded-full', color.replace('text-', 'bg-'))} />
      <div className={cn('text-[9.5px] font-bold', color)}>{label}</div>
      <div className="text-[9px] text-secondary-text">{day}</div>
    </div>
  )
}

// ─── 外盘情绪卡 ──────────────────────────────────────────────────

function OverseasCard() {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-3">外盘情绪（先行锚）</div>
      <div className="grid grid-cols-2 gap-4">
        {/* 美股 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🇺🇸</span>
            <span className="text-xs font-semibold text-foreground">美股（昨夜）</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {[['纳指','▲+0.8%','text-green-500'],['标普','▲+0.5%','text-green-500'],['SOX','▲+1.4%','text-green-500'],['金龙','▲+0.6%','text-green-500'],['VIX','15.2','text-secondary-text']].map(([k,v,c]) => (
              <div key={k} className="flex justify-between">
                <span className="text-secondary-text">{k}</span>
                <span className={c as string}>{v}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-bold text-green-400">58°</span>
            <span className="text-[10.5px] text-secondary-text">较昨日 <span className="text-green-400">+3°</span></span>
          </div>
          <MiniLine data={[55,52,54,55,58]} color="#68d391" />
          <div className="text-[9.5px] text-secondary-text">近5日: 55→52→54→55→58</div>
        </div>
        {/* 韩股 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-base">🇰🇷</span>
            <span className="text-xs font-semibold text-foreground">韩股（盘中）</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            {[['KOSPI','▼-0.3%','text-red-400'],['KOSDAQ','▼-0.6%','text-red-400'],['三星','▼-1.2%','text-red-400'],['海力士','▼-0.9%','text-red-400']].map(([k,v,c]) => (
              <div key={k} className="flex justify-between">
                <span className="text-secondary-text">{k}</span>
                <span className={c as string}>{v}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-bold text-red-400">41°</span>
            <span className="text-[10.5px] text-secondary-text">较昨日 <span className="text-red-400">-5°</span></span>
          </div>
          <MiniLine data={[50,48,45,46,41]} color="#fc8181" />
          <div className="text-[9.5px] text-secondary-text">近5日: 50→48→45→46→41</div>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-amber-400/8 border border-amber-400/25 px-3 py-2 flex gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
          外盘背离：美股(隔夜)偏多 × 韩股(今晨)走弱 → 半导体链条亚太段转弱，与 A股半导体设备退潮共振；外部锚分歧，题材靠内因。
        </p>
      </div>
    </div>
  )
}

// ─── 情绪演化主轴 ─────────────────────────────────────────────────

function MainAxis({ selectedDay, onSelectDay }: { selectedDay: number; onSelectDay: (i: number) => void }) {
  const todayShort = SHORT_TEMPS[SHORT_TEMPS.length - 1]
  const todayTrend = TREND_TEMPS[TREND_TEMPS.length - 1]
  const todayVol   = VOLUMES[VOLUMES.length - 1]
  const avgVol     = VOLUMES.slice(0, -1).reduce((a, b) => a + b, 0) / (VOLUMES.length - 1)

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide">情绪演化主轴（近 {DAYS.length} 交易日）</div>
        <div className="flex gap-1">
          {['5日','10日','20日'].map((d, i) => (
            <button key={d} className={cn('text-[10.5px] px-2 py-0.5 rounded-md transition-colors', i === 1 ? 'bg-[hsl(var(--primary))/15] text-[hsl(var(--primary))] font-semibold' : 'text-secondary-text hover:text-foreground')}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* 今日概况 */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <TempGauge value={todayShort} stage="short" stageLabel="退潮" />
          <div className="text-[10px] text-secondary-text mt-1">较昨日 <span className="text-red-400">-0°</span> · 较5日均值 <span className="text-red-400">-18°</span></div>
        </div>
        <div>
          <TempGauge value={todayTrend} stage="trend" stageLabel="偏多" />
          <div className="text-[10px] text-secondary-text mt-1">较昨日 <span className="text-secondary-text">0°</span> · 较5日均值 <span className="text-green-400">+1°</span></div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-foreground tabular-nums">{todayVol}万亿</div>
          </div>
          <div className="text-[10px] text-secondary-text mt-0.5">成交额 · 较昨日 <span className="text-secondary-text">±0%</span></div>
          <VolBar val={todayVol} avg={avgVol} />
        </div>
      </div>

      {/* 轨迹图 */}
      <div className="space-y-3">
        {/* 短线温度轨迹 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10.5px] text-secondary-text">短线情绪</span>
            <div className="flex gap-3 text-[9.5px] text-secondary-text">
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => onSelectDay(i)}
                  className={cn('tabular-nums transition-colors', i === selectedDay ? 'text-amber-400 font-bold' : 'hover:text-foreground')}>
                  {Short_TEMPS_val(i)}
                </button>
              ))}
            </div>
          </div>
          <MiniLine data={SHORT_TEMPS} color="#f6ad55" />
        </div>
        {/* 趋势温度轨迹 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10.5px] text-secondary-text">趋势情绪</span>
            <div className="flex gap-3 text-[9.5px] text-secondary-text">
              {TREND_TEMPS.map((v, i) => (
                <span key={i} className={cn('tabular-nums', i === selectedDay && 'text-[hsl(var(--primary))] font-bold')}>{v}</span>
              ))}
            </div>
          </div>
          <MiniLine data={TREND_TEMPS} color="hsl(var(--primary))" />
        </div>
        {/* 日期轴 */}
        <div className="flex justify-between relative">
          {DAYS.map((d, i) => (
            <button key={d} onClick={() => onSelectDay(i)}
              className={cn('text-[9px] text-secondary-text hover:text-foreground transition-colors', i === DAYS.length - 1 && 'font-bold text-foreground')}>
              {d.slice(3)}
            </button>
          ))}
        </div>
        {/* 阶段标注 */}
        <div className="flex justify-between items-end pt-1 border-t border-border/30">
          {Object.entries(STAGE_LABELS).map(([, s]) => <StageDot key={s.day} {...s} />)}
        </div>
      </div>

      {/* AI 动态过程 */}
      <div className="rounded-lg bg-muted/40 border border-border/40 px-3 py-2.5">
        <div className="text-[10.5px] font-semibold text-secondary-text uppercase tracking-wide mb-1.5">🧭 动态过程</div>
        <p className="text-xs text-foreground/90 leading-relaxed">
          短线情绪从 09-19 高潮(78°)连续两日回落至 32°，高位板断板、炸板率升至 41%，周期进入<strong>退潮</strong>；
          趋势情绪仍稳在 61° 偏多，两者背离——指数容错尚可，题材接力转弱。
          <span className="text-amber-400 ml-1">· 今日退潮第 2 天</span>
        </p>
      </div>
    </div>
  )
}

function Short_TEMPS_val(i: number) { return SHORT_TEMPS[i] }

// ─── 双维度情绪演化 ───────────────────────────────────────────────

function DualDimension() {
  const SHORT_INDICATORS = [
    { label: '空间高度', data: '6→4→3→3→3', trend: '下降' as const },
    { label: '晋级率',   data: '55→48→41→45→41', trend: '下降' as const },
    { label: '炸板率',   data: '18→25→30→38→41', trend: '上升' as const },
    { label: '昨涨停表现', data: '+2.1→+0.8→-0.4→-0.8→-0.6', trend: '转负' as const },
    { label: '大面数',   data: '1→3→6→8→9', trend: '上升' as const },
  ]
  const TREND_INDICATORS = [
    { label: '上证站 MA20', data: '连5日站稳', trend: 'ok' as const },
    { label: '涨跌家数',   data: '3200→2810→2210', trend: '收窄' as const },
    { label: '成交额',     data: '1.4→1.3→1.2→1.18万亿', trend: '缩量' as const },
    { label: '两融余额',   data: '+8→+12→+15→+18亿', trend: '流入' as const },
    { label: '新高/新低',  data: '160→140→120/86', trend: '收窄' as const },
  ]

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="text-xs font-semibold text-secondary-text uppercase tracking-wide mb-3">双维度情绪演化</div>
      <div className="grid grid-cols-2 gap-4">
        {/* 短线 */}
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-base">⚡</span>
              <span className="text-xs font-bold text-amber-500">短线情绪  32°</span>
            </div>
            <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-red-400/15 text-red-400">退潮</span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-amber-400" style={{ width: '32%' }} />
          </div>
          <div className="space-y-1.5">
            {SHORT_INDICATORS.map((ind) => (
              <div key={ind.label} className="flex items-center justify-between text-[10.5px]">
                <span className="text-secondary-text w-24 shrink-0">{ind.label}</span>
                <span className="text-foreground/80 font-mono text-[9.5px]">{ind.data}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 rounded bg-red-400/10 px-2 py-1.5 text-[10.5px] text-red-400 font-medium">
            💡 退潮期：忌打板接力，控制仓位
          </div>
        </div>
        {/* 趋势 */}
        <div className="rounded-lg border border-[hsl(var(--primary))/25] bg-[hsl(var(--primary))/5] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-base">📈</span>
              <span className="text-xs font-bold text-[hsl(var(--primary))]">趋势情绪  61°</span>
            </div>
            <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-green-400/15 text-green-400">偏多</span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: '61%' }} />
          </div>
          <div className="space-y-1.5">
            {TREND_INDICATORS.map((ind) => (
              <div key={ind.label} className="flex items-center justify-between text-[10.5px]">
                <span className="text-secondary-text w-24 shrink-0">{ind.label}</span>
                <span className="text-foreground/80 font-mono text-[9.5px]">{ind.data}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 rounded bg-green-400/10 px-2 py-1.5 text-[10.5px] text-green-400 font-medium">
            💡 偏多：趋势仓可持有
          </div>
        </div>
      </div>
      {/* 背离提示 */}
      <div className="mt-3 rounded-lg bg-amber-400/8 border border-amber-400/25 px-3 py-2 flex gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
          <strong>维度背离（已持续 2 日）</strong>：短线退潮 × 趋势偏多 → 指数环境不差，但题材情绪冰凉。
          趋势仓可持有；勿开新短线仓；低位新题材首发属「冰点试错」而非追高。
        </p>
      </div>
    </div>
  )
}

// ─── 涨停梯队演化 ─────────────────────────────────────────────────

function LimitUpLadder() {
  const [timeFilter, setTimeFilter] = useState<string>('全部')
  const [groupMode, setGroupMode] = useState<'height' | 'sector'>('height')
  const TIME_FILTERS = ['全部','一字板 9:25','早盘 9:30-10:30','上午 10:30-11:30','午后 13:00-14:00','尾盘 14:00-15:00']
  const navigate = useNavigate()

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      {/* 近5日轨迹 */}
      <div className="flex items-center gap-4 text-[11px] text-secondary-text border-b border-border/30 pb-3">
        <span>近5日空间高度：<span className="text-foreground font-semibold">{HEIGHTS.join(' → ')}</span> 板(下降↓)</span>
        <span>首板：<span className="text-foreground font-semibold">{LIMIT_UP.join(' / ')}</span> 只(萎缩↓)</span>
      </div>

      {/* 筛选器 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(['height','sector'] as const).map((m) => (
            <button key={m} onClick={() => setGroupMode(m)}
              className={cn('text-[10.5px] px-2.5 py-1 rounded-md border transition-colors',
                groupMode === m ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/30] text-[hsl(var(--primary))] font-semibold' : 'border-border/40 text-secondary-text hover:border-border')}>
              {m === 'height' ? '按高度分组' : '按板块分类'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {TIME_FILTERS.map((f) => (
            <button key={f} onClick={() => setTimeFilter(f)}
              className={cn('text-[10px] px-2 py-0.5 rounded-md border transition-colors',
                timeFilter === f ? 'bg-muted border-border text-foreground font-semibold' : 'border-border/30 text-secondary-text hover:border-border')}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* 今日统计 */}
      <div className="flex items-center gap-4 text-[11px]">
        <span className="text-secondary-text">今日涨停 <span className="text-green-400 font-bold">26</span></span>
        <span className="text-secondary-text">炸板 <span className="text-red-400 font-bold">18</span></span>
        <span className="text-secondary-text">跌停 <span className="text-red-400 font-bold">4</span></span>
        <button className="ml-auto text-[10.5px] text-[hsl(var(--primary))] hover:underline">只看自选</button>
      </div>

      {/* 梯队列表 */}
      <div className="space-y-1.5">
        {LIMIT_UP_LIST.map((s) => (
          <div key={s.code} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors group">
            <div className="flex items-center gap-1.5 shrink-0">
              {s.role === '龙头' && <span className="text-xs">👑</span>}
              <span className={cn('text-[10.5px] font-bold px-1.5 py-0.5 rounded',
                s.boards >= 3 ? 'bg-red-400/15 text-red-400' : s.boards === 2 ? 'bg-amber-400/15 text-amber-400' : 'bg-muted text-secondary-text')}>
                {s.boards}板
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{s.code} {s.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/60 text-secondary-text">{s.sector}</span>
                {s.feature && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))]">{s.feature}</span>}
                {s.note && <span className="text-[10px] text-secondary-text">{s.note}</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-secondary-text">
                <span>封单 {s.seal}</span>
                <span>首封 {s.time}</span>
                {s.catalyst && <span className="text-[hsl(var(--primary))/80]">{s.catalyst}</span>}
              </div>
            </div>
            <button
              onClick={() => navigate('/expectations/new')}
              className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-[hsl(var(--primary))] border border-[hsl(var(--primary))/30] px-2 py-1 rounded-md hover:bg-[hsl(var(--primary))/8] transition-all"
            >
              <Plus className="w-2.5 h-2.5" />写入预期
            </button>
          </div>
        ))}
      </div>

      {/* 炸板明细（折叠） */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer text-[11px] text-secondary-text hover:text-foreground py-1 select-none list-none">
          <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
          炸板明细（{LIMIT_BLOWN.length} 只）
        </summary>
        <div className="mt-2 space-y-1.5 pl-5">
          {LIMIT_BLOWN.map((s) => (
            <div key={s.code} className="flex items-center gap-3 text-[11px]">
              <span className="font-semibold text-foreground">{s.code} {s.name}</span>
              <span className="text-secondary-text">{s.sector}</span>
              <span className="text-amber-400">高点 {s.peak}</span>
              <span className="text-secondary-text">收 {s.close}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

// ─── 市场聚焦演化 ─────────────────────────────────────────────────

function fmtDay(d: string) {
  // '09-15' → '9月15日'
  const [m, day] = d.split('-')
  return `${parseInt(m)}月${parseInt(day)}日`
}

function MarketFocus() {
  const [scope, setScope] = useState<'tomorrow' | 'week' | 'month'>('tomorrow')
  const [focusTab, setFocusTab] = useState<'event' | 'stock' | 'sector'>('event')
  const WEEK_DAYS = ['09-15','09-16','09-17','09-18','09-19','09-21']
  const [weekDay, setWeekDay] = useState(WEEK_DAYS.length - 1)
  const navigate = useNavigate()

  const signalColor = (s: string) => s === 'bull' ? 'text-green-400' : s === 'bear' ? 'text-red-400' : 'text-secondary-text'
  const signalBg    = (s: string) => s === 'bull' ? 'bg-green-400/10 border-green-400/25' : s === 'bear' ? 'bg-red-400/10 border-red-400/25' : 'bg-muted/40 border-border/40'
  const lifeColor   = (stage: string) => stage === 'new' ? 'text-blue-400' : stage === 'hot' ? 'text-orange-400' : 'text-slate-400'

  const SCOPE_TABS = [
    { key: 'tomorrow' as const, label: '🎯 明日重点' },
    { key: 'week'     as const, label: '📅 周聚焦'   },
    { key: 'month'    as const, label: '🌙 月聚焦'   },
  ]

  return (
    <div className="space-y-4">

      {/* ── 顶部 scope tab ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/60">
        {SCOPE_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setScope(key)}
            className={cn(
              'flex-1 text-center py-1.5 px-3 rounded-md text-xs font-medium transition-all',
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
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <span className="text-sm font-semibold text-foreground">明日重点聚焦</span>
          <span className="text-[10.5px] text-secondary-text ml-1">9月22日 周二</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
            <div className="text-[10.5px] font-semibold text-secondary-text uppercase tracking-wide">关键事件</div>
            <ul className="space-y-1 text-xs text-foreground/80">
              <li>· 300424 中试产线进度公告（盘前）</li>
              <li>· 美国半导体设备新限制名单落地</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
            <div className="text-[10.5px] font-semibold text-secondary-text uppercase tracking-wide">关注板块</div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] px-2 py-1 rounded-md bg-orange-400/10 text-orange-400 border border-orange-400/25">固态电池（发酵延续候选）</span>
              <span className="text-[10.5px] px-2 py-1 rounded-md bg-slate-400/10 text-slate-400 border border-slate-400/25">算力租赁（退潮风险）</span>
              <span className="text-[10.5px] px-2 py-1 rounded-md bg-blue-400/10 text-blue-400 border border-blue-400/25">半导体设备（冰点试错）</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2.5">
          <div className="text-[10.5px] font-semibold text-amber-500 mb-1">🧭 AI 前瞻</div>
          <p className="text-xs text-foreground/80 leading-relaxed">
            短线退潮第 2 日，看固态电池能否接棒算力成为新主线；未确认转强前只做低位首板/二板。
          </p>
        </div>
      </div>}

      {/* ── ② 周聚焦 ── */}
      {scope === 'week' && <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">📅</span>
          <span className="text-sm font-semibold text-foreground">周聚焦</span>
        </div>

        {/* 时间轴 */}
        <div className="flex gap-0.5 border-b border-border/30 pb-2">
          {WEEK_DAYS.map((d, i) => (
            <button key={d} onClick={() => setWeekDay(i)}
              className={cn(
                'flex-1 text-[10.5px] py-1.5 rounded-t-md transition-colors text-center',
                weekDay === i
                  ? 'bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))] font-bold'
                  : 'text-secondary-text hover:text-foreground',
              )}>
              {i === WEEK_DAYS.length - 1
                ? <span className="flex flex-col items-center gap-0.5"><span className="text-[8.5px] text-[hsl(var(--primary))]">今日</span>{fmtDay(d)}</span>
                : fmtDay(d)}
            </button>
          ))}
        </div>

        {/* 内容 Tab */}
        <div className="flex gap-1">
          {([['event','🔥 热点事件'],['stock','⭐ 焦点个股'],['sector','📊 热点板块']] as const).map(([k,label]) => (
            <button key={k} onClick={() => setFocusTab(k)}
              className={cn('text-[10.5px] px-3 py-1 rounded-md border transition-colors',
                focusTab === k ? 'bg-muted border-border text-foreground font-semibold' : 'border-border/30 text-secondary-text hover:border-border')}>
              {label}
            </button>
          ))}
        </div>

        {focusTab === 'event' && (
          <div className="space-y-2">
            {EVENTS.map((e, i) => (
              <div key={i} className={cn('rounded-xl border p-3 space-y-2', signalBg(e.signal))}>
                <div className="flex items-start gap-2">
                  <span className={cn('text-[10.5px] font-bold shrink-0', signalColor(e.signal))}>{e.signal === 'bull' ? '🔴 利好' : '🟢 利空'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] text-secondary-text">{e.time}</span>
                      <span className="text-[10px] px-1.5 py-px rounded bg-muted/60 text-secondary-text">{e.type}</span>
                      {e.sectors.map((s) => <span key={s} className="text-[10px] px-1.5 py-px rounded bg-blue-400/10 text-blue-400">{s}</span>)}
                    </div>
                    <p className="text-xs text-foreground font-medium leading-snug">{e.title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10.5px]">
                  <span className={cn('font-semibold', lifeColor(e.lifeStage))}>{e.life}</span>
                  <span className="text-secondary-text">·</span>
                  <span className="text-secondary-text flex-1">{e.bg}</span>
                </div>
                <div className="flex items-center gap-2">
                  {e.stocks.map((s) => <span key={s.code} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-secondary-text">{s.code} <span className="text-green-400">{s.pct}</span></span>)}
                  <button onClick={() => navigate('/expectations/new')} className="ml-auto flex items-center gap-1 text-[10px] text-[hsl(var(--primary))] border border-[hsl(var(--primary))/30] px-2 py-0.5 rounded hover:bg-[hsl(var(--primary))/8] transition-colors">
                    <Plus className="w-2.5 h-2.5" />写入预期
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {focusTab === 'stock' && (
          <div className="space-y-1.5">
            {FOCUS_STOCKS.map((s) => (
              <div key={s.code} className="flex items-start gap-3 rounded-lg border border-border/40 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{s.code} {s.name}</span>
                    <span className={cn('text-xs font-bold', s.pct.startsWith('+') ? 'text-green-400' : 'text-red-400')}>{s.pct}</span>
                    <span className="text-[10px] text-secondary-text">{s.vol}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-secondary-text">{s.sector}</span>
                    <span className={cn('text-[10px] font-semibold', s.trend === 'up' ? 'text-green-400' : s.trend === 'new' ? 'text-blue-400' : s.trend === 'out' ? 'text-red-400' : 'text-secondary-text')}>
                      {s.trend === 'up' ? `连续上榜 ${s.days} 天 ↑` : s.trend === 'new' ? '🆕 今日新进' : s.trend === 'out' ? '↓ 今日掉出' : `连续上榜 ${s.days} 天 →`}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-secondary-text mt-1">{s.reason}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {focusTab === 'sector' && (
          <div className="space-y-2">
            {HOT_SECTORS.map((sec) => (
              <div key={sec.name} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5">
                <span className="text-xs font-semibold text-foreground w-20 shrink-0">{sec.name}</span>
                <span className={cn('text-xs font-bold', sec.pct.startsWith('+') ? 'text-green-400' : 'text-red-400')}>{sec.pct}</span>
                <span className="text-[10.5px] text-secondary-text">{sec.flow}</span>
                <span className="text-[10.5px] text-secondary-text">龙头 {sec.leader}</span>
                <div className="ml-auto flex items-end gap-0.5 h-5">
                  {sec.hist.map((v, i) => (
                    <div key={i} className={cn('w-3 rounded-sm', i === sec.hist.length - 1 ? 'bg-[hsl(var(--primary))]' : 'bg-muted')} style={{ height: `${Math.max(v * 14, 4)}%` }} />
                  ))}
                </div>
                <span className="text-[9.5px] text-secondary-text ml-1">{sec.hist.join('→')}</span>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* ── ③ 月聚焦 ── */}
      {scope === 'month' && <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🌙</span>
          <span className="text-sm font-semibold text-foreground">月聚焦</span>
          <span className="text-[10.5px] text-secondary-text ml-1">近 20 日</span>
        </div>
        <div className="space-y-2">
          {[
            { name: '固态电池', pct: '+18%', leader: '300424', leaderPct: '+42%', life: '🔥 发酵(第9天)', color: 'text-orange-400' },
            { name: '算力租赁', pct: '+11%', leader: '600713', leaderPct: '+31%', life: '🧊 退潮(第2天)', color: 'text-slate-400' },
          ].map((m) => (
            <div key={m.name} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 text-xs">
              <span className="font-semibold text-foreground w-20 shrink-0">{m.name}</span>
              <span className="text-green-400 font-bold">{m.pct}</span>
              <span className="text-secondary-text">龙头 {m.leader} <span className="text-green-400">{m.leaderPct}</span></span>
              <span className={cn('ml-auto font-semibold', m.color)}>{m.life}</span>
            </div>
          ))}
        </div>
        <div className="text-[10.5px] text-secondary-text">月度风格：小盘题材占优 · 成长强于价值 · 资金集中固态电池/算力</div>
      </div>}
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────

type SubView = 'emotion' | 'ladder' | 'focus'

export default function SentimentPage() {
  const [subView, setSubView] = useState<SubView>('emotion')
  const [selectedDay, setSelectedDay] = useState(DAYS.length - 1)

  const SUB_VIEWS: { key: SubView; label: string }[] = [
    { key: 'emotion', label: '① 情绪演化' },
    { key: 'ladder', label: '② 涨停梯队演化' },
    { key: 'focus',  label: '③ 市场聚焦演化' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">大盘情绪</h1>
        </div>
        <span className="text-xs text-secondary-text">2026-09-21 周一 · 盘中 14:32 更新</span>
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

          {subView === 'emotion' && (
            <>
              <OverseasCard />
              <MainAxis selectedDay={selectedDay} onSelectDay={setSelectedDay} />
              <DualDimension />
            </>
          )}

          {subView === 'ladder' && <LimitUpLadder />}

          {subView === 'focus'  && <MarketFocus />}

          <p className="text-[10.5px] text-secondary-text/40 text-center pb-2">
            以上为演示数据 · 后端接入 AkShare 后实时更新
          </p>
        </div>
      </div>
    </div>
  )
}
