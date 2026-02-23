import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Languages } from 'lucide-react'
import { useAppStore } from '@/hooks/use-app-store'
import { useAppDispatch } from '@/hooks/use-dispatch'
import { APP_ACTIONS } from '@shared/types/app-store'
import type { PageId } from '@/hooks/use-navigation'

const pageTitleKeys: Record<PageId, { ns: string; key: string }> = {
  dashboard: { ns: 'dashboard', key: 'title' },
  abilities: { ns: 'data', key: 'abilities.title' },
  heroes: { ns: 'data', key: 'heroes.title' },
  scraping: { ns: 'data', key: 'scraping.title' },
  settings: { ns: 'settings', key: 'title' },
  mapper: { ns: 'data', key: 'mapper.title' },
  'dev-mapper': { ns: 'data', key: 'mapper.devTitle' },
}

interface HeaderBarProps {
  activePage: PageId
}

export function HeaderBar({ activePage }: HeaderBarProps) {
  const { t, i18n } = useTranslation()
  const language = useAppStore((s) => s.language)
  const dispatch = useAppDispatch()

  const titleEntry = pageTitleKeys[activePage]
  const pageTitle = t(`${titleEntry.key}`, { ns: titleEntry.ns })

  const handleLanguageChange = (lang: 'en' | 'ru') => {
    dispatch(APP_ACTIONS.LANGUAGE_SET, lang)
    i18n.changeLanguage(lang)
    window.electronApi.invoke('settings:set', { language: lang })
  }

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <h1 className="text-lg font-semibold">{pageTitle}</h1>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2" aria-label={t('language.label')}>
            <Languages className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">{language === 'en' ? 'EN' : 'RU'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => handleLanguageChange('en')}
            className={language === 'en' ? 'bg-accent' : ''}
          >
            {t('language.en')} (EN)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleLanguageChange('ru')}
            className={language === 'ru' ? 'bg-accent' : ''}
          >
            {t('language.ru')} (RU)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
