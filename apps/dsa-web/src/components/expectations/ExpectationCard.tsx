import type { UserExpectation } from '../../types/expectations'
import { DirectionBadge } from './DirectionBadge'
import { cn } from '../../utils/cn'

const MARKET_LABEL: Record<string, string> = { cn: 'A股', hk: '港股', us: '美股' }
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const ACTION_LABEL: Record<string, string> = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓', hold: '持有', watch: '观望',
}
const ACTION_COLOR: Record<string, string> = {
  buy: 'text-green-500 dark:text-green-400',
  add: 'text-green-500 dark:text-green-400',
  sell: 'text-red-500 dark:text-red-400',
  reduce: 'text-red-500 dark:text-red-400',
  hold: 'text-secondary-text',
  watch: 'text-secondary-text',
}

interface Props {
  expectation: UserExpectation
  onClick?: () => void
  selected?: boolean
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex gap-px" aria-label={`信心 ${value}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn('text-[11px]', i < value ? 'text-amber-400' : 'text-border/60')}>
          ★
        </span>
      ))}
    </span>
  )
}

export function ExpectationCard({ expectation, onClick, selected }: Props) {
  const stockCount = expectation.stockExpectations?.length ?? 0
  const stocks = expectation.stockExpectations ?? []

  const date = new Date(expectation.targetDate)
  const weekday = WEEKDAY[date.getDay()]
  const mmdd = expectation.targetDate.slice(5)

  // 方向对应的左边条颜色
  const barColor =
    expectation.indexDirection === 'up'
      ? 'bg-green-500'
      : expectation.indexDirection === 'down'
        ? 'bg-red-500'
        : 'bg-border/60'

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex cursor-pointer overflow-hidden rounded-xl border bg-card transition-all duration-150',
        selected
          ? 'border-[hsl(var(--primary))/50] ring-1 ring-[hsl(var(--primary))/30] shadow-md'
          : 'border-border/60 hover:border-border hover:shadow-sm',
      )}
    >
      {/* 左边方向色条 */}
      <div className={cn('w-1 shrink-0 rounded-l-xl', barColor)} />

      <div className="flex-1 min-w-0 p-3 space-y-2">
        {/* 行 1：日期 + 市场 */}
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold text-foreground leading-none">{mmdd}</span>
            <span className="text-[11px] text-secondary-text">周{weekday}</span>
          </div>
          <span className="text-[10.5px] text-secondary-text/70 bg-muted/60 px-1.5 py-0.5 rounded">
            {MARKET_LABEL[expectation.market] ?? expectation.market}
          </span>
        </div>

        {/* 行 2：方向 + 幅度 + 信心 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <DirectionBadge direction={expectation.indexDirection} />
          {expectation.indexMagnitude && (
            <span className="text-[11px] text-secondary-text/80">
              {expectation.indexMagnitude === 'strong' ? '大幅' : expectation.indexMagnitude === 'moderate' ? '中幅' : '小幅'}
            </span>
          )}
          {expectation.overallConfidence != null && (
            <StarRow value={expectation.overallConfidence} />
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
                className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-muted/70 border border-border/40 text-secondary-text"
              >
                <span className={cn('font-medium', ACTION_COLOR[s.action])}>{ACTION_LABEL[s.action]}</span>
                <span>{s.code}</span>
              </span>
            ))}
            {stockCount > 3 && (
              <span className="text-[10.5px] text-secondary-text/60 self-center">
                +{stockCount - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
