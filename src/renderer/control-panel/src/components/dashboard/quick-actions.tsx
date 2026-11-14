import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Brain, Download, RefreshCw, FileJson, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/hooks/use-app-store'
import { useSettings } from '@/hooks/use-settings'
import { AdCrestIcon } from '@/components/icons/ad-crest-icon'
import { BackgroundSessionControls } from '@/components/streaming/background-session-controls'

export function QuickActions() {
  const { t } = useTranslation('dashboard')
  const overlayActive = useAppStore((s) => s.overlayActive)
  const mlStatus = useAppStore((s) => s.mlStatus)
  const mlModelGaps = useAppStore((s) => s.mlModelGaps)
  const scraperStatus = useAppStore((s) => s.scraperStatus)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const updateVersion = useAppStore((s) => s.updateVersion)
  const { settings, updateSetting } = useSettings()
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gapsMessage, setGapsMessage] = useState<string | null>(null)

  // "You're up to date" only makes sense right after a check THIS user initiated
  const [checkRequested, setCheckRequested] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const scraping = scraperStatus === 'running'
  const checking = updateStatus === 'checking'
  const backgroundMode = settings?.overlayBackgroundMode ?? false

  useEffect(() => {
    if (!checkRequested) return
    if (updateStatus === 'idle') {
      setUpdateMessage(t('quickActions.upToDate'))
      setCheckRequested(false)
    } else if (updateStatus === 'available' || updateStatus === 'downloaded') {
      setUpdateMessage(t('quickActions.updateFound', { version: updateVersion ?? '' }))
      setCheckRequested(false)
    } else if (updateStatus === 'error') {
      setUpdateMessage(null) // the update banner shows the error itself
      setCheckRequested(false)
    }
  }, [checkRequested, updateStatus, updateVersion, t])

  const handleCheckUpdates = () => {
    setUpdateMessage(null)
    setCheckRequested(true)
    window.electronApi.send('app:checkUpdate')
  }

  const handleExportGaps = async () => {
    setGapsMessage(null)
    const result = await window.electronApi.invoke('ml:exportModelGaps')
    if (result.success) {
      setGapsMessage(
        t('quickActions.exportGapsSuccess', { count: result.count, path: result.path }),
      )
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
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AdCrestIcon className="h-5 w-5" />
            <CardTitle>{t('quickActions.title')}</CardTitle>
          </div>
          <Badge variant="outline" className="font-mono text-[11px]">
            {t('quickActions.hotkeyHint')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hero launch strip: primary CTA + inline background-capture mode toggle */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
          <Button
            size="default"
            className="gap-2 font-semibold shadow-sm"
            disabled={overlayActive || activating}
            onClick={handleActivateOverlay}
          >
            {activating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Monitor className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {activating
                ? t('quickActions.activating')
                : overlayActive
                  ? t('quickActions.overlayActive')
                  : t('quickActions.activateOverlay')}
            </span>
          </Button>

          <div className="flex items-center gap-3">
            <Switch
              id="quick-background-mode"
              checked={backgroundMode}
              onCheckedChange={(checked) => void updateSetting('overlayBackgroundMode', checked)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="quick-background-mode" className="text-xs font-medium cursor-pointer">
                {t('quickActions.backgroundModeToggle')}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {t('quickActions.backgroundModeHint')}
              </p>
            </div>
          </div>
        </div>

        {/* Secondary maintenance actions */}
        <div className="flex flex-wrap gap-2">
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
            disabled={scraping}
            onClick={() => window.electronApi.send('scraper:start')}
          >
            {scraping ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            {scraping ? t('quickActions.updatingData') : t('quickActions.updateData')}
          </Button>
          <Button variant="outline" size="sm" disabled={checking} onClick={handleCheckUpdates}>
            {checking ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            {checking ? t('quickActions.checking') : t('quickActions.checkUpdates')}
          </Button>
          {(mlModelGaps?.missingFromModel.length ?? 0) > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportGaps}>
              <FileJson className="h-4 w-4 mr-1" aria-hidden="true" />
              {t('quickActions.exportGaps', { count: mlModelGaps!.missingFromModel.length })}
            </Button>
          )}
        </div>

        {/* A background session's overlay is never shown: reset / end it here */}
        <BackgroundSessionControls />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {gapsMessage && <p className="text-sm text-muted-foreground">{gapsMessage}</p>}
        {updateMessage && <p className="text-sm text-muted-foreground">{updateMessage}</p>}
      </CardContent>
    </Card>
  )
}
