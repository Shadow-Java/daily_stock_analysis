import type { UserExpectation } from '../../types/expectations'
import { DirectionBadge } from './DirectionBadge'
import { cn } from '../../utils/cn'

const MARKET_LABEL: Record<string, string> = { cn: 'A股', hk: '港股', us: '美股' }
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const ACTION_LABEL: Record<string, string> = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓', hold: '持有', watch: '观望',
}
const ACTION_COLOR: Record<string, string> = {
  buy: 'text-green-500', add: 'text-green-500',
  sell: 'text-red-500', reduce: 'text-red-500',
  hold: 'text-secondary-text', watch: 'text-secondary-text',
}

function getStatus(targetDate: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t = new Date(targetDate)
  t.setHours(0, 0, 0, 0)
  if (t > today) return 'future' as const
  return 'pending' as const   // past or today → needs review
}

interface Props {
  expectation: UserExpectation
  onClick?: () => void
  selected?: boolean
}

export function ExpectationCard({ expectation, onClick, selected }: Props) {
  const stockCount = expectation.stockExpectations?.length ?? 0
  const stocks = expectation.stockExpectations ?? []
  const status = getStatus(expectation.targetDate)

  const date = new Date(expectation.targetDate)
  const weekday = WEEKDAY[date.getDay()]
  const mmdd = expectation.targetDate.slice(5)

  const leftBar =
    expectation.indexDirection === 'up'
      ? 'bg-green-500'
      : expectation.indexDirection === 'down'
        ? 'bg-red-500'
        : 'bg-border/50'

  // 待复盘用黄色边框高亮
  const pendingBorder = status === 'pending' && !selected
    ? 'border-amber-400/60'
    : ''

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex cursor-pointer overflow-hidden rounded-xl border bg-card transition-all duration-150',
        selected
          ? 'border-[hsl(var(--primary))/50] ring-1 ring-[hsl(var(--primary))/25] shadow-md'
          : cn('hover:border-border hover:shadow-sm', pendingBorder),
      )}
    >
      {/* 左边方向色条 */}
      <div className={cn('w-1 shrink-0', leftBar)} />

      <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1.5">
        {/* 行 1：日期 + 状态 + 市场 */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold text-foreground leading-none">{mmdd}</span>
            <span className="text-[11px] text-secondary-text">周{weekday}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {status === 'pending' && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/40 text-amber-600 dark:text-amber-400 leading-tight">
                待复盘
              </span>
            )}
            {status === 'future' && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-muted border border-border/40 text-secondary-text leading-tight">
                仅录入
              </span>
            )}
            <span className="text-[10px] text-secondary-text/60 bg-muted/60 px-1 py-0.5 rounded">
              {MARKET_LABEL[expectation.market] ?? expectation.market}
            </span>
          </div>
        </div>

        {/* 行 2：方向 + 幅度 + 个股数 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <DirectionBadge direction={expectation.indexDirection} size="sm" />
          {expectation.indexMagnitude && (
            <span className="text-[10.5px] text-secondary-text">
              {expectation.indexMagnitude === 'strong' ? '大幅' : expectation.indexMagnitude === 'moderate' ? '中幅' : '小幅'}
            </span>
          )}
          {stockCount > 0 && (
            <span className="text-[10.5px] text-secondary-text">· {stockCount} 只个股</span>
          )}
        </div>

        {/* 行 3：理由摘要 */}
        <p className="text-[11.5px] text-secondary-text leading-relaxed line-clamp-2">
          {expectation.indexReasoning}
        </p>

        {/* 行 4：个股 chips */}
        {stockCount > 0 && (
          <div className="flex gap-1 flex-wrap">
            {stocks.slice(0, 3).map((s) => (
              <span
                key={s.code}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted/70 border border-border/40 text-secondary-text"
              >
                <span className={cn('font-medium', ACTION_COLOR[s.action])}>{ACTION_LABEL[s.action]}</span>
                <span>{s.code}</span>
              </span>
            ))}
            {stockCount > 3 && (
              <span className="text-[10px] text-secondary-text/60 self-center">+{stockCount - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
