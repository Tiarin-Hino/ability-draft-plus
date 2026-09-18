import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, Send, Unlink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/hooks/use-app-store'
import type { TwitchLinkInfo } from '@shared/types/twitch'

// @DEV-GUIDE: Twitch extension card (Streaming page). Pairing = paste the code shown
// on the extension's configuration page -> twitch:pair exchanges it with the EBS and
// stores the channel token in the main process (never in the AppStore). Live status
// (paired / broadcasting / last publish / error key) arrives through the zubridge
// AppStore from twitch-publisher-service; error keys are i18n keys in the 'streaming'
// namespace (twitch.*), translated here. The broadcast toggle goes through
// twitch:setBroadcastEnabled (not settings:set) so the publisher reacts at once.

function formatCode(raw: string): string {
  const clean = raw
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 8)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

export function TwitchCard() {
  const { t, i18n } = useTranslation('streaming')
  const paired = useAppStore((s) => s.twitchPaired)
  const channelName = useAppStore((s) => s.twitchChannelName)
  const enabled = useAppStore((s) => s.twitchBroadcastEnabled)
  const publishStatus = useAppStore((s) => s.twitchPublishStatus)
  const lastPublishAt = useAppStore((s) => s.twitchLastPublishAt)
  const errorKey = useAppStore((s) => s.twitchErrorKey)

  const [link, setLink] = useState<TwitchLinkInfo | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    window.electronApi.invoke('twitch:getStatus').then((status) => setLink(status.link))
  }, [paired])

  const handlePair = async () => {
    if (busy || code.replace(/-/g, '').length < 6) return
    setBusy(true)
    setPairError(null)
    try {
      const result = await window.electronApi.invoke('twitch:pair', { code })
      if (result.success && result.link) {
        setLink(result.link)
        setCode('')
      } else {
        setPairError(result.errorKey ?? 'twitch.errorNetwork')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleUnpair = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.electronApi.invoke('twitch:unpair')
      setLink(null)
      setTestMessage(null)
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = (checked: boolean) => {
    void window.electronApi.invoke('twitch:setBroadcastEnabled', { enabled: checked })
  }

  const handleTest = async () => {
    if (busy) return
    setBusy(true)
    setTestMessage(null)
    try {
      const result = await window.electronApi.invoke('twitch:republish')
      setTestMessage(
        result.success
          ? { text: t('twitch.testSent'), error: false }
          : { text: t(result.errorKey ?? 'twitch.errorPublishFailed'), error: true },
      )
    } finally {
      setBusy(false)
    }
  }

  const badgeKey = !paired
    ? 'unpaired'
    : publishStatus === 'error'
      ? 'error'
      : enabled
        ? 'broadcasting'
        : 'paired'
  const badgeVariant =
    badgeKey === 'error' ? 'destructive' : badgeKey === 'broadcasting' ? 'default' : 'secondary'

  const channelLabel = link
    ? link.channelName
      ? t('twitch.channel', { name: link.channelName })
      : t('twitch.channelUnknown', { id: link.channelId })
    : channelName
      ? t('twitch.channel', { name: channelName })
      : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('twitch.title')}</CardTitle>
          <Badge variant={badgeVariant}>{t(`twitch.status.${badgeKey}`)}</Badge>
        </div>
        <CardDescription>{t('twitch.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!paired ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>{t('twitch.step1')}</li>
              <li>{t('twitch.step2')}</li>
              <li>{t('twitch.step3')}</li>
            </ol>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="twitch-code">{t('twitch.codeLabel')}</Label>
                <Input
                  id="twitch-code"
                  className="w-36 font-mono uppercase"
                  placeholder={t('twitch.codePlaceholder')}
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setCode(formatCode(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handlePair()
                  }}
                  disabled={busy}
                />
              </div>
              <Button
                onClick={handlePair}
                disabled={busy || code.replace(/-/g, '').length < 6}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                )}
                {busy ? t('twitch.pairing') : t('twitch.pairButton')}
              </Button>
            </div>
            {pairError && (
              <p className="text-sm text-destructive" role="alert">
                {t(pairError)}
              </p>
            )}
          </>
        ) : (
          <>
            {channelLabel && <p className="text-sm">{channelLabel}</p>}

            <div className="flex items-center gap-2">
              <Switch id="twitch-broadcast" checked={enabled} onCheckedChange={handleToggle} />
              <Label htmlFor="twitch-broadcast">{t('twitch.enable')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('twitch.enableHint')}</p>

            {errorKey && (
              <p className="text-sm text-destructive" role="alert">
                {t(errorKey)}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {lastPublishAt
                ? t('twitch.lastPublish', {
                    time: new Date(lastPublishAt).toLocaleTimeString(i18n.language),
                  })
                : t('twitch.neverPublished')}
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={busy || !enabled}
                className="gap-2"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {t('twitch.testButton')}
              </Button>
              <Button variant="outline" onClick={handleUnpair} disabled={busy} className="gap-2">
                <Unlink className="h-4 w-4" aria-hidden="true" />
                {t('twitch.unpairButton')}
              </Button>
            </div>
            {testMessage && (
              <p
                className={
                  testMessage.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                }
                role={testMessage.error ? 'alert' : undefined}
              >
                {testMessage.text}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
