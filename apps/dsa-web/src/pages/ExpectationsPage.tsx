import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Plus, ChevronRight, TrendingUp, BarChart2, CheckSquare, Star } from 'lucide-react'
import { expectationsApi } from '../api/expectations'
import type { UserExpectation } from '../types/expectations'
import { Button } from '../components/common/Button'
import { Loading } from '../components/common/Loading'
import { Pagination } from '../components/common/Pagination'
import { PageTabNav } from '../components/common/PageTabNav'
import { DirectionBadge } from '../components/expectations/DirectionBadge'
import { cn } from '../utils/cn'

const PAGE_SIZE = 20
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const ACTION_LABEL: Record<string, string> = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓', hold: '持有', watch: '观望',
}
const ACTION_COLOR: Record<string, string> = {
  buy: 'text-green-500', add: 'text-green-500',
  sell: 'text-red-500',  reduce: 'text-red-500',
  hold: 'text-secondary-text', watch: 'text-secondary-text',
}

function isPast(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return d <= today
}

function groupByWeek(items: UserExpectation[]) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const dow = (now.getDay() + 6) % 7
  const monday = new Date(now); monday.setDate(now.getDate() - dow)
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7)

  const thisWeek: UserExpectation[] = []
  const lastWeek: UserExpectation[] = []
  const older:    UserExpectation[] = []

  for (const item of items) {
    const d = new Date(item.targetDate); d.setHours(0, 0, 0, 0)
    if (d >= monday)     thisWeek.push(item)
    else if (d >= lastMonday) lastWeek.push(item)
    else                      older.push(item)
  }

  const groups: { label: string; items: UserExpectation[] }[] = []
  if (thisWeek.length) groups.push({ label: '本周', items: thisWeek })
  if (lastWeek.length) groups.push({ label: '上周', items: lastWeek })
  if (older.length)    groups.push({ label: '更早', items: older })
  return groups
}

function StatChip({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 flex-1 min-w-[120px]">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[10.5px] text-secondary-text">{label}</div>
        <div className="text-base font-bold text-foreground">
          {value}
          {sub && <span className="text-xs font-normal text-secondary-text ml-1">{sub}</span>}
        </div>
      </div>
    </div>
  )
}

function ExpCard({ item, onClick }: { item: UserExpectation; onClick: () => void }) {
  const past = isPast(item.targetDate)
  const stocks = item.stockExpectations ?? []
  const stockCount = stocks.length
  const date = new Date(item.targetDate)
  const mmdd = item.targetDate.slice(5)
  const weekday = WEEKDAY[date.getDay()]

  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex items-stretch rounded-xl border bg-card cursor-pointer',
        'hover:shadow-sm transition-all duration-150',
        past ? 'border-amber-400/50 hover:border-amber-400/70' : 'border-border/50 hover:border-border',
      )}
    >
      <div className={cn(
        'w-1 rounded-l-xl shrink-0',
        item.indexDirection === 'up' ? 'bg-green-500' :
        item.indexDirection === 'down' ? 'bg-red-500' : 'bg-border/40',
      )} />
      <div className="flex-1 min-w-0 px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{mmdd}</span>
            <span className="text-xs text-secondary-text">周{weekday}</span>
            <DirectionBadge direction={item.indexDirection} size="sm" />
            {item.indexMagnitude && (
              <span className="text-[10.5px] text-secondary-text">
                {item.indexMagnitude === 'strong' ? '大幅' : item.indexMagnitude === 'moderate' ? '中幅' : '小幅'}
              </span>
            )}
            {stockCount > 0 && <span className="text-[10.5px] text-secondary-text">· {stockCount} 只个股</span>}
          </div>
          <p className="text-xs text-secondary-text leading-relaxed line-clamp-2">{item.indexReasoning}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {stocks.slice(0, 3).map((s) => (
              <span key={s.code} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted/70 border border-border/40 text-secondary-text">
                <span className={cn('font-medium', ACTION_COLOR[s.action])}>{ACTION_LABEL[s.action]}</span>
                <span>{s.code}</span>
              </span>
            ))}
            {stockCount > 3 && <span className="text-[10px] text-secondary-text/60">+{stockCount - 3}</span>}
            <span className={cn(
              'ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border',
              past
                ? 'bg-amber-400/12 border-amber-400/40 text-amber-600 dark:text-amber-400'
                : 'bg-muted border-border/40 text-secondary-text font-normal',
            )}>
              {past ? '待复盘' : '仅录入'}
            </span>
            {item.overallConfidence != null && (
              <span className="flex items-center gap-px ml-0.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className={cn('text-[10px]', i < item.overallConfidence! ? 'text-amber-400' : 'text-border/50')}>★</span>
                ))}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-secondary-text/40 group-hover:text-secondary-text shrink-0 mt-1 transition-colors" />
      </div>
    </div>
  )
}

