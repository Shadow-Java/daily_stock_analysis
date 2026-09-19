import { Plus, Trash2 } from 'lucide-react'
import type { StockExpectationItem } from '../../types/expectations'
import { Button } from '../common/Button'

const ACTIONS = ['buy', 'sell', 'add', 'reduce', 'hold', 'watch'] as const
const ACTION_LABEL: Record<string, string> = {
  buy: '买入', sell: '卖出', add: '加仓', reduce: '减仓', hold: '持有', watch: '观望',
}
const DIRECTIONS = ['up', 'flat', 'down'] as const
const DIR_LABEL: Record<string, string> = { up: '涨', flat: '震荡', down: '跌' }

interface Props {
  value: StockExpectationItem[]
  onChange: (items: StockExpectationItem[]) => void
}

const EMPTY_ITEM: StockExpectationItem = {
  code: '', action: 'watch', direction: 'up', confidence: 3,
}

export function StockExpectationEditor({ value, onChange }: Props) {
  function update(index: number, patch: Partial<StockExpectationItem>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...value, { ...EMPTY_ITEM }])
  }

  return (
    <div className="space-y-3">
      {value.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-border/50 bg-card p-3 space-y-2"
        >
          <div className="flex gap-2 items-start">
            <input
              className="flex-1 min-w-0 h-8 rounded bg-background border border-border/60 px-2 text-sm text-foreground placeholder:text-secondary-text"
              placeholder="股票代码"
              value={item.code}
              onChange={(e) => update(i, { code: e.target.value })}
            />
            <input
              className="w-20 h-8 rounded bg-background border border-border/60 px-2 text-sm text-foreground placeholder:text-secondary-text"
              placeholder="名称"
              value={item.name ?? ''}
              onChange={(e) => update(i, { name: e.target.value || null })}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded text-secondary-text hover:text-danger"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="flex gap-1">
              {ACTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => update(i, { action: a })}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    item.action === a
                      ? 'bg-cyan/20 border-cyan/40 text-cyan'
                      : 'border-border/50 text-secondary-text hover:border-border'
                  }`}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>

            <div className="flex gap-1">
              {DIRECTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => update(i, { direction: d })}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    item.direction === d
                      ? 'bg-cyan/20 border-cyan/40 text-cyan'
                      : 'border-border/50 text-secondary-text hover:border-border'
                  }`}
                >
                  {DIR_LABEL[d]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-xs text-secondary-text">
              信心:
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => update(i, { confidence: n })}
                  className={`w-5 h-5 rounded text-xs border transition-colors ${
                    item.confidence >= n
                      ? 'bg-cyan/20 border-cyan/40 text-cyan'
                      : 'border-border/50 text-secondary-text'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <textarea
            className="w-full h-14 rounded bg-background border border-border/60 px-2 py-1.5 text-xs text-foreground placeholder:text-secondary-text resize-none"
            placeholder="理由（可选）"
            value={item.reasoning ?? ''}
            onChange={(e) => update(i, { reasoning: e.target.value || null })}
          />
        </div>
      ))}

      <Button variant="ghost" size="sm" onClick={add} type="button" className="w-full">
        <Plus className="w-4 h-4 mr-1" />
        添加个股预期
      </Button>
    </div>
  )
}
