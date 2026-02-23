import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { AppSettings } from '@shared/types'

interface ThresholdCardProps {
  settingsKey: 'opThreshold' | 'trapThreshold'
  currentValue: number | null
  defaultValue: number
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}

export function ThresholdCard({
  settingsKey,
  currentValue,
  defaultValue,
  onSave,
}: ThresholdCardProps) {
  const { t } = useTranslation('settings')
  const ns = settingsKey === 'opThreshold' ? 'opThreshold' : 'trapThreshold'

  // Local edit value, only used when dirty
  const [localValue, setLocalValue] = useState<number | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const dirty = localValue !== null
  // When clean, show the prop value; when dirty, show local edits
  const value = dirty ? localValue : (currentValue ?? defaultValue)

  const handleSliderChange = (vals: number[]) => {
    setLocalValue(vals[0] / 100)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value)
    if (!isNaN(parsed)) {
      setLocalValue(Math.min(30, Math.max(0, parsed)) / 100)
    }
  }

  const handleSave = async () => {
    await onSave(settingsKey, value)
    setLocalValue(null)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 1500)
  }

  const displayPercent = Math.round(value * 10000) / 100

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`${ns}.title`)}</CardTitle>
        <CardDescription>{t(`${ns}.helpText`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t(`${ns}.label`)}</label>
          <div className="flex items-center gap-4">
            <Slider
              value={[displayPercent]}
              onValueChange={handleSliderChange}
              min={0}
              max={30}
              step={0.01}
              className="flex-1"
            />
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={displayPercent.toFixed(2)}
                onChange={handleInputChange}
                className="w-20 text-right"
                min={0}
                max={30}
                step={0.01}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={!dirty} size="sm">
          {saveSuccess ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              {t(`${ns}.savedMessage`)}
            </>
          ) : (
            t(`${ns}.saveButton`)
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
