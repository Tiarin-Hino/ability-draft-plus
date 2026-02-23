import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SystemDisplayInfo } from '@shared/types'

export function SystemInfoCard() {
  const { t } = useTranslation('dashboard')
  const [version, setVersion] = useState<string>('')
  const [systemInfo, setSystemInfo] = useState<SystemDisplayInfo | null>(null)

  useEffect(() => {
    window.electronApi.invoke('app:getVersion').then(setVersion)
    window.electronApi.invoke('app:getSystemInfo').then(setSystemInfo)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          {t('systemInfo.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('systemInfo.version')}</dt>
            <dd className="font-mono">{version}</dd>
          </div>
          {systemInfo && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('systemInfo.display')}</dt>
              <dd className="font-mono">
                {systemInfo.resolutionString} ({systemInfo.scaleFactor}x)
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}
