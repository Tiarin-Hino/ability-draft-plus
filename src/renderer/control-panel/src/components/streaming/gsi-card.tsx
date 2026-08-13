import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FileCog, FolderOpen } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/hooks/use-app-store'

// @DEV-GUIDE: GSI setup UI. Detection/writing happens in gsi-cfg-service (main); the
// live "connected" badge comes from the zubridge AppStore (gsiConnected — flips when
// the stream server receives/loses Dota's GSI POSTs). Error/result keys arrive as
// i18n keys in the 'streaming' namespace.
// GsiSetupControls is the reusable inner block (install/browse buttons + status) —
// embedded by BOTH the Streaming page's GsiCard and the Settings page's automatic
// draft tracking card, so the setup flow is identical everywhere. The cfg pins the
// stream port, so a port change after install silently kills GSI: detection reports
// the port parsed from the cfg (cfgPort) and we warn when it differs from the current
// stream port (running server port if any, else the streamPort setting).

interface GsiDetection {
  dotaPath: string | null
  cfgPath: string | null
  cfgExists: boolean
  cfgPort: number | null
}

/** Install/browse buttons + detection status; reused outside the Streaming page. */
export function GsiSetupControls() {
  const { t } = useTranslation('streaming')

  const [detection, setDetection] = useState<GsiDetection | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [settingsPort, setSettingsPort] = useState<number | null>(null)
  const serverPort = useAppStore((s) => s.streamServerPort)

  const refreshDetection = useCallback(() => {
    window.electronApi.invoke('gsi:detect').then(setDetection)
  }, [])

  useEffect(() => {
    refreshDetection()
    window.electronApi.invoke('settings:get').then((s) => setSettingsPort(s.streamPort))
  }, [refreshDetection])

  const streamPort = serverPort ?? settingsPort
  const portMismatch =
    detection?.cfgPort != null && streamPort != null && detection.cfgPort !== streamPort

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
    <div className="space-y-3">
      <div className="text-sm">
        <span className="text-muted-foreground">{t('gsi.detectedPath')}: </span>
        {detection?.dotaPath ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detection.dotaPath}</code>
        ) : (
          <span className="text-muted-foreground">{t('gsi.notDetected')}</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {detection?.cfgExists ? t('gsi.cfgPresent') : t('gsi.cfgMissing')}
      </p>

      {portMismatch && (
        <p
          className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('gsi.portMismatch', { cfgPort: detection?.cfgPort, streamPort })}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          onClick={() => writeCfg()}
          disabled={busy || !detection?.dotaPath}
          className="gap-2"
        >
          <FileCog className="h-4 w-4" aria-hidden="true" />
          {t('gsi.writeCfg')}
        </Button>
        <Button variant="outline" onClick={handleBrowse} disabled={busy} className="gap-2">
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          {t('gsi.browse')}
        </Button>
      </div>

      {message && (
        <p
          className={message.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
          role={message.error ? 'alert' : undefined}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}

/** Live connection badge shared by the GSI-dependent cards. */
export function GsiConnectionBadge() {
  const { t } = useTranslation('streaming')
  const gsiConnected = useAppStore((s) => s.gsiConnected)
  return (
    <Badge variant={gsiConnected ? 'default' : 'secondary'}>
      {gsiConnected ? t('gsi.connected') : t('gsi.disconnected')}
    </Badge>
  )
}

export function GsiCard() {
  const { t } = useTranslation('streaming')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('gsi.title')}</CardTitle>
          <GsiConnectionBadge />
        </div>
        <CardDescription>{t('gsi.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <GsiSetupControls />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('gsi.portNote')}</p>
          <p>{t('gsi.spectatorNote')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
