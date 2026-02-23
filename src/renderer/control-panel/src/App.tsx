import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/providers/theme-provider'
import { AppShell } from '@/components/layout/app-shell'
import { Sidebar } from '@/components/layout/sidebar'
import { HeaderBar } from '@/components/layout/header-bar'
import { UpdateNotificationBanner } from '@/components/update/update-notification-banner'
import { ErrorBoundary } from '@/components/error-boundary'
import { useNavigation } from '@/hooks/use-navigation'
import { DashboardPage } from '@/pages/dashboard-page'
import { AbilitiesPage } from '@/pages/abilities-page'
import { HeroesPage } from '@/pages/heroes-page'
import { ScrapingPage } from '@/pages/scraping-page'
import { SettingsPage } from '@/pages/settings-page'
import { MapperPage } from '@/pages/mapper-page'
import { DevMapperPage } from '@/pages/dev-mapper-page'
import type { PageId } from '@/hooks/use-navigation'

// @DEV-GUIDE: Root component for the control panel renderer. Uses a simple useState<PageId>
// routing system (no react-router). The `pages` object maps PageId strings to React components.
// Navigation is handled by the Sidebar component calling onNavigate().
//
// Component tree: TooltipProvider -> ThemeProvider -> AppShell (sidebar + header + content).
// Each page is wrapped in ErrorBoundary with key={activePage} to reset state on navigation.
// PageProps.onNavigate allows cross-page navigation (e.g., dashboard quick action -> settings).

export interface PageProps {
  onNavigate?: (page: PageId) => void
}

const pages: Record<PageId, React.ComponentType<PageProps>> = {
  dashboard: DashboardPage,
  abilities: AbilitiesPage,
  heroes: HeroesPage,
  scraping: ScrapingPage,
  settings: SettingsPage,
  mapper: MapperPage,
  'dev-mapper': DevMapperPage,
}

function App(): React.ReactElement {
  const { activePage, setActivePage } = useNavigation()
  const ActivePage = pages[activePage]

  return (
    <TooltipProvider>
      <ThemeProvider>
        <AppShell
          sidebar={
            <Sidebar activePage={activePage} onNavigate={setActivePage} />
          }
          header={<HeaderBar activePage={activePage} />}
          banner={<UpdateNotificationBanner />}
        >
          <ErrorBoundary key={activePage}>
            <ActivePage onNavigate={setActivePage} />
          </ErrorBoundary>
        </AppShell>
      </ThemeProvider>
    </TooltipProvider>
  )
}

export default App
