import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamPlayerModel, StreamPlayerRow, StreamTeam } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'
import { apiBase } from '../hooks/use-stream-state'

// @DEV-GUIDE: The two team columns flanking the pool board. Each player card uses the
// picked hero's official 16:9 art as a FULL-BLEED background (Valve hero portraits are
// landscape — cropping them into a small square looked broken) faded through a team-
// color gradient, TI hero-card style: hero name line in team color ("NO HERO" until a
// model is picked, the game's own convention), player name, four pick slots, and the
// draft score as a gold medallion. Radiant left/green, Dire right/red (mirrored).

function CardArt({ model }: { model: StreamPlayerModel }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="card-art"
      src={`${apiBase()}${model.portraitPath}`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

function PlayerCard({ player }: { player: StreamPlayerRow }) {
  const { t } = useTranslation()
  const name = player.playerName ?? t('player', { num: player.playerIndex + 1 })
  const score = player.draftScore

  return (
    <div className={`player-card team-accent-${player.team}`}>
      {player.model && <CardArt model={player.model} />}
      <div className="card-shade" />

      <div className="player-info">
        <div className="player-hero-line">
          {player.model ? player.model.displayName : t('noHero')}
        </div>
        <div className="player-name-line">
          <span className="player-name" title={name}>
            {name}
          </span>
        </div>
        <div className="player-picks">
          {player.picks.map((slot, i) => (
            <AbilityTile key={i} slot={slot} size="small" />
          ))}
          {Array.from({ length: 4 - player.picks.length }, (_, i) => (
            <div className="tile tile-small tile-empty" key={`e${i}`} />
          ))}
        </div>
      </div>

      {score !== null && score.score !== null && (
        <div
          className={`player-score confidence-${score.confidence}`}
          title={`${t('score.label')} (${t(`score.confidence.${score.confidence}`)})`}
        >
          {(score.score * 100).toFixed(0)}
        </div>
      )}
    </div>
  )
}

/** Optional bundled banner cap (resources/data/stream/<team>-cap.png|jpg). */
function TeamCap({ team }: { team: StreamTeam }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="team-cap"
      src={`${apiBase()}/art/${team}-cap`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

export function PlayerColumn({
  team,
  players,
}: {
  team: StreamTeam
  players: StreamPlayerRow[]
}) {
  const { t } = useTranslation()
  const scores = players
    .map((p) => p.draftScore?.score)
    .filter((s): s is number => s !== null && s !== undefined)
  const teamAverage =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  return (
    <section className={`team-column team-${team}`} aria-label={t(`team.${team}`)}>
      <header className="team-header">
        <TeamCap team={team} />
        <div className="team-cap-scrim" />
        <h2 className="team-title">{t(`team.${team}`)}</h2>
        {teamAverage !== null && (
          <span className="team-score" title={t('score.teamAverage')}>
            {(teamAverage * 100).toFixed(0)}
          </span>
        )}
      </header>
      {players.map((p) => (
        <PlayerCard key={p.playerIndex} player={p} />
      ))}
    </section>
  )
}
