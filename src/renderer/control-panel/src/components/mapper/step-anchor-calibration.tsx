import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Undo, RotateCcw } from 'lucide-react'
import { Circle } from 'react-konva'
import { Button } from '@/components/ui/button'
import { KonvaCanvas } from './konva-canvas'
import { ProgressIndicator } from './progress-indicator'
import type { ResolutionLayout } from '@shared/types'
import type { CalibrationAnchors } from '@core/resolution/types'

interface StepAnchorCalibrationProps {
  imageBase64: string
  imageWidth: number
  imageHeight: number
  onComplete: (layout: ResolutionLayout) => void
  onBack: () => void
}

const ANCHOR_TOTAL = 4

const INSTRUCTIONS = [
  'mapper.anchor.instruction1',
  'mapper.anchor.instruction2',
  'mapper.anchor.instruction3',
  'mapper.anchor.instruction4',
]

export function StepAnchorCalibration({
  imageBase64,
  imageWidth,
  imageHeight,
  onComplete,
  onBack,
}: StepAnchorCalibrationProps) {
  const { t } = useTranslation('data')
  const [clicks, setClicks] = useState<Array<{ x: number; y: number }>>([])

  const handleClick = useCallback(
    async (x: number, y: number) => {
      const newClicks = [...clicks, { x, y }]
      setClicks(newClicks)

      if (newClicks.length === ANCHOR_TOTAL) {
        const resolution = `${imageWidth}x${imageHeight}`
        const anchors: CalibrationAnchors = {
          ultimateTopLeft: newClicks[0],
          ultimateBottomRight: newClicks[1],
          hero0TopLeft: newClicks[2],
          hero1TopLeft: newClicks[3],
        }

        const result = await window.electronApi.invoke('resolution:calibrate', {
          resolution,
          anchors,
        })

        onComplete(result.layout)
      }
    },
    [clicks, imageWidth, imageHeight, onComplete],
  )

  const handleUndo = () => {
    setClicks((prev) => prev.slice(0, -1))
  }

  const handleReset = () => {
    setClicks([])
  }

  const currentInstruction = clicks.length < ANCHOR_TOTAL
    ? t(INSTRUCTIONS[clicks.length])
    : ''

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('mapper.anchor.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('mapper.anchor.description')}</p>
      </div>

      <ProgressIndicator
        current={clicks.length}
        total={ANCHOR_TOTAL}
        label={t('mapper.anchor.progress', { current: clicks.length, total: ANCHOR_TOTAL })}
      />

      {currentInstruction && (
        <p className="text-sm font-medium text-blue-500">{currentInstruction}</p>
      )}

      <div className="border rounded-md overflow-hidden" style={{ height: 500 }}>
        <KonvaCanvas
          imageBase64={imageBase64}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          containerWidth={800}
          containerHeight={500}
          onImageClick={clicks.length < ANCHOR_TOTAL ? handleClick : undefined}
        >
          {clicks.map((click, i) => (
            <Circle
              key={i}
              x={click.x}
              y={click.y}
              radius={6}
              fill="rgba(255, 255, 0, 0.8)"
              stroke="#000"
              strokeWidth={1}
            />
          ))}
        </KonvaCanvas>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          {t('mapper.common.back')}
        </Button>
        <Button variant="outline" onClick={handleUndo} disabled={clicks.length === 0}>
          <Undo className="h-4 w-4 mr-2" />
          {t('mapper.anchor.undo')}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={clicks.length === 0}>
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('mapper.anchor.reset')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t('mapper.common.zoomTip')}</p>
    </div>
  )
}
