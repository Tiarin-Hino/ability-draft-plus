import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, AlertCircle, CheckCircle2, Loader2, BookOpen, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/hooks/use-app-store'

export function ScrapingPage() {
  const { t } = useTranslation('data')
  const scraperStatus = useAppStore((s) => s.scraperStatus)
  const scraperMessage = useAppStore((s) => s.scraperMessage)
  const scraperLastUpdated = useAppStore((s) => s.scraperLastUpdated)
  const liquipediaStatus = useAppStore((s) => s.liquipediaStatus)
  const liquipediaMessage = useAppStore((s) => s.liquipediaMessage)
  const liquipediaLastUpdated = useAppStore((s) => s.liquipediaLastUpdated)

  const [isDevMode, setIsDevMode] = useState(false)

  useEffect(() => {
    window.electronApi.invoke('app:isPackaged').then((packaged) => {
      setIsDevMode(!packaged)
    })
  }, [])

  const isWindrunRunning = scraperStatus === 'running'
  const isWindrunError = scraperStatus === 'error'
  const isLiquipediaRunning = liquipediaStatus === 'running'
  const isLiquipediaError = liquipediaStatus === 'error'

  return (
    <div className="space-y-6">
      {/* Windrun Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('scraping.title')}
          </CardTitle>
          <CardDescription>
            {t('scraping.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => window.electronApi.send('scraper:start')}
            disabled={isWindrunRunning}
            size="sm"
          >
            {isWindrunRunning ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            {isWindrunRunning ? t('scraping.running') : t('scraping.updateButton')}
          </Button>

          {scraperMessage && (
            <div className={`flex items-start gap-2 text-sm ${isWindrunError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {isWindrunError ? (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              ) : isWindrunRunning ? (
                <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <p>{scraperMessage}</p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {t('scraping.lastUpdated')}{' '}
            {scraperLastUpdated
              ? new Date(scraperLastUpdated).toLocaleString()
              : t('scraping.never')}
          </p>
        </CardContent>
      </Card>

      {/* Liquipedia Enrichment Card (dev mode only) */}
      {isDevMode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {t('scraping.liquipedia.title')}
            </CardTitle>
            <CardDescription>
              {t('scraping.liquipedia.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{t('scraping.liquipedia.warning')}</p>
            </div>

            <Button
              onClick={() => window.electronApi.send('scraper:startLiquipedia')}
              disabled={isLiquipediaRunning}
              size="sm"
              variant="outline"
            >
              {isLiquipediaRunning ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4 mr-1" />
              )}
              {isLiquipediaRunning ? t('scraping.liquipedia.running') : t('scraping.liquipedia.updateButton')}
            </Button>

            {liquipediaMessage && (
              <div className={`flex items-start gap-2 text-sm ${isLiquipediaError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {isLiquipediaError ? (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : isLiquipediaRunning ? (
                  <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <p>{liquipediaMessage}</p>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {t('scraping.liquipedia.lastUpdated')}{' '}
              {liquipediaLastUpdated
                ? new Date(liquipediaLastUpdated).toLocaleString()
                : t('scraping.never')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
