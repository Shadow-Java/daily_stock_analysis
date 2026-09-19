import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Target } from 'lucide-react'
import { expectationsApi } from '../api/expectations'
import type { ExpectationCreateRequest } from '../types/expectations'
import { ExpectationForm } from '../components/expectations/ExpectationForm'
import { PageTabNav } from '../components/common/PageTabNav'

export default function ExpectationNewPage() {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(payload: ExpectationCreateRequest) {
    setIsSubmitting(true)
    try {
      await expectationsApi.create(payload)
      navigate('/expectations')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageTabNav />
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/50 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/expectations')}
          className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回列表
        </button>
        <div className="w-px h-4 bg-border/50" />
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h1 className="text-sm font-semibold text-foreground">录入今日预期</h1>
        </div>
      </div>

      {/* 表单区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-5">
          <ExpectationForm
            onSubmit={(p) => handleSubmit(p as ExpectationCreateRequest)}
            isSubmitting={isSubmitting}
            onCancel={() => navigate('/expectations')}
          />
        </div>
      </div>
    </div>
  )
}
