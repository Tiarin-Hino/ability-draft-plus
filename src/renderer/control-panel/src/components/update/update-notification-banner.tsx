import { useTranslation } from 'react-i18next'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAppStore } from '@/hooks/use-app-store'

export function UpdateNotificationBanner() {
  const { t } = useTranslation('update')
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const updateProgress = useAppStore((s) => s.updateProgress)
  const updateError = useAppStore((s) => s.updateError)

  if (updateStatus === 'idle' || updateStatus === 'checking') return null

  return (
    <div className="border-b bg-muted/50 px-4 py-2 flex items-center gap-3" role="alert">
      {updateStatus === 'available' && (
        <>
          <span className="text-sm flex-1">
            {t('available', { version: updateVersion })}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.electronApi.send('app:downloadUpdate')}
          >
            <Download className="h-4 w-4 mr-1" aria-hidden="true" />
            {t('downloadButton')}
          </Button>
        </>
      )}

      {updateStatus === 'downloading' && (
        <>
          <span className="text-sm">{t('downloading')}</span>
          <Progress value={updateProgress ?? 0} className="flex-1 h-2" />
          <span className="text-sm text-muted-foreground">
            {Math.round(updateProgress ?? 0)}%
          </span>
        </>
      )}

      {updateStatus === 'downloaded' && (
        <>
          <span className="text-sm flex-1">
            {t('readyToInstall', { version: updateVersion })}
          </span>
          <Button
            size="sm"
            onClick={() => window.electronApi.send('app:installUpdate')}
          >
            <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
            {t('installButton')}
          </Button>
        </>
      )}

      {updateStatus === 'error' && (
        <>
          <span className="text-sm text-destructive flex-1">
            {t('error', { error: updateError })}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.electronApi.send('app:checkUpdate')}
          >
            {t('retryButton')}
          </Button>
        </>
      )}
    </div>
  )
}
