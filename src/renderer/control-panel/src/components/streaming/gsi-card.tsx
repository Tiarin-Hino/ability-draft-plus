import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCog, FolderOpen } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/hooks/use-app-store'

// @DEV-GUIDE: GSI setup card on the Streaming page. Detection/writing happens in
// gsi-cfg-service (main); the live "connected" badge comes from the zubridge AppStore
// (gsiConnected — flips when the stream server receives/loses Dota's GSI POSTs).
// Error/result keys arrive as i18n keys in the 'streaming' namespace.

interface GsiDetection {
  dotaPath: string | null
  cfgPath: string | null
  cfgExists: boolean
}

export function GsiCard() {
  const { t } = useTranslation('streaming')
  const gsiConnected = useAppStore((s) => s.gsiConnected)

  const [detection, setDetection] = useState<GsiDetection | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshDetection = useCallback(() => {
    window.electronApi.invoke('gsi:detect').then(setDetection)
  }, [])

  useEffect(() => {
    refreshDetection()
  }, [refreshDetection])

  const writeCfg = async (dotaDir?: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.electronApi.invoke('gsi:writeCfg', {
        ...(dotaDir ? { dotaDir } : {}),
      })
      if (result.success && result.path) {
        setMessage({ text: t('gsi.writeSuccess', { path: result.path }), error: false })
      } else {
        setMessage({ text: t(result.errorKey ?? 'gsi.errorWriteFailed'), error: true })
      }
      refreshDetection()
    } finally {
      setBusy(false)
    }
  }

  const handleBrowse = async () => {
    const { dir } = await window.electronApi.invoke('gsi:pickDotaFolder', {
      title: t('gsi.pickFolderTitle'),
    })
    if (dir) await writeCfg(dir)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('gsi.title')}</CardTitle>
          <Badge variant={gsiConnected ? 'default' : 'secondary'}>
            {gsiConnected ? t('gsi.connected') : t('gsi.disconnected')}
          </Badge>
        </div>
        <CardDescription>{t('gsi.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground">{t('gsi.detectedPath')}: </span>
          {detection?.dotaPath ? (
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {detection.dotaPath}
            </code>
          ) : (
            <span className="text-muted-foreground">{t('gsi.notDetected')}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {detection?.cfgExists ? t('gsi.cfgPresent') : t('gsi.cfgMissing')}
        </p>

        <div className="flex gap-2">
          <Button
            onClick={() => writeCfg()}
            disabled={busy || !detection?.dotaPath}
            className="gap-2"
          >
            <FileCog className="h-4 w-4" aria-hidden="true" />
            {t('gsi.writeCfg')}
          </Button>
          <Button
            variant="outline"
            onClick={handleBrowse}
            disabled={busy}
            className="gap-2"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            {t('gsi.browse')}
          </Button>
        </div>

        {message && (
          <p
            className={
              message.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
            role={message.error ? 'alert' : undefined}
          >
            {message.text}
          </p>
        )}

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('gsi.portNote')}</p>
          <p>{t('gsi.spectatorNote')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
