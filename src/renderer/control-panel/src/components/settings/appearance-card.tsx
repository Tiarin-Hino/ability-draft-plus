import { useTranslation } from 'react-i18next'
import { Sun, Moon, Monitor, PanelRight, PanelLeft } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
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
  const overlayOpacity = useAppStore((s) => s.overlayOpacity)
  const overlayAnchor = useAppStore((s) => s.overlayAnchor)
  const dispatch = useAppDispatch()

  const handleThemeChange = (mode: 'light' | 'dark' | 'system') => {
    dispatch(APP_ACTIONS.THEME_SET_MODE, mode)
  }

  const handleLanguageChange = (lang: string) => {
    dispatch(APP_ACTIONS.LANGUAGE_SET, lang)
    i18n.changeLanguage(lang)
  }

  const handleOpacityChange = (vals: number[]) => {
    dispatch(APP_ACTIONS.OVERLAY_SET_APPEARANCE, { opacity: vals[0] / 100 })
  }

  const handleAnchorChange = (anchor: 'left' | 'right') => {
    dispatch(APP_ACTIONS.OVERLAY_SET_APPEARANCE, { anchor })
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

        <div className="space-y-2">
          <label className="text-sm font-medium">
            {ts('appearance.overlayOpacityLabel')} ({Math.round(overlayOpacity * 100)}%)
          </label>
          <Slider
            value={[Math.round(overlayOpacity * 100)]}
            onValueChange={handleOpacityChange}
            min={60}
            max={100}
            step={5}
            className="w-64"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{ts('appearance.overlayAnchorLabel')}</label>
          <div className="flex gap-1 w-64">
            <Button
              variant={overlayAnchor === 'left' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => handleAnchorChange('left')}
            >
              <PanelLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              {ts('appearance.anchorLeft')}
            </Button>
            <Button
              variant={overlayAnchor === 'right' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => handleAnchorChange('right')}
            >
              <PanelRight className="h-4 w-4 mr-1" aria-hidden="true" />
              {ts('appearance.anchorRight')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
