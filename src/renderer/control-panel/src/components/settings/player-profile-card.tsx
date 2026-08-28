import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PlayerProfileInfo } from '@shared/types'
import type { PlayerStatsRefreshInfo } from '@shared/ipc/api'

// @DEV-GUIDE: Settings card for the linked Windrun profile (personalized
// suggestions). Link flow: free-form input (windrun URL / steamID64 / steamID32)
// -> player:linkProfile validates against windrun.io, stores the id and fetches
// the first stats snapshot -> the card shows the confirmed nickname + avatar so
// the user can see they linked the RIGHT account. Errors arrive as i18n keys
// (settings namespace) and are translated here. Avatar loading needs the Steam
// CDN hosts in the control panel CSP's img-src (index.html).

export function PlayerProfileCard() {
  const { t } = useTranslation('settings')
  const [profile, setProfile] = useState<PlayerProfileInfo | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [needsScrape, setNeedsScrape] = useState(false)

  useEffect(() => {
    window.electronApi.invoke('player:getProfile').then(setProfile)
  }, [])

  // Fetched personal stats that match zero DB abilities = the local Windrun
  // data predates windrun_id; ability personalization needs one data update.
  const applyStatsResult = (stats: PlayerStatsRefreshInfo | undefined) => {
    setNeedsScrape(
      stats?.success === true &&
        (stats.abilityCount ?? 0) > 0 &&
        (stats.matchedAbilityCount ?? 0) === 0,
    )
  }

  const handleLink = async () => {
    if (input.trim() === '' || busy) return
    setBusy(true)
    setErrorKey(null)
    setStatusMessage(null)
    try {
      const result = await window.electronApi.invoke('player:linkProfile', {
        input,
      })
      if (result.success && result.profile) {
        setProfile(result.profile)
        setInput('')
        applyStatsResult(result.stats)
      } else {
        setErrorKey(result.errorKey ?? 'personalStats.errorFetchFailed')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRefresh = async () => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    setStatusMessage(null)
    try {
      const result = await window.electronApi.invoke('player:refreshStats')
      if (result.success) {
        setStatusMessage(
          t('personalStats.refreshSuccess', {
            abilities: result.abilityCount ?? 0,
            heroes: result.heroCount ?? 0,
          }),
        )
        applyStatsResult(result)
        const fresh = await window.electronApi.invoke('player:getProfile')
        setProfile(fresh)
      } else {
        setErrorKey(result.errorKey ?? 'personalStats.errorFetchFailed')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleUnlink = async () => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    setStatusMessage(null)
    try {
      await window.electronApi.invoke('player:unlinkProfile')
      setProfile(null)
      setNeedsScrape(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('personalStats.title')}</CardTitle>
        <CardDescription>{t('personalStats.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile === null ? (
          <>
            <div className="flex gap-2">
              <Input
                placeholder={t('personalStats.inputPlaceholder')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleLink()
                }}
                disabled={busy}
              />
              <Button onClick={handleLink} disabled={busy || input.trim() === ''}>
                {busy ? t('personalStats.linking') : t('personalStats.linkButton')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('personalStats.inputHint')}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {profile.avatarUrl && (
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="h-10 w-10 rounded-md"
                />
              )}
              <div>
                <p className="text-sm font-medium">
                  {profile.nickname ?? String(profile.playerId)}
                </p>
                <p className="text-xs text-muted-foreground">
                  ID {profile.playerId}
                  {profile.lastFetchedAt &&
                    ` · ${t('personalStats.lastUpdated', {
                      date: new Date(profile.lastFetchedAt).toLocaleString(),
                    })}`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRefresh} disabled={busy}>
                {t('personalStats.refreshButton')}
              </Button>
              <Button variant="outline" onClick={handleUnlink} disabled={busy}>
                {t('personalStats.unlinkButton')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('personalStats.blendNote')}
            </p>
          </>
        )}

        {needsScrape && (
          <p className="text-xs text-amber-500">{t('personalStats.scrapeHint')}</p>
        )}
        {errorKey && <p className="text-xs text-destructive">{t(errorKey)}</p>}
        {statusMessage && (
          <p className="text-xs text-muted-foreground">{statusMessage}</p>
        )}
      </CardContent>
    </Card>
  )
}
