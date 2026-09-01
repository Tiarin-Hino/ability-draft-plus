import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { GsiSetupControls, GsiConnectionBadge } from '@/components/streaming/gsi-card'
import { AUTO_INITIAL_SCAN_DELAY_S } from '@shared/constants/thresholds'

// @DEV-GUIDE: Settings card for GSI-driven automatic draft tracking (the same
// experimentalAutoDraftTracking setting the auto-rescan service gates on). Bundles:
// - the enable toggle,
// - the auto-initial-scan delay (autoInitialScanDelayS, clamped 5-60s — slow PCs
//   need the draft screen fully rendered before the first scan),
// - the GSI disclosure note (the app is advertised as not communicating with the
//   game client; GSI is a local, one-way game->app feed and MUST be called out), and
// - the embedded GSI setup controls (same component as the Streaming page).
// When the toggle is on, the overlay hides its manual My Spot / My Model buttons
// (OverlayDataPayload.autoDraftTrackingEnabled) — noted here so users know why.

const DELAY_MIN_S = 5
const DELAY_MAX_S = 60

export function AutoTrackingCard() {
  const { t } = useTranslation('settings')
  const [enabled, setEnabled] = useState(false)
  const [autoClose, setAutoClose] = useState(true)
  const [delayInput, setDelayInput] = useState(String(AUTO_INITIAL_SCAN_DELAY_S))

  useEffect(() => {
    window.electronApi.invoke('settings:get').then((settings) => {
      setEnabled(settings.experimentalAutoDraftTracking)
      setAutoClose(settings.overlayAutoCloseEnabled)
      setDelayInput(String(settings.autoInitialScanDelayS))
    })
  }, [])

  const handleToggle = (checked: boolean) => {
    setEnabled(checked)
    window.electronApi.invoke('settings:set', {
      experimentalAutoDraftTracking: checked,
    })
  }

  const handleAutoCloseToggle = (checked: boolean) => {
    setAutoClose(checked)
    window.electronApi.invoke('settings:set', { overlayAutoCloseEnabled: checked })
  }

  const handleDelayBlur = () => {
    const parsed = parseInt(delayInput, 10)
    const clamped = Number.isFinite(parsed)
      ? Math.min(DELAY_MAX_S, Math.max(DELAY_MIN_S, parsed))
      : AUTO_INITIAL_SCAN_DELAY_S
    setDelayInput(String(clamped))
    window.electronApi.invoke('settings:set', { autoInitialScanDelayS: clamped })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('autoTracking.title')}</CardTitle>
          <GsiConnectionBadge />
        </div>
        <CardDescription>{t('autoTracking.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            id="auto-draft-tracking"
            checked={enabled}
            onCheckedChange={handleToggle}
          />
          <Label htmlFor="auto-draft-tracking">{t('autoTracking.toggle')}</Label>
        </div>

        <p className="text-xs text-muted-foreground">{t('autoTracking.gsiNote')}</p>

        {enabled && (
          <>
            <div className="space-y-1">
              <Label htmlFor="auto-scan-delay">{t('autoTracking.delayLabel')}</Label>
              <Input
                id="auto-scan-delay"
                className="w-24"
                inputMode="numeric"
                value={delayInput}
                onChange={(e) => setDelayInput(e.target.value.replace(/\D/g, ''))}
                onBlur={handleDelayBlur}
              />
              <p className="text-xs text-muted-foreground">
                {t('autoTracking.delayHint', { min: DELAY_MIN_S, max: DELAY_MAX_S })}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('autoTracking.buttonsNote')}
            </p>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="overlay-auto-close"
                  checked={autoClose}
                  onCheckedChange={handleAutoCloseToggle}
                />
                <Label htmlFor="overlay-auto-close">
                  {t('autoTracking.autoCloseToggle')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('autoTracking.autoCloseHint')}
              </p>
            </div>

            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">{t('autoTracking.setupTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('autoTracking.setupHint')}
              </p>
              <GsiSetupControls />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
