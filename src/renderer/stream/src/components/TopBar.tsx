import { useTranslation } from 'react-i18next'
import type { StreamGsiInfo } from '@shared/types/stream'
import type { StreamConnectionState } from '../hooks/use-stream-state'

// @DEV-GUIDE: Broadcast top bar: ABILITY DRAFT wordmark + optional tournament title
// (?title= query param), a phase/clock chip fed by GSI, and the connection dot.
// The right side is intentionally EMPTY — a reserved zone where productions stack
// their own OBS sources (sponsor logos, series score). ?demo=1 outlines it.

function formatClock(clockTime: number | null): string | null {
  if (clockTime === null) return null
  const total = Math.abs(Math.trunc(clockTime))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${clockTime < 0 ? '-' : ''}${minutes}:${String(seconds).padStart(2, '0')}`
}

export function TopBar({
  title,
  gsi,
  connection,
  demo,
}: {
  title: string | null
  gsi: StreamGsiInfo
  connection: StreamConnectionState
  demo: boolean
}) {
  const { t } = useTranslation()
  const clock = formatClock(gsi.clockTime)

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <span className="top-bar-wordmark">{t('wordmark')}</span>
        {title && <span className="top-bar-title">{title}</span>}
        {demo && <span className="demo-badge">{t('demo')}</span>}
      </div>

      <div className="top-bar-center">
        {gsi.connected && clock && <span className="clock-chip">{clock}</span>}
      </div>

      <div className={`reserved-zone reserved-top${demo ? ' reserved-visible' : ''}`}>
        {demo && <span>{t('reservedZone')}</span>}
      </div>

      <div
        className={`connection connection-${connection}`}
        title={t(`connection.${connection}`)}
        aria-label={t(`connection.${connection}`)}
      />
    </header>
  )
}
