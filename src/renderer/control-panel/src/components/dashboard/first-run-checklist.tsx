import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Download, Loader2, Rocket } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/hooks/use-app-store'

function StepIcon({ done, active }: { done: boolean; active?: boolean }) {
  if (done) {
    return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" aria-hidden="true" />
  }
  if (active) {
    return <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" aria-hidden="true" />
  }
  return <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
}

// Shown until the first Windrun scrape has completed. The bundled database ships with
// heroes/abilities only — synergy and winrate tables are empty until the user updates,
// which makes the overlay near-useless. This card makes that first step unmissable.
export function FirstRunChecklist() {
  const { t } = useTranslation('dashboard')
  const scraperStatus = useAppStore((s) => s.scraperStatus)
  const scraperLastUpdated = useAppStore((s) => s.scraperLastUpdated)
  const overlayActive = useAppStore((s) => s.overlayActive)

  if (scraperLastUpdated) return null

  const scraping = scraperStatus === 'running'

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-5 w-5" aria-hidden="true" />
          {t('firstRun.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <StepIcon done={false} active={scraping} />
          <div className="flex-1 space-y-2">
            <p className="text-sm">{t('firstRun.step1')}</p>
            <Button
              size="sm"
              disabled={scraping}
              onClick={() => window.electronApi.send('scraper:start')}
            >
              <Download className="h-4 w-4 mr-1" aria-hidden="true" />
              {scraping ? t('firstRun.updating') : t('firstRun.updateButton')}
            </Button>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <StepIcon done={overlayActive} />
          <p className="text-sm flex-1">{t('firstRun.step2')}</p>
        </div>
        <div className="flex items-start gap-3">
          <StepIcon done={false} />
          <p className="text-sm flex-1">{t('firstRun.step3')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
