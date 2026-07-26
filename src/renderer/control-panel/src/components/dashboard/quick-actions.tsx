import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Brain, Download, RefreshCw, FileJson } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/hooks/use-app-store'

export function QuickActions() {
  const { t } = useTranslation('dashboard')
  const overlayActive = useAppStore((s) => s.overlayActive)
  const mlStatus = useAppStore((s) => s.mlStatus)
  const mlModelGaps = useAppStore((s) => s.mlModelGaps)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gapsMessage, setGapsMessage] = useState<string | null>(null)

  const handleExportGaps = async () => {
    setGapsMessage(null)
    const result = await window.electronApi.invoke('ml:exportModelGaps')
    if (result.success) {
      setGapsMessage(t('quickActions.exportGapsSuccess', { count: result.count, path: result.path }))
    } else if (result.error !== 'cancelled') {
      setGapsMessage(t('quickActions.exportGapsError', { error: result.error }))
    }
  }

  const handleActivateOverlay = async () => {
    setActivating(true)
    setError(null)
    try {
      const result = await window.electronApi.invoke('overlay:activate')
      if (!result.success) {
        setError(result.error ?? t('quickActions.activationError'))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setActivating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('quickActions.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={overlayActive || activating}
            onClick={handleActivateOverlay}
          >
            <Monitor className="h-4 w-4 mr-1" aria-hidden="true" />
            {activating ? t('quickActions.activating') : overlayActive ? t('quickActions.overlayActive') : t('quickActions.activateOverlay')}
          </Button>
          {mlStatus === 'error' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.electronApi.invoke('ml:init')}
            >
              <Brain className="h-4 w-4 mr-1" aria-hidden="true" />
              {t('quickActions.retryMl')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.electronApi.send('scraper:start')}
          >
            <Download className="h-4 w-4 mr-1" aria-hidden="true" />
            {t('quickActions.updateData')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.electronApi.send('app:checkUpdate')}
          >
            <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
            {t('quickActions.checkUpdates')}
          </Button>
          {(mlModelGaps?.missingFromModel.length ?? 0) > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportGaps}>
              <FileJson className="h-4 w-4 mr-1" aria-hidden="true" />
              {t('quickActions.exportGaps', { count: mlModelGaps!.missingFromModel.length })}
            </Button>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {gapsMessage && (
          <p className="text-sm text-muted-foreground">{gapsMessage}</p>
        )}
      </CardContent>
    </Card>
  )
}