export default function ExpectationsPage() {
  const navigate = useNavigate()
  const [items, setItems]     = useState<UserExpectation[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(async (p: number) => {
    const rid = ++reqRef.current
    setLoading(true); setError(null)
    try {
      const res = await expectationsApi.list({ page: p, pageSize: PAGE_SIZE })
      if (reqRef.current !== rid) return
      setItems(res.items); setTotal(res.total)
    } catch {
      if (reqRef.current !== rid) return
      setError('加载失败，请重试')
    } finally {
      if (reqRef.current === rid) setLoading(false)
    }
  }, [])

  useEffect(() => { load(page) }, [page, load])

  const totalPages   = Math.ceil(total / PAGE_SIZE)
  const groups       = groupByWeek(items)
  const pendingCount = items.filter((i) => isPast(i.targetDate)).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── 顶部标签导航 ── */}
      <PageTabNav latestId={items[0]?.id} />

      {/* ── 页面标题栏 ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">预期列表</h1>
          {total > 0 && (
            <span className="text-xs text-secondary-text bg-muted/70 px-1.5 py-0.5 rounded-full">{total}</span>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/expectations/new')}>
          <Plus className="w-3.5 h-3.5 mr-1" />今日预期
        </Button>
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4 space-y-4">

          {/* 概况 chips */}
          {total > 0 && (
            <div className="flex gap-3 flex-wrap">
              <StatChip icon={TrendingUp}  label="本周准确率" value="—"           color="bg-[hsl(var(--primary))/10] text-[hsl(var(--primary))]" />
              <StatChip icon={BarChart2}   label="连续命中"   value="—" sub="天"   color="bg-green-500/10 text-green-500" />
              <StatChip icon={CheckSquare} label="已录入"     value={String(total)} sub="条" color="bg-amber-500/10 text-amber-500" />
              <StatChip icon={Star}        label="Agent 评级" value="—"           color="bg-purple-500/10 text-purple-500" />
            </div>
          )}

          {loading && <div className="flex justify-center py-12"><Loading /></div>}
          {!loading && error && <p className="text-sm text-destructive text-center py-8">{error}</p>}

          {/* 空状态 */}
          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-5">
              <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--primary))/8] flex items-center justify-center">
                <Target className="w-7 h-7 text-[hsl(var(--primary))] opacity-60" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">开始你的第一次预期记录</p>
                <p className="text-sm text-secondary-text mt-2 leading-relaxed max-w-xs">
                  每日花 5–10 分钟写下你的市场判断，<br />
                  30 天后，你会看到自己真实的思维模式。
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => navigate('/expectations/new')}>
                录入今日预期 →
              </Button>
            </div>
          )}

          {/* 待复盘提醒 */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-400/8 border border-amber-400/30 px-4 py-3">
              <span className="text-sm">⏰</span>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                你有 <strong>{pendingCount}</strong> 条预期待复盘——记得收盘后填写自我复盘，让数据闭环。
              </p>
            </div>
          )}

          {/* 分周分组列表 */}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10.5px] font-bold text-secondary-text uppercase tracking-wide">{group.label}</span>
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-[10.5px] text-secondary-text">{group.items.length} 条</span>
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <ExpCard
                    key={item.id}
                    item={item}
                    onClick={() => navigate(`/expectations/${item.id}`)}
                  />
                ))}
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
