import { useState, useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Download, RotateCcw } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface BackupEntry {
  name: string
  path: string
  date: string
  size: number
}

interface BackupStats {
  count: number
  totalSize: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function fetchBackups() {
  const [list, backupStats] = await Promise.all([
    window.electronApi.invoke('backup:list'),
    window.electronApi.invoke('backup:stats'),
  ])
  return { list, backupStats }
}

export function BackupCard() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation()

  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [stats, setStats] = useState<BackupStats | null>(null)
  const [creating, setCreating] = useState(false)
  const [restorePath, setRestorePath] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Increment to trigger a reload
  const [reloadKey, reload] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    let cancelled = false
    fetchBackups().then(({ list, backupStats }) => {
      if (cancelled) return
      setBackups(list)
      setStats(backupStats)
    })
    return () => { cancelled = true }
  }, [reloadKey])

  const handleCreate = async () => {
    setCreating(true)
    setMessage(null)
    const result = await window.electronApi.invoke('backup:create')
    if (result.success) {
      setMessage(t('backup.createSuccess'))
      reload()
    } else {
      setMessage(t('backup.createError', { error: result.error }))
    }
    setCreating(false)
    setTimeout(() => setMessage(null), 3000)
  }

  const handleRestore = async () => {
    if (!restorePath) return
    setRestorePath(null)
    setMessage(null)
    const result = await window.electronApi.invoke('backup:restore', {
      backupPath: restorePath,
    })
    if (result.success) {
      setMessage(t('backup.restoreSuccess'))
    } else {
      setMessage(t('backup.restoreError', { error: result.error }))
    }
    setTimeout(() => setMessage(null), 3000)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t('backup.title')}
          </CardTitle>
          {stats && (
            <CardDescription>
              {t('backup.stats', {
                count: stats.count,
                size: formatBytes(stats.totalSize),
              })}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleCreate} disabled={creating} size="sm">
            <Download className="h-4 w-4 mr-1" />
            {t('backup.createButton')}
          </Button>

          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}

          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('backup.noBackups')}</p>
          ) : (
            <div className="border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">{t('backup.columns.name')}</th>
                    <th className="text-left p-2 font-medium">{t('backup.columns.date')}</th>
                    <th className="text-left p-2 font-medium">{t('backup.columns.size')}</th>
                    <th className="p-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={backup.path} className="border-b last:border-0">
                      <td className="p-2">{backup.name}</td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(backup.date).toLocaleString()}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {formatBytes(backup.size)}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestorePath(backup.path)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {t('backup.restoreButton')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={restorePath !== null} onOpenChange={() => setRestorePath(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('backup.restoreButton')}</DialogTitle>
            <DialogDescription>{t('backup.restoreConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestorePath(null)}>
              {tc('actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRestore}>
              {tc('actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
