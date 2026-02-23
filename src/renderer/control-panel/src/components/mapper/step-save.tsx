import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, ArrowLeft, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ResolutionLayout } from '@shared/types'

interface StepSaveProps {
  resolution: string
  layout: ResolutionLayout
  method: string
  onSaved: () => void
  onBack: () => void
}

export function StepSave({ resolution, layout, method, onSaved, onBack }: StepSaveProps) {
  const { t } = useTranslation('data')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await window.electronApi.invoke('resolution:save', {
        resolution,
        layout,
        method,
      })
      setResult(response.success ? 'success' : 'error')
      if (response.success) {
        setTimeout(onSaved, 1000)
      }
    } catch {
      setResult('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('mapper.save.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('mapper.save.description')}</p>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">{t('mapper.save.resolution')}: </span>
          <span>{resolution}</span>
        </div>
        <div>
          <span className="font-medium">{t('mapper.save.method')}: </span>
          <span>{method}</span>
        </div>
      </div>

      {result === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <Check className="h-4 w-4" />
          {t('mapper.save.success')}
        </div>
      )}

      {result === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <X className="h-4 w-4" />
          {t('mapper.save.error')}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || result === 'success'}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? t('mapper.save.saving') : t('mapper.save.saveButton')}
        </Button>
        <Button variant="outline" onClick={onBack} disabled={saving}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('mapper.save.back')}
        </Button>
      </div>
    </div>
  )
}
