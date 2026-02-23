import { useTranslation } from 'react-i18next'
import { Sun, Moon, Monitor } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppStore } from '@/hooks/use-app-store'
import { useAppDispatch } from '@/hooks/use-dispatch'
import { APP_ACTIONS } from '@shared/types/app-store'

const THEME_OPTIONS = [
  { value: 'light' as const, icon: Sun },
  { value: 'dark' as const, icon: Moon },
  { value: 'system' as const, icon: Monitor },
]

export function AppearanceCard() {
  const { t, i18n } = useTranslation()
  const { t: ts } = useTranslation('settings')
  const themeMode = useAppStore((s) => s.themeMode)
  const language = useAppStore((s) => s.language)
  const dispatch = useAppDispatch()

  const handleThemeChange = (mode: 'light' | 'dark' | 'system') => {
    dispatch(APP_ACTIONS.THEME_SET_MODE, mode)
  }

  const handleLanguageChange = (lang: string) => {
    dispatch(APP_ACTIONS.LANGUAGE_SET, lang)
    i18n.changeLanguage(lang)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ts('appearance.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">{ts('appearance.themeLabel')}</label>
          <div className="flex gap-1">
            {THEME_OPTIONS.map(({ value, icon: Icon }) => (
              <Button
                key={value}
                variant={themeMode === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleThemeChange(value)}
                className="flex-1"
              >
                <Icon className="h-4 w-4 mr-1" />
                {t(`theme.${value}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{ts('appearance.languageLabel')}</label>
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t('language.en')}</SelectItem>
              <SelectItem value="ru">{t('language.ru')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
