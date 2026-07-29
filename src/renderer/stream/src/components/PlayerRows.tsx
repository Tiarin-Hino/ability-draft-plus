import { useTranslation } from 'react-i18next'
import type { StreamPlayerRow, StreamTeam } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'

function PlayerCard({ player }: { player: StreamPlayerRow }) {
  const { t } = useTranslation()
  const name = player.playerName ?? t('player', { num: player.playerIndex + 1 })
  const score = player.draftScore

  return (
    <div className="player-card">
      <div className="player-head">
        <span className="player-name" title={name}>
          {name}
        </span>
        {score?.score !== null && score !== null && (
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
  )
}

function TeamColumn({ team, players }: { team: StreamTeam; players: StreamPlayerRow[] }) {
  const { t } = useTranslation()
  return (
    <div className={`team team-${team}`}>
      <h2 className="team-title">{t(`team.${team}`)}</h2>
      {players.map((p) => (
        <PlayerCard key={p.playerIndex} player={p} />
      ))}
    </div>
  )
}

export function PlayerRows({ players }: { players: StreamPlayerRow[] }) {
  return (
    <section className="players" aria-label="Players">
      <TeamColumn team="radiant" players={players.filter((p) => p.team === 'radiant')} />
      <TeamColumn team="dire" players={players.filter((p) => p.team === 'dire')} />
    </section>
  )
}
