import { lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/providers/theme-provider'
import { AppShell } from '@/components/layout/app-shell'
import { Sidebar } from '@/components/layout/sidebar'
import { HeaderBar } from '@/components/layout/header-bar'
import { UpdateNotificationBanner } from '@/components/update/update-notification-banner'
import { ErrorBoundary } from '@/components/error-boundary'
import { useNavigation } from '@/hooks/use-navigation'
import { DashboardPage } from '@/pages/dashboard-page'
import type { PageId } from '@/hooks/use-navigation'
import { useAppStore } from '@/hooks/use-app-store'
import i18n from '@/i18n'

const AbilitiesPage = lazy(() =>
  import('@/pages/abilities-page').then((m) => ({ default: m.AbilitiesPage })),
)
const HeroesPage = lazy(() =>
  import('@/pages/heroes-page').then((m) => ({ default: m.HeroesPage })),
)
const ScrapingPage = lazy(() =>
  import('@/pages/scraping-page').then((m) => ({ default: m.ScrapingPage })),
)
const StreamingPage = lazy(() =>
  import('@/pages/streaming-page').then((m) => ({ default: m.StreamingPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/settings-page').then((m) => ({ default: m.SettingsPage })),
)
const MapperPage = lazy(() =>
  import('@/pages/mapper-page').then((m) => ({ default: m.MapperPage })),
)
const DevMapperPage = lazy(() =>
  import('@/pages/dev-mapper-page').then((m) => ({ default: m.DevMapperPage })),
)

// @DEV-GUIDE: Root component for the control panel renderer. Uses a simple useState<PageId>
// routing system (no react-router). DashboardPage is eager-loaded for instant first paint;
// secondary pages load lazily inside Suspense. Each page is wrapped in ErrorBoundary.

export interface PageProps {
  onNavigate?: (page: PageId) => void
}

const pages: Record<PageId, React.ComponentType<PageProps>> = {
  dashboard: DashboardPage,
  abilities: AbilitiesPage,
  heroes: HeroesPage,
  scraping: ScrapingPage,
  streaming: StreamingPage,
  settings: SettingsPage,
  mapper: MapperPage,
  'dev-mapper': DevMapperPage,
}

function App(): React.ReactElement {
  const { t } = useTranslation()
  const { activePage, setActivePage } = useNavigation()
  const language = useAppStore((state) => state.language)
  const ActivePage = pages[activePage]

  useEffect(() => {
    if (language && language !== i18n.language) {
      void i18n.changeLanguage(language)
    }
  }, [language])

  return (
    <TooltipProvider>
      <ThemeProvider>
        <AppShell
          sidebar={<Sidebar activePage={activePage} onNavigate={setActivePage} />}
          header={<HeaderBar activePage={activePage} />}
          banner={<UpdateNotificationBanner />}
        >
          <ErrorBoundary key={activePage}>
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  {t('actions.loading')}
                </div>
              }
            >
              <ActivePage onNavigate={setActivePage} />
            </Suspense>
          </ErrorBoundary>
        </AppShell>
      </ThemeProvider>
    </TooltipProvider>
  )
}

export default App
