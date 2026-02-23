import { useTranslation } from 'react-i18next'
import { Brain, Monitor, Database, Calendar } from 'lucide-react'
import { StatusCard } from '@/components/dashboard/status-card'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { SystemInfoCard } from '@/components/dashboard/system-info-card'
import { useAppStore } from '@/hooks/use-app-store'

type StatusColor = 'green' | 'yellow' | 'red' | 'gray'

function mlStatusColor(status: string): StatusColor {
  switch (status) {
    case 'ready':
      return 'green'
    case 'initializing':
    case 'scanning':
      return 'yellow'
    case 'error':
      return 'red'
    default:
      return 'gray'
  }
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { t: tc } = useTranslation()

  const mlStatus = useAppStore((s) => s.mlStatus)
  const mlModelGaps = useAppStore((s) => s.mlModelGaps)
  const overlayActive = useAppStore((s) => s.overlayActive)
  const activeResolution = useAppStore((s) => s.activeResolution)
  const scraperLastUpdated = useAppStore((s) => s.scraperLastUpdated)

  const overlayValue = overlayActive && activeResolution
    ? `${tc('status.active')} · ${activeResolution}`
    : overlayActive
      ? tc('status.active')
      : tc('status.idle')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          icon={Brain}
          label={t('statusCards.mlWorker')}
          value={tc(`status.${mlStatus}`)}
          color={mlStatusColor(mlStatus)}
          badge={
            mlModelGaps?.missingFromModel.length
              ? t('statusCards.mlGapsBadge', { count: mlModelGaps.missingFromModel.length })
              : undefined
          }
        />
        <StatusCard
          icon={Monitor}
          label={t('statusCards.overlay')}
          value={overlayValue}
          color={overlayActive ? 'green' : 'gray'}
        />
        <StatusCard
          icon={Database}
          label={t('statusCards.database')}
          value={tc('status.connected')}
          color="green"
        />
        <StatusCard
          icon={Calendar}
          label={t('statusCards.dataFreshness')}
          value={
            scraperLastUpdated
              ? new Date(scraperLastUpdated).toLocaleDateString()
              : t('statusCards.neverUpdated')
          }
          color={scraperLastUpdated ? 'green' : 'yellow'}
        />
      </div>

      <QuickActions />
      <SystemInfoCard />
    </div>
  )
}
