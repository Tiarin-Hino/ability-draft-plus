import { useTranslation } from 'react-i18next'
import { Progress } from '@/components/ui/progress'

interface ProgressIndicatorProps {
  current: number
  total: number
  label?: string
}

export function ProgressIndicator({ current, total, label }: ProgressIndicatorProps) {
  const { t } = useTranslation('data')
  const percent = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label ?? t('mapper.anchor.progress', { current, total })}</span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  )
}
