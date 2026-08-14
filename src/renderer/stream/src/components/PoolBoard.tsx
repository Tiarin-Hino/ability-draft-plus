import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StreamHeroRow } from '@shared/types/stream'
import { AbilityTile } from './AbilityTile'
import { apiBase } from '../hooks/use-stream-state'

// @DEV-GUIDE: The central draft board, mirroring the in-game AD pedestal so viewers
// orient instantly: ULTIMATE ABILITIES as two rows of six, STANDARD ABILITIES as six
// rows where each half-row is one hero's Q/W/E beside its portrait. The tile ORDER
// matches the game's canonical arrangement (verified against the shipped
// layout_coordinates presets): ult rows [0,1,2,7,6,5] / [3,4,10,11,9,8], standard
// half-row pairs (0,5)(1,6)(2,7) upper block and (3,8)(4,9)(10,11) lower block.

const ULT_ROWS: number[][] = [
  [0, 1, 2, 7, 6, 5],
  [3, 4, 10, 11, 9, 8],
]

const STD_PAIRS: Array<[number, number]> = [
  [0, 5],
  [1, 6],
  [2, 7],
  [3, 8],
  [4, 9],
  [10, 11],
]

function HeroMini({ row }: { row: StreamHeroRow | undefined }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const name = row?.heroDisplayName ?? t('unknownHero')
  const picked = row?.modelPicked === true

  return (
    <div
      className={`pool-hero-mini${picked ? ' pool-hero-mini-picked' : ''}`}
      title={picked ? `${name} — ${t('pool.modelPicked')}` : name}
    >
      {row?.portraitPath && !failed ? (
        <img
          src={`${apiBase()}${row.portraitPath}`}
          alt={name}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="pool-hero-mini-fallback">{name.charAt(0)}</span>
      )}
      {picked && <span className="pool-hero-mini-picked-mark" aria-hidden="true" />}
    </div>
  )
}

/** Mirrors the in-game pedestal: left half-rows carry the hero portrait on the
 * LEFT of the abilities, right half-rows carry it on the RIGHT. */
function HalfRow({
  row,
  heroSide,
}: {
  row: StreamHeroRow | undefined
  heroSide: 'left' | 'right'
}) {
  return (
    <div className="pool-half-row">
      {heroSide === 'left' && <HeroMini row={row} />}
      {(row?.standard ?? []).map((slot, i) => (
        <AbilityTile key={i} slot={slot} />
      ))}
      {heroSide === 'right' && <HeroMini row={row} />}
    </div>
  )
}

/** Optional bundled pedestal texture (resources/data/stream/pool-slab.png|jpg),
 * blended faintly between the background art and the smoked-glass tint. */
function PoolSlab() {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="pool-slab"
      src={`${apiBase()}/art/pool-slab`}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

export function PoolBoard({ heroes }: { heroes: StreamHeroRow[] }) {
  const { t } = useTranslation()
  const byOrder = new Map(heroes.map((h) => [h.heroOrder, h]))

  return (
    <section className="pool-board" aria-label="Ability pool" data-edit-key="ability-pool">
      <PoolSlab />
      <div className="pool-section-title">
        <span>{t('pool.ultimates')}</span>
      </div>
      <div className="pool-ultimates">
        {ULT_ROWS.map((rowOrders, r) => (
          <div className="pool-ult-row" key={r}>
            {rowOrders.map((order) => {
              const ultimate = byOrder.get(order)?.ultimate
              return ultimate ? (
                <AbilityTile key={order} slot={ultimate} size="large" />
              ) : (
                <div className="tile tile-large tile-empty" key={order} />
              )
            })}
          </div>
        ))}
      </div>

      <div className="pool-section-title">
        <span>{t('pool.standard')}</span>
      </div>
      <div className="pool-standard">
        {STD_PAIRS.map(([left, right], r) => (
          <div className="pool-std-row" key={r}>
            <HalfRow row={byOrder.get(left)} heroSide="left" />
            <div className="pool-row-divider" />
            <HalfRow row={byOrder.get(right)} heroSide="right" />
          </div>
        ))}
      </div>
    </section>
  )
}
