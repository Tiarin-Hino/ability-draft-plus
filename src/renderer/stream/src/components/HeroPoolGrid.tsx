import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamHeroRow } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'
import { apiBase } from '../hooks/use-stream-state'

function HeroPortrait({ row }: { row: StreamHeroRow }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const name = row.heroDisplayName ?? t('unknownHero')

  return (
    <div className="hero-portrait" title={name}>
      {row.portraitPath && !failed ? (
        <img
          src={`${apiBase()}${row.portraitPath}`}
          alt={name}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="hero-portrait-fallback">{name.charAt(0)}</div>
      )}
      <span className="hero-name">{name}</span>
    </div>
  )
}

export function HeroPoolGrid({ heroes }: { heroes: StreamHeroRow[] }) {
  return (
    <section className="pool" aria-label="Ability pool">
      {heroes.map((row) => (
        <div className="pool-row" key={row.heroOrder}>
          <HeroPortrait row={row} />
          <div className="pool-abilities">
            {row.standard.map((slot, i) => (
              <AbilityTile key={`${row.heroOrder}-s${i}`} slot={slot} />
            ))}
            {row.ultimate && (
              <div className="ultimate-slot">
                <AbilityTile slot={row.ultimate} />
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
