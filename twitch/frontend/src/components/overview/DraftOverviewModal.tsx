import { useEffect, useRef } from 'react'
import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import {
  displayName,
  heroDisplayName,
  isModelPicked,
  pickOrder,
  playerModel,
  playerName,
  poolIndex,
  slotByIndex,
} from '../../data/selectors'
import { STD_PAIRS, ULT_ROWS } from '../../geometry/pool-arrangement'
import { AbilityIcon, HeroPortrait } from '../common/Art'

// Full pool in the game's canonical arrangement + the attributed pick order.

/** "picked <hero>" when the player's model is known; the generic text otherwise. */
function modelPickLabel(
  compact: TwitchCompactState,
  rich: TwitchRichState | null,
  catalog: ReturnType<typeof useOverlayStore.getState>['catalog'],
  playerIndex: number,
): string {
  const model = playerModel(compact, playerIndex)
  return model.cdn
    ? `picked ${heroDisplayName(rich, catalog, model.cdn, model.heroOrder ?? undefined)}`
    : 'picked a hero model'
}

export function DraftOverviewModal({
  compact,
  rich,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
}) {
  const setOverview = useOverlayStore((s) => s.setOverview)
  const catalog = useOverlayStore((s) => s.catalog)
  const select = useOverlayStore((s) => s.select)
  const order = pickOrder(compact)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverview(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOverview])

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [order.length])

  const tile = (heroOrder: number, k: number, large = false) => {
    const i = poolIndex(heroOrder, k)
    const slot = slotByIndex(compact, i)
    const label = displayName(rich, catalog, slot?.name ?? null, i)
    return (
      <button
        key={i}
        type="button"
        className={`ov-tile${large ? ' is-large' : ''}${slot?.picked ? ' is-picked' : ''}${slot?.name ? '' : ' is-unknown'}`}
        title={label}
        disabled={!slot?.name}
        onClick={() => select({ kind: 'ability', i })}
      >
        <AbilityIcon name={slot?.name ?? null} label={label} size={large ? 44 : 36} />
      </button>
    )
  }

  const heroMini = (heroOrder: number) => {
    const cdn = compact.pool?.[heroOrder]?.[0] ?? null
    const label = heroDisplayName(rich, catalog, cdn, heroOrder)
    return (
      <button
        key={`h${heroOrder}`}
        type="button"
        className={`ov-hero${isModelPicked(compact, heroOrder) ? ' is-picked' : ''}`}
        title={label}
        onClick={() => select({ kind: 'hero', heroOrder })}
      >
        <HeroPortrait cdn={cdn} label={label} width={54} height={30} />
      </button>
    )
  }

  return (
    <div className="modal-backdrop" onClick={() => setOverview(false)}>
      <div className="modal ov-modal" role="dialog" aria-label="Draft overview" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Draft overview</h2>
          <button type="button" className="details-close" onClick={() => setOverview(false)} aria-label="Close">
            ×
          </button>
        </header>
        <div className="ov-body">
          <div className="ov-pool">
            <h3 className="details-subtitle">Ultimates</h3>
            {ULT_ROWS.map((row, r) => (
              <div key={r} className="ov-row ov-ults">
                {row.map((heroOrder) => tile(heroOrder, 0, true))}
              </div>
            ))}
            <h3 className="details-subtitle">Standard abilities</h3>
            {STD_PAIRS.map(([left, right]) => (
              <div key={`${left}-${right}`} className="ov-row ov-std">
                {heroMini(left)}
                {[1, 2, 3].map((k) => tile(left, k))}
                <span className="ov-gap" />
                {[1, 2, 3].map((k) => tile(right, k))}
                {heroMini(right)}
              </div>
            ))}
          </div>
          <div className="ov-order">
            <h3 className="details-subtitle">Pick order</h3>
            {order.length === 0 ? (
              <p className="muted">
                Pick order isn't available for this draft (the streamer's automatic draft tracking is off).
              </p>
            ) : (
              <ol ref={listRef} className="order-list">
                {order.map((entry) => (
                  <li key={entry.seq} className={`order-row team-${entry.team}`}>
                    <span className="order-num">{entry.seq + 1}</span>
                    <span className="order-player">
                      {playerName(compact, rich, entry.playerIndex) ?? `Player ${entry.playerIndex + 1}`}
                    </span>
                    <span className="order-pick">
                      {entry.isModelMarker
                        ? modelPickLabel(compact, rich, catalog, entry.playerIndex)
                        : entry.name === ''
                          ? 'unknown ability'
                          : displayName(rich, catalog, entry.name)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
