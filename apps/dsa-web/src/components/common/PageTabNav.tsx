import { NavLink } from 'react-router-dom'
import { cn } from '../../utils/cn'

const TABS = [
  { label: '预期列表',  to: '/expectations',             exact: true  },
  { label: '录入预期',  to: '/expectations/new',         exact: false },
  { label: '详情复盘',  to: '/expectations/detail',      exact: false, disabled: true },
  { label: '成长仪表盘',to: '/growth',                   exact: true  },
  { label: '原则库',   to: '/growth/principles',         exact: false },
  { label: '交割单',   to: '/trades',                    exact: false },
]

interface Props {
  /** 当前详情页 id（在详情页时传入，用于高亮并保持链接） */
  detailId?: number | string
  /** 列表中最新一条预期的 id（在列表页传入，使标签可点击） */
  latestId?: number | string
}

export function PageTabNav({ detailId, latestId }: Props) {
  const targetId = detailId ?? latestId
  const tabs = TABS.map((t) =>
    t.label === '详情复盘' && targetId
      ? { ...t, to: `/expectations/${targetId}`, disabled: false }
      : t,
  )

  return (
    <div className="flex items-center gap-0.5 px-4 border-b border-border/50 bg-card shrink-0 overflow-x-auto">
      {tabs.map((tab) => {
        if (tab.disabled) {
          return (
            <span
              key={tab.label}
              className="px-3 py-2.5 text-xs font-medium text-secondary-text/40 whitespace-nowrap cursor-not-allowed select-none border-b-2 border-transparent"
            >
              {tab.label}
            </span>
          )
        }
        return (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.exact}
            className={({ isActive }) =>
              cn(
                'px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                isActive
                  ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))] font-semibold'
                  : 'border-transparent text-secondary-text hover:text-foreground hover:border-border/60',
              )
            }
          >
            {tab.label}
          </NavLink>
        )
      })}
    </div>
  )
}
