import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Swords,
  BarChart3,
  Download,
  Settings2,
  Map,
  Wrench,
  Sun,
  Moon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppStore } from '@/hooks/use-app-store'
import { useAppDispatch } from '@/hooks/use-dispatch'
import { APP_ACTIONS } from '@shared/types/app-store'
import type { PageId } from '@/hooks/use-navigation'

const navItems: Array<{
  id: PageId
  icon: React.ComponentType<{ className?: string }>
  labelKey: string
  devOnly?: boolean
}> = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { id: 'abilities', icon: Swords, labelKey: 'nav.abilities' },
  { id: 'heroes', icon: BarChart3, labelKey: 'nav.heroes' },
  { id: 'scraping', icon: Download, labelKey: 'nav.scraping' },
  { id: 'settings', icon: Settings2, labelKey: 'nav.settings' },
  { id: 'mapper', icon: Map, labelKey: 'nav.mapper' },
  { id: 'dev-mapper', icon: Wrench, labelKey: 'nav.devMapper', devOnly: true },
]

interface SidebarProps {
  activePage: PageId
  onNavigate: (page: PageId) => void
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  const [version, setVersion] = useState('')
  const [isPackaged, setIsPackaged] = useState(true) // Default to packaged (hide dev items)
  const resolvedDarkMode = useAppStore((s) => s.resolvedDarkMode)
  const themeMode = useAppStore((s) => s.themeMode)
  const dispatch = useAppDispatch()

  useEffect(() => {
    window.electronApi.invoke('app:getVersion').then(setVersion)
    window.electronApi.invoke('app:isPackaged').then(setIsPackaged)
  }, [])

  const cycleTheme = () => {
    const modes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const currentIndex = modes.indexOf(themeMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    dispatch(APP_ACTIONS.THEME_SET_MODE, nextMode)
    window.electronApi.invoke('settings:set', { themeMode: nextMode })
  }

  return (
    <aside className="flex h-full w-52 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4">
        <Swords className="h-5 w-5 text-brand-purple" aria-hidden="true" />
        <span className="text-sm font-semibold">{t('appTitle')}</span>
      </div>

      <Separator />

      <nav aria-label={t('nav.sidebar')} className="flex-1 space-y-1 px-2 py-2">
        {navItems.map((item) => {
          if (item.devOnly && isPackaged) return null
          const Icon = item.icon
          const isActive = activePage === item.id
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="md:hidden">
                {t(item.labelKey)}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      <Separator />

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs text-muted-foreground">
          v{version}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={cycleTheme}
          aria-label={t(`theme.${themeMode}`)}
        >
          {resolvedDarkMode ? (
            <Moon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Sun className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </aside>
  )
}
