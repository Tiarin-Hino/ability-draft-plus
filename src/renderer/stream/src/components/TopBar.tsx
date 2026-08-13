import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamGsiInfo, StreamPlayerRow } from '@shared/types/stream'
import { apiBase } from '../hooks/use-stream-state'
import type { StreamConnectionState } from '../hooks/use-stream-state'
import medallionUrl from '../assets/ui/clock-medallion.png'

// @DEV-GUIDE: Broadcast top bar: ABILITY DRAFT wordmark + optional tournament title
// (?title= query param), the gold medallion draft clock (GSI) flanked by per-player
// gem sockets (a gem lights when that player has drafted at least one ability), and
// the connection dot. The right side is intentionally EMPTY — a reserved zone where
// productions stack their own OBS sources (sponsor logos, series score). ?demo=1
// outlines it.

function formatClock(clockTime: number | null): string | null {
  if (clockTime === null) return null
  const total = Math.abs(Math.trunc(clockTime))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${clockTime < 0 ? '-' : ''}${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Optional bundled tournament emblem (resources/data/stream/logo.png|jpg). */
function LogoPlate() {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="top-bar-logo"
      src={`${apiBase()}/art/logo`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

function TurnGems({ team, players }: { team: 'radiant' | 'dire'; players: StreamPlayerRow[] }) {
  const teamPlayers = players.filter((p) => p.team === team)
  const lit = teamPlayers.filter((p) => p.picks.some((s) => s !== null)).length
  return (
    <div className={`turn-gems turn-gems-${team}`}>
      {teamPlayers.map((_, i) => {
        // Gems fill toward the medallion: right-to-left for radiant (left of the
        // clock), left-to-right for dire (right of it)
        const isLit = team === 'radiant' ? i >= teamPlayers.length - lit : i < lit
        return <span key={i} className={`turn-gem${isLit ? ' turn-gem-lit' : ''}`} />
      })}
    </div>
  )
}

export function TopBar({
  title,
  gsi,
  connection,
  demo,
  players,
}: {
  title: string | null
  gsi: StreamGsiInfo
  connection: StreamConnectionState
  demo: boolean
  players: StreamPlayerRow[]
}) {
  const { t } = useTranslation()
  const clock = formatClock(gsi.clockTime)

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <LogoPlate />
        <span className="top-bar-wordmark">{t('wordmark')}</span>
        {title && <span className="top-bar-title">{title}</span>}
        {demo && <span className="demo-badge">{t('demo')}</span>}
      </div>

      <div className="top-bar-center">
        {gsi.connected && clock && (
          <>
            <TurnGems team="radiant" players={players} />
            <div
              className="clock-medallion"
              style={{ backgroundImage: `url(${medallionUrl})` }}
            >
              <span className="clock-time">{clock}</span>
            </div>
            <TurnGems team="dire" players={players} />
          </>
        )}
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
