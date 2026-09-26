import type { IndexDirection, StockDirection } from '../../types/expectations'
import { cn } from '../../utils/cn'

const ICON: Record<string, string> = { up: '▲', flat: '━', down: '▼' }

const LABEL: Record<string, string> = {
  up: '看涨', flat: '震荡', down: '看跌',
}

const STYLE: Record<string, string> = {
  up:   'bg-green-500/12 text-green-500 border-green-500/25',
  flat: 'bg-amber-500/12 text-amber-500 border-amber-500/25',
  down: 'bg-red-500/12 text-red-500 border-red-500/25',
}

export function DirectionBadge({
  direction,
  size = 'md',
  className,
}: {
  direction: IndexDirection | StockDirection
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border font-medium',
        size === 'sm'
          ? 'px-1.5 py-px text-[11px]'
          : 'px-2 py-0.5 text-xs',
        STYLE[direction],
        className,
      )}
    >
      <span className="text-[11px] leading-none">{ICON[direction]}</span>
      {LABEL[direction]}
    </span>
  )
}
