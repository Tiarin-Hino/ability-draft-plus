import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crosshair, Send, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ResolutionLayout } from '@shared/types'
import type { LayoutSource } from '@shared/ipc/api'
import type { WizardMode } from './mapper-wizard'

interface StepAutoDetectProps {
  mode: WizardMode
  screenshotWidth: number
  screenshotHeight: number
  imageBase64: string
  onUseLayout: (layout: ResolutionLayout, method: string) => void
  onCalibrate: () => void
  onReportSubmitted: () => void
}

export function StepAutoDetect({
  mode,
  screenshotWidth,
  screenshotHeight,
  imageBase64,
  onUseLayout,
  onCalibrate,
  onReportSubmitted,
}: StepAutoDetectProps) {
  const { t } = useTranslation('data')
  const resolution = useMemo(
    () => `${screenshotWidth}x${screenshotHeight}`,
    [screenshotWidth, screenshotHeight],
  )
  const [source, setSource] = useState<LayoutSource>('none')
  const [layout, setLayout] = useState<ResolutionLayout | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronApi
      .invoke('resolution:getLayout', { resolution })
      .then((result) => {
        if (cancelled) return
        setSource(result.source)
        setLayout(result.layout)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [resolution])

  const handleSubmitScreenshot = async () => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const result = await window.electronApi.invoke('resolution:submitScreenshot', {
        imageBase64,
        width: screenshotWidth,
        height: screenshotHeight,
      })
      setSubmitResult({
        success: result.success,
        message: result.success
          ? (result.message ?? t('mapper.report.success'))
          : (result.error ?? t('mapper.report.error', { error: 'Unknown error' })),
      })
      if (result.success) {
        setTimeout(() => onReportSubmitted(), 2000)
      }
    } catch (err) {
      setSubmitResult({
        success: false,
        message: t('mapper.report.error', { error: String(err) }),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const sourceLabel = {
    preset: t('mapper.autoDetect.sourcePreset'),
    'auto-scaled': t('mapper.autoDetect.sourceAutoScaled'),
    custom: t('mapper.autoDetect.sourceCustom'),
    none: t('mapper.autoDetect.sourceNone'),
  }[source]

  const sourceBadgeVariant = {
    preset: 'default' as const,
    'auto-scaled': 'secondary' as const,
    custom: 'outline' as const,
    none: 'destructive' as const,
  }[source]

  if (loading) {
    return <div className="text-sm text-muted-foreground">Detecting...</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('mapper.autoDetect.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('mapper.autoDetect.description')}</p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t('mapper.autoDetect.resolution')}:</span>
          <span>{resolution}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{t('mapper.autoDetect.source')}:</span>
          <Badge variant={sourceBadgeVariant}>{sourceLabel}</Badge>
        </div>
      </div>

      {source === 'auto-scaled' && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-yellow-700 dark:text-yellow-400">
              {t('mapper.autoDetect.autoScaleWarningTitle')}
            </p>
            <p className="text-muted-foreground">
              {t('mapper.autoDetect.autoScaleWarningDetail')}
            </p>
          </div>
        </div>
      )}

      {source === 'none' && mode === 'user' && (
        <p className="text-xs text-muted-foreground">{t('mapper.autoDetect.noLayoutHelp')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {layout && (source === 'preset' || source === 'custom') && (
          <Button onClick={() => onUseLayout(layout, source)}>
            <Check className="h-4 w-4 mr-2" />
            {t('mapper.autoDetect.done')}
          </Button>
        )}

        {layout && source === 'auto-scaled' && (
          <Button onClick={() => onUseLayout(layout, 'auto-scaled')}>
            <Check className="h-4 w-4 mr-2" />
            {t('mapper.autoDetect.useAutoScale')}
          </Button>
        )}

        {mode === 'dev' && (
          <Button variant="outline" onClick={onCalibrate}>
            <Crosshair className="h-4 w-4 mr-2" />
            {t('mapper.autoDetect.calibrate')}
          </Button>
        )}

        {source === 'none' && mode === 'user' && (
          <Button onClick={handleSubmitScreenshot} disabled={submitting}>
            <Send className="h-4 w-4 mr-2" />
            {submitting ? t('mapper.report.submitting') : t('mapper.autoDetect.submitScreenshot')}
          </Button>
        )}
      </div>

      {submitResult && (
        <p className={`text-xs ${submitResult.success ? 'text-green-600' : 'text-destructive'}`}>
          {submitResult.message}
        </p>
      )}
    </div>
  )
}
