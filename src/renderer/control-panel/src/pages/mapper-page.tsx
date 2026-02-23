import { useTranslation } from 'react-i18next'
import { Map } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MapperWizard } from '@/components/mapper/mapper-wizard'
import type { PageProps } from '@/App'

export function MapperPage({ onNavigate }: PageProps) {
  const { t } = useTranslation('data')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Map className="h-5 w-5" />
            {t('mapper.title')}
          </CardTitle>
          <CardDescription>
            {t('mapper.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MapperWizard mode="user" onDone={() => onNavigate('settings')} />
        </CardContent>
      </Card>
    </div>
  )
}
