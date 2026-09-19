// 心理快照子表单 — 重画版
import type { ResearchTime } from '../../types/expectations'
import { cn } from '../../utils/cn'

const DRIVERS = [
  { key: 'data', label: '数据推理' },
  { key: 'news', label: '消息面' },
  { key: 'gut', label: '市场感觉' },
  { key: 'follow', label: '跟随他人' },
  { key: 'impulse', label: '情绪冲动' },
]

const INTERFERENCE = [
  { key: 'loss_streak', label: '连续亏损' },
  { key: 'win_streak', label: '连续盈利（过度自信）' },
  { key: 'fomo', label: 'FOMO' },
  { key: 'time_pressure', label: '时间压力' },
  { key: 'capital_pressure', label: '资金压力' },
]

const RESEARCH_TIMES: { value: ResearchTime; label: string }[] = [
  { value: 'lt_30m', label: '< 30 分钟' },
  { value: '30_90m', label: '30–90 分钟' },
  { value: 'gt_90m', label: '> 90 分钟' },
]

const EMOTION_EMOJI = (v: number) =>
  v <= 2 ? '😨' : v <= 4 ? '😟' : v <= 6 ? '😐' : v <= 8 ? '😊' : '🤑'

const EMOTION_LABEL = (v: number) =>
  v <= 2 ? '极度恐惧' : v <= 4 ? '偏恐惧' : v <= 6 ? '中性' : v <= 8 ? '偏贪婪' : '极度贪婪'

const EMOTION_TRACK =
  'linear-gradient(to right, #60a5fa 0%, #34d399 40%, #fbbf24 65%, #f97316 82%, #ef4444 100%)'

interface Props {
  emotionIndex: number
  onEmotionChange: (v: number) => void
  decisionDrivers: string[]
  onDriversChange: (v: string[]) => void
  researchTime: ResearchTime | null
  onResearchTimeChange: (v: ResearchTime | null) => void
  interferenceFlags: string[]
  onInterferenceFlagsChange: (v: string[]) => void
}

function toggleItem(arr: string[], key: string): string[] {
  return arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key]
}

export function PsychSnapshotSection({
  emotionIndex,
  onEmotionChange,
  decisionDrivers,
  onDriversChange,
  researchTime,
  onResearchTimeChange,
  interferenceFlags,
  onInterferenceFlagsChange,
}: Props) {
  return (
    <div className="rounded-xl border border-[hsl(var(--primary))/20] bg-[hsl(var(--primary))/4] p-4 space-y-4">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px]">🧘</span>
        <span className="text-xs font-semibold text-foreground/80">录入前：了解此刻的自己</span>
        <span className="ml-auto text-[10.5px] text-secondary-text">约 60 秒</span>
      </div>

      {/* 情绪滑块 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-secondary-text">当前情绪状态</label>
          <span className="text-xs font-semibold text-foreground">
            {EMOTION_EMOJI(emotionIndex)} {EMOTION_LABEL(emotionIndex)}（{emotionIndex}/10）
          </span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={1}
            max={10}
            value={emotionIndex}
            onChange={(e) => onEmotionChange(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[hsl(var(--primary))]"
            style={{ background: EMOTION_TRACK }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-secondary-text/60">
          <span>极度恐惧</span>
          <span>中性</span>
          <span>极度贪婪</span>
        </div>
      </div>

      {/* 判断驱动 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-secondary-text">判断主要来自（可多选）</label>
        <div className="flex flex-wrap gap-1.5">
          {DRIVERS.map(({ key, label }) => {
            const on = decisionDrivers.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onDriversChange(toggleItem(decisionDrivers, key))}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-lg border transition-all',
                  on
                    ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/40] text-[hsl(var(--primary))] font-medium'
                    : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
                )}
              >
                {on && <span className="mr-1">✓</span>}
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 研究时间 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-secondary-text">今日研究时间</label>
        <div className="flex gap-1.5">
          {RESEARCH_TIMES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onResearchTimeChange(researchTime === value ? null : value)}
              className={cn(
                'flex-1 py-1.5 text-xs rounded-lg border transition-all',
                researchTime === value
                  ? 'bg-[hsl(var(--primary))/15] border-[hsl(var(--primary))/40] text-[hsl(var(--primary))] font-medium'
                  : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 干扰因素 */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-secondary-text">近期干扰因素（可多选）</label>
        <div className="flex flex-wrap gap-1.5">
          {INTERFERENCE.map(({ key, label }) => {
            const on = interferenceFlags.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onInterferenceFlagsChange(toggleItem(interferenceFlags, key))}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-lg border transition-all',
                  on
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 font-medium'
                    : 'border-border/50 text-secondary-text hover:border-border hover:bg-muted/40',
                )}
              >
                {on && <span className="mr-1">⚠</span>}
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
