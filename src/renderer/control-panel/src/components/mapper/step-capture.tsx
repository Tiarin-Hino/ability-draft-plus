import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, RotateCcw, ArrowRight, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WizardMode } from './mapper-wizard'

interface StepCaptureProps {
  mode: WizardMode
  imageBase64: string | null
  imageWidth: number
  imageHeight: number
  onCapture: (imageBase64: string, width: number, height: number) => void
  onNext: () => void
}

export function StepCapture({
  mode,
  imageBase64,
  imageWidth,
  imageHeight,
  onCapture,
  onNext,
}: StepCaptureProps) {
  const { t } = useTranslation('data')
  const [capturing, setCapturing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCapture = async () => {
    setCapturing(true)
    try {
      const result = await window.electronApi.invoke('resolution:captureScreenshot')
      onCapture(result.imageBase64, result.width, result.height)
    } finally {
      setCapturing(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // Extract base64 data (remove "data:image/...;base64," prefix)
      const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '')

      // Get image dimensions
      const img = new Image()
      img.onload = () => {
        onCapture(base64, img.naturalWidth, img.naturalHeight)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)

    // Reset file input so same file can be re-selected
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('mapper.capture.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('mapper.capture.description')}</p>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleCapture} disabled={capturing}>
          {capturing ? (
            <>
              <Camera className="h-4 w-4 mr-2 animate-pulse" />
              {t('mapper.capture.capturing')}
            </>
          ) : imageBase64 ? (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('mapper.capture.retake')}
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 mr-2" />
              {t('mapper.capture.captureButton')}
            </>
          )}
        </Button>

        {mode === 'dev' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              {t('mapper.capture.uploadButton')}
            </Button>
          </>
        )}

        {imageBase64 && (
          <Button variant="outline" onClick={onNext}>
            <ArrowRight className="h-4 w-4 mr-2" />
            {t('mapper.capture.next')}
          </Button>
        )}
      </div>

      {imageBase64 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {imageWidth}x{imageHeight}
          </p>
          <div className="rounded-md border overflow-hidden">
            <img
              src={`data:image/png;base64,${imageBase64}`}
              alt="Screenshot preview"
              className="w-full h-auto"
            />
          </div>
        </div>
      )}
    </div>
  )
}
