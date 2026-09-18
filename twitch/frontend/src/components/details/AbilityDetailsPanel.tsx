import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import type { CatalogAbility } from '../../data/catalog-types'
import {
  SLOT_LABELS,
  displayName,
  heroDisplayName,
  heroPartnersForAbility,
  partnersInPool,
  pickedBy,
  playerName,
  slotByIndex,
  teamOf,
  type Partner,
} from '../../data/selectors'
import { AbilityIcon, HeroPortrait, pct } from '../common/Art'

export function AbilityDetailsPanel({
  compact,
  rich,
  index,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  index: number
}) {
  const catalog = useOverlayStore((s) => s.catalog)
  const catalogStatus = useOverlayStore((s) => s.catalogStatus)
  const select = useOverlayStore((s) => s.select)

  const slot = slotByIndex(compact, index)
  const name = slot?.name ?? rich?.abilities.find((a) => a.i === index)?.n ?? null
  const title = displayName(rich, catalog, name, index)
  const entry: CatalogAbility | undefined = name ? catalog?.abilities[name] : undefined
  const stats = rich?.abilities.find((a) => a.i === index) ?? null
  const holder = slot?.picked ? pickedBy(compact, index) : null
  const heroCdn = slot?.heroCdn ?? null
  const heroLabel = heroDisplayName(rich, catalog, heroCdn, slot?.heroOrder)
  const { strong, weak } = partnersInPool(rich, compact, index)
  const heroPartners = heroPartnersForAbility(rich, compact, index)

  const holderLabel = (playerIndex: number) =>
    `${playerName(compact, rich, playerIndex) ?? `Player ${playerIndex + 1}`} (${teamOf(playerIndex) === 'radiant' ? 'Radiant' : 'Dire'})`

  return (
    <div className="details">
      <header className="details-header">
        <AbilityIcon name={name} label={title} size={48} />
        <div className="details-heading">
          <h2 className="details-title">{title}</h2>
          <div className="chips">
            {slot && <span className="chip">{`${heroLabel} · ${SLOT_LABELS[slot.k]}`}</span>}
            {holder !== null ? (
              <span className="chip chip-picked">{`Picked by ${holderLabel(holder)}`}</span>
            ) : (
              <span className="chip chip-pool">In pool</span>
            )}
            {stats?.tt && <span className="chip chip-top">Top pick</span>}
          </div>
        </div>
      </header>

      <section className="details-section">
        {entry ? (
          <DotaAbilityBlock entry={entry} />
        ) : (
          <p className="muted">
            {catalogStatus === 'loading'
              ? 'Loading Dota data…'
              : catalogStatus === 'error'
                ? 'Dota data unavailable right now.'
                : 'Dota data not available yet for this ability.'}
          </p>
        )}
      </section>

      <section className="details-section">
        <h3 className="details-subtitle">Windrun stats</h3>
        {stats ? (
          <dl className="stat-grid">
            <dt>Win rate</dt>
            <dd>{pct(stats.wr)}</dd>
            <dt>Avg pick</dt>
            <dd>{stats.pp === null ? 'N/A' : `#${stats.pp.toFixed(1)}`}</dd>
            <dt>High-skill WR</dt>
            <dd>{pct(stats.hs)}</dd>
          </dl>
        ) : (
          <p className="muted">Loading stats…</p>
        )}
      </section>

      <section className="details-section">
        <h3 className="details-subtitle">Combinations in this pool</h3>
        <PartnerList label="Strong with" partners={strong.slice(0, 6)} compact={compact} rich={rich} onPick={(i) => select({ kind: 'ability', i })} />
        <PartnerList label="Weak with" partners={weak.slice(0, 4)} compact={compact} rich={rich} onPick={(i) => select({ kind: 'ability', i })} tone="weak" />
        {heroPartners.length > 0 && (
          <div className="partner-block">
            <h4 className="partner-label">Hero synergies</h4>
            <ul className="partner-list">
              {heroPartners.slice(0, 4).map((h) => (
                <li key={h.heroOrder} className={h.modelPicked ? 'is-gone' : ''}>
                  <button type="button" className="partner-row" onClick={() => select({ kind: 'hero', heroOrder: h.heroOrder })}>
                    <HeroPortrait cdn={h.cdn} label={heroDisplayName(rich, catalog, h.cdn, h.heroOrder)} width={40} height={22} />
                    <span className="partner-name">{heroDisplayName(rich, catalog, h.cdn, h.heroOrder)}</span>
                    <span className="partner-wr">{pct(h.wr)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {strong.length === 0 && weak.length === 0 && heroPartners.length === 0 && (
          <p className="muted">{rich ? 'No notable combinations in this pool.' : 'Loading…'}</p>
        )}
      </section>
    </div>
  )
}

function PartnerList({
  label,
  partners,
  compact,
  rich,
  onPick,
  tone = 'strong',
}: {
  label: string
  partners: Partner[]
  compact: TwitchCompactState
  rich: TwitchRichState | null
  onPick: (i: number) => void
  tone?: 'strong' | 'weak'
}) {
  const catalog = useOverlayStore((s) => s.catalog)
  if (partners.length === 0) return null
  return (
    <div className={`partner-block tone-${tone}`}>
      <h4 className="partner-label">{label}</h4>
      <ul className="partner-list">
        {partners.map((p) => {
          const holder = p.pickedBy
          const label = displayName(rich, catalog, p.name, p.i)
          return (
            <li key={p.i} className={p.inPool ? '' : 'is-gone'}>
              <button type="button" className="partner-row" onClick={() => onPick(p.i)}>
                <AbilityIcon name={p.name} label={label} size={26} />
                <span className="partner-name">{label}</span>
                <span className="partner-wr">{pct(p.wr)}</span>
                {holder !== null && (
                  <span className="partner-note">{`picked by ${playerName(compact, rich, holder) ?? `P${holder + 1}`}`}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function DotaAbilityBlock({ entry }: { entry: CatalogAbility }) {
  const chips: string[] = []
  if (entry.b) chips.push(...entry.b)
  if (entry.tt) chips.push(...entry.tt.map((t) => `Targets ${t}`))
  if (entry.dt) chips.push(`${entry.dt} damage`)
  if (entry.bkb !== undefined) chips.push(entry.bkb ? 'Pierces spell immunity' : 'Blocked by spell immunity')
  if (entry.disp) chips.push(entry.disp)
  return (
    <div className="dota-block">
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className="chip chip-dota">
              {c}
            </span>
          ))}
        </div>
      )}
      {(entry.cd || entry.mc || entry.dmg) && (
        <dl className="stat-grid stat-grid-3">
          {entry.cd && (
            <>
              <dt>Cooldown</dt>
              <dd>{entry.cd}</dd>
            </>
          )}
          {entry.mc && (
            <>
              <dt>Mana</dt>
              <dd>{entry.mc}</dd>
            </>
          )}
          {entry.dmg && (
            <>
              <dt>Damage</dt>
              <dd>{entry.dmg}</dd>
            </>
          )}
        </dl>
      )}
      {entry.d && <p className="dota-desc">{entry.d}</p>}
      {entry.at && entry.at.length > 0 && (
        <dl className="attrib-list">
          {entry.at.map(([header, value]) => (
            <div key={header} className="attrib-row">
              <dt>{header}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.sc && <AghsCard kind="Scepter" upgrade={entry.sc} />}
      {entry.sh && <AghsCard kind="Shard" upgrade={entry.sh} />}
    </div>
  )
}

export function AghsCard({ kind, upgrade }: { kind: 'Scepter' | 'Shard'; upgrade: { d: string; newSkill?: boolean } }) {
  return (
    <div className={`aghs-card aghs-${kind.toLowerCase()}`}>
      <h4 className="aghs-title">
        {`Aghanim's ${kind}`}
        {upgrade.newSkill && <span className="chip chip-new">new ability</span>}
      </h4>
      <p>{upgrade.d}</p>
    </div>
  )
}
