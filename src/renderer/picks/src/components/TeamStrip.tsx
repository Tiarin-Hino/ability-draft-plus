import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PicksAbility, PicksPlayer, StreamTeam } from '@shared/types/stream'
import { apiBase } from '../hooks/use-picks-state'
import type { StripOptions } from '../params'
import { portraitObjectPosition } from '../portrait-focus'

// @DEV-GUIDE: One team's five picks rows. Row layout copies the in-game pick boxes:
// portrait, 3 standard picks in pick order, then the gold-framed ultimate — and the
// whole row REVERSES under align='right' so the portrait stays outermost against the
// screen edge the streamer anchors the source to. Spacing arrives as CSS custom
// properties from StripOptions (URL-tuned via the setup page). Icons that fail to
// load fall back to the empty-socket look instead of a broken-image glyph.

function AbilityTile({ pick, ult }: { pick: PicksAbility | null; ult: boolean }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const ultClass = ult ? ' tile-ult' : ''

  if (!pick) return <div className={`tile tile-empty${ultClass}`} />
  if (pick.isUnknown || !pick.iconPath || failed) {
    return (
      <div
        className={`tile ${pick.isUnknown ? 'tile-unknown' : 'tile-empty'}${ultClass}`}
        title={pick.isUnknown ? t('unknownAbility') : pick.displayName}
      >
        {pick.isUnknown ? '?' : null}
      </div>
    )
  }
  return (
    <img
      className={`tile${ultClass}`}
      src={`${apiBase()}${pick.iconPath}`}
      alt={pick.displayName}
      title={pick.displayName}
      onError={() => setFailed(true)}
    />
  )
}

function PlayerRow({
  player,
  showName,
}: {
  player: PicksPlayer
  showName: boolean
}) {
  const [portraitFailed, setPortraitFailed] = useState(false)

  return (
    <div className="player">
      {showName && player.playerName && (
        <span className="nameplate">{player.playerName}</span>
      )}
      <div className="row">
        {player.portraitPath && !portraitFailed ? (
          <img
            className="portrait"
            src={`${apiBase()}${player.portraitPath}`}
            style={{ objectPosition: portraitObjectPosition(player.portraitPath) }}
            alt={player.heroDisplayName ?? ''}
            title={player.heroDisplayName ?? undefined}
            onError={() => setPortraitFailed(true)}
          />
        ) : (
          <div className="portrait portrait-unknown">—</div>
        )}
        {player.picks.map((pick, i) => (
          <AbilityTile key={i} pick={pick} ult={i === 3} />
        ))}
      </div>
    </div>
  )
}

export function TeamStrip({
  team,
  players,
  options,
}: {
  team: StreamTeam
  players: PicksPlayer[]
  options: StripOptions
}) {
  return (
    <div
      className={`strip strip-${team} strip-align-${options.align}${options.frame ? ' strip-frame' : ''}`}
      style={
        {
          '--row-gap': `${options.rowGap}px`,
          '--slot-gap': `${options.slotGap}px`,
          '--hero-gap': `${options.heroGap}px`,
          '--ult-gap': `${options.ultGap}px`,
        } as React.CSSProperties
      }
    >
      {players.map((player) => (
        <PlayerRow
          key={player.playerIndex}
          player={player}
          showName={options.names}
        />
      ))}
    </div>
  )
}
