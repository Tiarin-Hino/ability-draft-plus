import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KonvaCanvas } from './konva-canvas'
import { VerificationOverlay, STROKE_COLORS } from './verification-overlay'
import type { ResolutionLayout } from '@shared/types'
import type { WizardMode } from './mapper-wizard'

interface StepVerifyProps {
  mode: WizardMode
  imageBase64: string
  imageWidth: number
  imageHeight: number
  layout: ResolutionLayout
  onAccept: () => void
  onRedo: () => void
  onReportSubmitted: () => void
}

export function StepVerify({
  mode,
  imageBase64,
  imageWidth,
  imageHeight,
  layout,
  onAccept,
  onRedo,
  onReportSubmitted,
}: StepVerifyProps) {
  const { t } = useTranslation('data')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)

  const legendItems = [
    { label: t('mapper.verify.ultimates'), color: STROKE_COLORS.ultimates },
    { label: t('mapper.verify.standards'), color: STROKE_COLORS.standards },
    { label: t('mapper.verify.models'), color: STROKE_COLORS.models },
    { label: t('mapper.verify.heroes'), color: STROKE_COLORS.heroes },
    { label: t('mapper.verify.selected'), color: STROKE_COLORS.selected },
  ]

  const handleReportFailed = async () => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const result = await window.electronApi.invoke('resolution:submitScreenshot', {
        imageBase64,
        width: imageWidth,
        height: imageHeight,
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('mapper.verify.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('mapper.verify.description')}</p>
      </div>

      <div className="flex gap-4 text-xs">
        <span className="font-medium">{t('mapper.verify.legend')}:</span>
        {legendItems.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>

      <div className="border rounded-md overflow-hidden" style={{ height: 500 }}>
        <KonvaCanvas
          imageBase64={imageBase64}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          containerWidth={800}
          containerHeight={500}
        >
          <VerificationOverlay layout={layout} />
        </KonvaCanvas>
      </div>

      <div className="flex gap-2">
        <Button onClick={onAccept}>
          <Check className="h-4 w-4 mr-2" />
          {t('mapper.verify.accept')}
        </Button>
        <Button variant="outline" onClick={onRedo}>
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('mapper.verify.redo')}
        </Button>
        {mode === 'user' && (
          <Button
            variant="destructive"
            onClick={handleReportFailed}
            disabled={submitting}
          >
            <Send className="h-4 w-4 mr-2" />
            {submitting ? t('mapper.report.submitting') : t('mapper.report.button')}
          </Button>
        )}
      </div>

      {submitResult && (
        <p className={`text-xs ${submitResult.success ? 'text-green-600' : 'text-destructive'}`}>
          {submitResult.message}
        </p>
      )}

      <p className="text-xs text-muted-foreground">{t('mapper.common.zoomTip')}</p>
    </div>
  )
}
