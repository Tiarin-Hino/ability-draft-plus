import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/hooks/use-app-store'

// @DEV-GUIDE: Controls for a BACKGROUND draft session (overlayBackgroundMode). Its
// overlay is never shown, so the overlay's own Reset and Close buttons are out of
// reach — before this there was no way to clear a leftover draft or end the
// session short of quitting the app. Reset draft sends overlay:reset (clears the
// pool/board/slot mapping and re-arms auto-rescan for the current draft); End
// session sends overlay:close (closing the hidden overlay resets like any close).
// A NEW MATCH clears the previous draft automatically (auto-rescan-service), so
// these are for leftovers and manual control. Rendered on the dashboard quick
// actions and the Streaming page's background card; renders nothing unless a
// background session is running.

const RESET_NOTE_MS = 4_000

export function BackgroundSessionControls() {
  const { t } = useTranslation('streaming')
  const running = useAppStore((s) => s.overlayActive && s.overlayBackground)
  const [resetDone, setResetDone] = useState(false)

  useEffect(() => {
    if (!resetDone) return
    const timer = setTimeout(() => setResetDone(false), RESET_NOTE_MS)
    return () => clearTimeout(timer)
  }, [resetDone])

  if (!running) return null

  const handleReset = () => {
    window.electronApi.send('overlay:reset')
    setResetDone(true)
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-1" aria-hidden="true" />
          {t('background.resetDraft')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.electronApi.send('overlay:close')}
        >
          <Power className="h-4 w-4 mr-1" aria-hidden="true" />
          {t('background.endSession')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {resetDone ? t('background.resetDone') : t('background.controlsHint')}
      </p>
    </div>
  )
}
