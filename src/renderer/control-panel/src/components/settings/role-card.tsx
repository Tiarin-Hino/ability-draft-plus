import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { AppSettings } from '@shared/types'

// @DEV-GUIDE: Settings card for role-aware suggestions (Position Templates).
// Three modes: Off (default — suggestions identical to the role-less path),
// Fixed (user multi-selects the positions they intend to play; also fits party
// stacks that pre-agree lanes), Dynamic (the app infers the vacant position(s)
// from teammates' drafted abilities each scan). Fixed positions persist across
// sessions (players main roles). The overlay carries its own quick control for
// mid-draft changes; this card is the durable setting.

type RoleMode = AppSettings['roleMode']

const POSITIONS = [1, 2, 3, 4, 5] as const
const MODES: RoleMode[] = ['off', 'fixed', 'dynamic']

export function RoleCard() {
  const { t } = useTranslation('settings')
  const [mode, setMode] = useState<RoleMode>('off')
  const [positions, setPositions] = useState<number[]>([])

  useEffect(() => {
    window.electronApi.invoke('settings:get').then((settings) => {
      setMode(settings.roleMode)
      setPositions(settings.roleFixedPositions)
    })
  }, [])

  const handleMode = (next: RoleMode) => {
    setMode(next)
    window.electronApi.invoke('settings:set', { roleMode: next })
  }

  const togglePosition = (pos: number) => {
    const next = positions.includes(pos)
      ? positions.filter((p) => p !== pos)
      : [...positions, pos].sort((a, b) => a - b)
    setPositions(next)
    window.electronApi.invoke('settings:set', { roleFixedPositions: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('roleSuggestions.title')}</CardTitle>
        <CardDescription>{t('roleSuggestions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {MODES.map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleMode(m)}
            >
              {t(`roleSuggestions.mode.${m}`)}
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {t(`roleSuggestions.hint.${mode}`)}
        </p>

        {mode === 'fixed' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              {POSITIONS.map((pos) => (
                <Button
                  key={pos}
                  variant={positions.includes(pos) ? 'default' : 'outline'}
                  size="sm"
                  className="w-10"
                  onClick={() => togglePosition(pos)}
                >
                  {pos}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {positions.length === 0
                ? t('roleSuggestions.noPositionsWarning')
                : t('roleSuggestions.positionsHint')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
