import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamPlayerModel, StreamPlayerRow, StreamTeam } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'
import { apiBase } from '../hooks/use-stream-state'

// @DEV-GUIDE: The two team columns flanking the pool board, mirroring the in-game
// player panels: hero-name line in team color ("NO HERO" until a model is picked —
// the game's own convention), player name, four pick slots, and the computed draft
// score as a broadcast-style chip. Radiant left/green, Dire right/red.

function ModelPortrait({ model }: { model: StreamPlayerModel | null }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)

  if (!model || failed) {
    return <div className="player-portrait player-portrait-empty">?</div>
  }
  return (
    <img
      className="player-portrait"
      src={`${apiBase()}${model.portraitPath}`}
      alt={model.displayName || t('unknownHero')}
      title={model.displayName}
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
      <ModelPortrait model={player.model} />
      <div className="player-info">
        <div className="player-hero-line">
          {player.model ? player.model.displayName : t('noHero')}
        </div>
        <div className="player-name-line">
          <span className="player-name" title={name}>
            {name}
          </span>
          {score !== null && score.score !== null && (
            <span
              className={`player-score confidence-${score.confidence}`}
              title={`${t('score.label')} (${t(`score.confidence.${score.confidence}`)})`}
            >
              {(score.score * 100).toFixed(0)}
            </span>
          )}
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
    </div>
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
