import { useTranslation } from 'react-i18next'
import type { StreamBoardState } from '@shared/types/stream'
import { apiBase } from '../hooks/use-stream-state'

// @DEV-GUIDE: Broadcast ticker ribbon with the most recent attributed picks
// (experimental auto-rescan's pickFeed). Renders nothing when the feed is absent,
// so the layout is identical for users without auto-tracking enabled.

const TICKER_LENGTH = 4

interface TickerEntry {
  key: number
  playerName: string
  abilityName: string
  displayName: string
}

function resolveEntries(board: StreamBoardState, t: (k: string, o?: object) => string): TickerEntry[] {
  const feed = board.pickFeed ?? []
  const displayByName = new Map<string, string>()
  for (const hero of board.heroes) {
    for (const slot of [...hero.standard, ...(hero.ultimate ? [hero.ultimate] : [])]) {
      if (slot.name) displayByName.set(slot.name, slot.displayName)
    }
  }
  for (const player of board.players) {
    for (const slot of player.picks) {
      if (slot?.name) displayByName.set(slot.name, slot.displayName)
    }
  }

  return feed
    .filter((e) => e.kind === 'ability' && e.abilityName !== null)
    .slice(-TICKER_LENGTH)
    .reverse()
    .map((e) => ({
      key: e.seq,
      playerName:
        board.players[e.playerIndex]?.playerName ??
        t('player', { num: e.playerIndex + 1 }),
      abilityName: e.abilityName as string,
      displayName: displayByName.get(e.abilityName as string) ?? (e.abilityName as string),
    }))
}

export function PickTicker({ board }: { board: StreamBoardState }) {
  const { t } = useTranslation()
  const entries = resolveEntries(board, t)
  if (entries.length === 0) return null

  return (
    <div className="pick-ticker" aria-label={t('panels.latestPicks')} data-edit-key="latest-picks">
      <span className="pick-ticker-label">{t('panels.latestPicks')}</span>
      {entries.map((entry) => (
        <span className="pick-ticker-entry" key={entry.key}>
          <img
            src={`${apiBase()}/icons/abilities/${entry.abilityName}.png`}
            alt=""
            aria-hidden="true"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <span className="pick-ticker-player">{entry.playerName}</span>
          <span className="pick-ticker-arrow">›</span>
          <span className="pick-ticker-ability">{entry.displayName}</span>
        </span>
      ))}
    </div>
  )
}
