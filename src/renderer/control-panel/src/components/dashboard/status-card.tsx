import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StatusColor = 'green' | 'yellow' | 'red' | 'gray'

interface StatusCardProps {
  icon: LucideIcon
  label: string
  value: string
  color: StatusColor
  badge?: string
}

const colorMap: Record<StatusColor, string> = {
  green: 'text-green-500',
  yellow: 'text-yellow-500',
  red: 'text-red-500',
  gray: 'text-muted-foreground',
}

const dotMap: Record<StatusColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  gray: 'bg-muted-foreground',
}

export function StatusCard({ icon: Icon, label, value, color, badge }: StatusCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{label}</p>
            {badge && (
              <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full shrink-0', dotMap[color])} aria-hidden="true" />
            <p className={cn('text-sm truncate', colorMap[color])}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
