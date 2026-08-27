import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Play, Square, ImageDown, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/hooks/use-app-store'
import { GsiCard } from '@/components/streaming/gsi-card'
import { DEFAULT_STREAM_PORT } from '@shared/constants/thresholds'

// @DEV-GUIDE: Streaming page — controls the local stream-board server (see
// src/main/services/stream-server-service.ts). Server status/port/client count arrive
// via the zubridge AppStore; start/stop go over stream:* invoke channels; the port and
// autostart flag persist through the regular settings channels. streamServerError holds
// an i18n key in the 'streaming' namespace, translated here (FeedbackStatus pattern).

function IconPrefetchCard() {
  const { t } = useTranslation('streaming')
  const [prefetching, setPrefetching] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handlePrefetch = async () => {
    setPrefetching(true)
    setResult(null)
    try {
      const summary = await window.electronApi.invoke('stream:prefetchIcons')
      setResult(
        summary.success
          ? t('icons.result', {
              fetched: summary.fetched ?? 0,
              alreadyCached: summary.alreadyCached ?? 0,
              failed: summary.failed ?? 0,
            })
          : t('icons.error'),
      )
    } finally {
      setPrefetching(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('icons.title')}</CardTitle>
        <CardDescription>{t('icons.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant="outline"
          onClick={handlePrefetch}
          disabled={prefetching}
          className="gap-2"
        >
          {prefetching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('icons.prefetching')}
            </>
          ) : (
            <>
              <ImageDown className="h-4 w-4" aria-hidden="true" />
              {t('icons.prefetch')}
            </>
          )}
        </Button>
        {result && <p className="text-xs text-muted-foreground">{result}</p>}
      </CardContent>
    </Card>
  )
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const { t } = useTranslation('streaming')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="rounded bg-muted px-2 py-1 text-sm">{url}</code>
        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1">
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('server.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {t('server.copy')}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

export function StreamingPage() {
  const { t } = useTranslation('streaming')
  const status = useAppStore((s) => s.streamServerStatus)
  const storePort = useAppStore((s) => s.streamServerPort)
  const errorKey = useAppStore((s) => s.streamServerError)
  const clientCount = useAppStore((s) => s.streamClientCount)

  const [portInput, setPortInput] = useState(String(DEFAULT_STREAM_PORT))
  const [autostart, setAutostart] = useState(false)
  const [busy, setBusy] = useState(false)

  const running = status === 'running'
  const effectivePort = running && storePort !== null ? storePort : parseInt(portInput, 10)
  const serverOrigin = `http://localhost:${Number.isFinite(effectivePort) ? effectivePort : DEFAULT_STREAM_PORT}`
  const boardUrl = `${serverOrigin}/stream`
  const picksUrl = `${serverOrigin}/picks`

  useEffect(() => {
    window.electronApi.invoke('settings:get').then((settings) => {
      setPortInput(String(settings.streamPort))
      setAutostart(settings.streamAutostart)
    })
  }, [])

  const handleToggle = async () => {
    setBusy(true)
    try {
      if (running) {
        await window.electronApi.invoke('stream:stop')
      } else {
        await window.electronApi.invoke('stream:start', {
          port: parseInt(portInput, 10),
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAutostart = (checked: boolean) => {
    setAutostart(checked)
    window.electronApi.invoke('settings:set', { streamAutostart: checked })
  }

  const statusVariant =
    status === 'running' ? 'default' : status === 'error' ? 'destructive' : 'secondary'

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('server.title')}</CardTitle>
            <Badge variant={statusVariant}>{t(`server.status.${status}`)}</Badge>
          </div>
          <CardDescription>{t('server.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorKey && (
            <p className="text-sm text-destructive" role="alert">
              {t(errorKey)}
            </p>
          )}

          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="stream-port">{t('server.port')}</Label>
              <Input
                id="stream-port"
                className="w-28"
                inputMode="numeric"
                value={portInput}
                disabled={running || busy}
                onChange={(e) => setPortInput(e.target.value.replace(/\D/g, ''))}
                onBlur={() => {
                  const port = parseInt(portInput, 10)
                  if (Number.isFinite(port) && port >= 1024 && port <= 65535) {
                    window.electronApi.invoke('settings:set', { streamPort: port })
                  }
                }}
              />
            </div>
            <Button onClick={handleToggle} disabled={busy} className="gap-2">
              {running ? (
                <>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  {t('server.stop')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {t('server.start')}
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('server.portHint')}</p>

          {running && (
            <div className="space-y-3">
              <UrlRow label={t('server.url')} url={boardUrl} />
              <UrlRow label={t('server.picksUrl')} url={picksUrl} />
              <p className="text-xs text-muted-foreground">{t('server.picksHint')}</p>
              <p className="text-xs text-muted-foreground">
                {t('server.clients', { count: clientCount })}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Switch
              id="stream-autostart"
              checked={autostart}
              onCheckedChange={handleAutostart}
            />
            <Label htmlFor="stream-autostart">{t('server.autostart')}</Label>
          </div>
        </CardContent>
      </Card>

      <GsiCard />

      <IconPrefetchCard />

      <Card>
        <CardHeader>
          <CardTitle>{t('obs.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>{t('obs.step1')}</li>
            <li>{t('obs.step2')}</li>
            <li>{t('obs.step3')}</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{t('obs.note')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
