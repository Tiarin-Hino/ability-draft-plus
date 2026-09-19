import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import type { CatalogHero } from '../../data/catalog-types'
import {
  abilityPartnersForHero,
  displayName,
  heroDisplayName,
  isModelPicked,
  playerModel,
  playerName,
  teamOf,
} from '../../data/selectors'
import { AbilityIcon, HeroPortrait, pct } from '../common/Art'
import { AghsCard, DotaAbilityBlock } from './AbilityDetailsPanel'

const ATTR_LABEL: Record<string, string> = { str: 'Strength', agi: 'Agility', int: 'Intelligence', all: 'Universal' }
const TALENT_LEVELS = ['10', '15', '20', '25']

export function HeroDetailsPanel({
  compact,
  rich,
  heroOrder,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  heroOrder: number
}) {
  const catalog = useOverlayStore((s) => s.catalog)
  const catalogStatus = useOverlayStore((s) => s.catalogStatus)
  const select = useOverlayStore((s) => s.select)

  const cdn = compact.pool?.[heroOrder]?.[0] ?? rich?.heroes.find((h) => h.i === heroOrder)?.cdn ?? null
  const title = heroDisplayName(rich, catalog, cdn, heroOrder)
  const hero: CatalogHero | undefined = cdn ? catalog?.heroes[cdn] : undefined
  const stats = rich?.heroes.find((h) => h.i === heroOrder) ?? null
  const picked = isModelPicked(compact, heroOrder)
  const holder = picked
    ? (compact.players ?? []).findIndex((_, p) => playerModel(compact, p).heroOrder === heroOrder)
    : -1
  const partners = abilityPartnersForHero(rich, compact, heroOrder)
  const innate = hero?.innate ? catalog?.abilities[hero.innate] : undefined
  const abilitySpecificTalent = (name: string) => /^special_bonus_unique_/.test(name)

  return (
    <div className="details">
      <header className="details-header">
        <HeroPortrait cdn={cdn} label={title} width={72} height={40} />
        <div className="details-heading">
          <h2 className="details-title">{title}</h2>
          <div className="chips">
            {hero && <span className="chip">{ATTR_LABEL[hero.attr] ?? hero.attr}</span>}
            {hero && <span className="chip">{hero.atk}</span>}
            {picked ? (
              <span className="chip chip-picked">
                {holder >= 0
                  ? `Model picked by ${playerName(compact, rich, holder) ?? `Player ${holder + 1}`} (${teamOf(holder) === 'radiant' ? 'Radiant' : 'Dire'})`
                  : 'Model picked'}
              </span>
            ) : (
              <span className="chip chip-pool">Model available</span>
            )}
          </div>
          {hero && hero.roles.length > 0 && <p className="muted small">{hero.roles.join(' · ')}</p>}
        </div>
      </header>

      {hero ? (
        <>
          <section className="details-section">
            <h3 className="details-subtitle">Base stats</h3>
            <dl className="stat-grid stat-grid-3">
              <dt>STR</dt>
              <dd>{`${hero.stats.str} +${hero.stats.strG}`}</dd>
              <dt>AGI</dt>
              <dd>{`${hero.stats.agi} +${hero.stats.agiG}`}</dd>
              <dt>INT</dt>
              <dd>{`${hero.stats.int} +${hero.stats.intG}`}</dd>
              <dt>Health</dt>
              <dd>{hero.stats.hp}</dd>
              <dt>Mana</dt>
              <dd>{hero.stats.mp}</dd>
              <dt>Armor</dt>
              <dd>{hero.stats.armor}</dd>
              <dt>Attack</dt>
              <dd>{`${hero.stats.dmgMin}–${hero.stats.dmgMax}`}</dd>
              <dt>Range</dt>
              <dd>{hero.stats.range}</dd>
              <dt>BAT</dt>
              <dd>{hero.stats.bat / 100}</dd>
              <dt>Move speed</dt>
              <dd>{hero.stats.ms}</dd>
              <dt>Turn rate</dt>
              <dd>{hero.stats.turn}</dd>
              <dt>Projectile</dt>
              <dd>{hero.stats.proj || 'melee'}</dd>
            </dl>
          </section>

          {hero.talents.length > 0 && (
            <section className="details-section">
              <h3 className="details-subtitle">Talents</h3>
              <div className="talent-tree">
                {[4, 3, 2, 1].map((level) => {
                  const pair = hero.talents.filter((t) => t.l === level)
                  return (
                    <div key={level} className="talent-row">
                      <span className={`talent${pair[1] && abilitySpecificTalent(pair[1].name) ? ' is-inert' : ''}`}>
                        {pair[1]?.n ?? ''}
                      </span>
                      <span className="talent-level">{TALENT_LEVELS[level - 1]}</span>
                      <span className={`talent${pair[0] && abilitySpecificTalent(pair[0].name) ? ' is-inert' : ''}`}>
                        {pair[0]?.n ?? ''}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="muted small">Dimmed talents belong to the hero's own abilities and do nothing in Ability Draft unless that ability is drafted.</p>
            </section>
          )}

          {innate && (
            <section className="details-section">
              <h3 className="details-subtitle">{`Innate: ${innate.n}`}</h3>
              <DotaAbilityBlock entry={innate} />
            </section>
          )}

          {(hero.scepter?.newSkill || hero.shard?.newSkill) && (
            <section className="details-section">
              {hero.scepter?.newSkill && <AghsCard kind="Scepter" upgrade={{ d: hero.scepter.d, newSkill: true }} />}
              {hero.shard?.newSkill && <AghsCard kind="Shard" upgrade={{ d: hero.shard.d, newSkill: true }} />}
            </section>
          )}
        </>
      ) : (
        <section className="details-section">
          <p className="muted">
            {catalogStatus === 'loading' ? 'Loading Dota data…' : 'Dota data not available for this hero.'}
          </p>
        </section>
      )}

      <section className="details-section">
        <h3 className="details-subtitle">Windrun stats</h3>
        {stats ? (
          <dl className="stat-grid">
            <dt>Win rate</dt>
            <dd>{pct(stats.wr)}</dd>
            <dt>Pick rate</dt>
            <dd>{stats.pr === null ? 'N/A' : stats.pr.toFixed(1)}</dd>
            <dt>High-skill WR</dt>
            <dd>{pct(stats.hs)}</dd>
          </dl>
        ) : (
          <p className="muted">Loading stats…</p>
        )}
      </section>

      {partners.length > 0 && (
        <section className="details-section">
          <h3 className="details-subtitle">Abilities in this pool that synergize</h3>
          <ul className="partner-list">
            {partners.slice(0, 6).map((p) => {
              const label = displayName(rich, catalog, p.name, p.i)
              return (
                <li key={p.i} className={p.inPool ? '' : 'is-gone'}>
                  <button type="button" className="partner-row" onClick={() => select({ kind: 'ability', i: p.i })}>
                    <AbilityIcon name={p.name} label={label} size={26} />
                    <span className="partner-name">{label}</span>
                    <span className="partner-wr">{pct(p.wr)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
