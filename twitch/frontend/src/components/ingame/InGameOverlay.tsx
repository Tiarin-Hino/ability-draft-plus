import { useMemo } from 'react'
import type { TwitchCompactState, TwitchRichState } from '@shared/types/twitch'
import { useOverlayStore } from '../../app/store'
import {
  displayName,
  heroDisplayName,
  playerModel,
  playerName,
  refName,
  rowForSeat,
  teamOf,
} from '../../data/selectors'
import { projectTopBar } from '../../geometry/project'
import { TOPBAR_1080P } from '../../geometry/topbar-1080p'
import type { PxRect } from '../../geometry/types'
import { AbilityIcon } from '../common/Art'

// In-game: hit regions over the top-bar portraits; click one for that player's draft,
// or expand all ten. A player's draft renders as a vertical strip of ability tiles
// directly under their portrait (3 standard, then the ultimate) — the model needs no
// tile of its own, the portrait above IS the model. Ability tiles open the same
// details panel as during the draft.
//
// SEATS, NOT ROWS: portrait positions are top-bar SEATS (GSI slot order) while every
// payload array is keyed by DRAFT ROW, and the orders differ — measured live, seat 0
// was draft row 4, so reading players[seat] put Arc Warden's picks under Tusk. Each
// seat resolves through rowForSeat(); an unresolved seat renders nothing.

export function InGameOverlay({
  compact,
  rich,
  game,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  game: PxRect
}) {
  const tune = useOverlayStore((s) => s.config.ingame)
  const selection = useOverlayStore((s) => s.ui.selection)
  const expandAll = useOverlayStore((s) => s.ui.expandAll)
  const select = useOverlayStore((s) => s.select)
  const catalog = useOverlayStore((s) => s.catalog)

  const portraits = useMemo(() => projectTopBar(TOPBAR_1080P, game, tune), [game, tune])
  // Selection is stored as a DRAFT ROW (the identity every other view uses);
  // positioning the single expanded column needs that player's SEAT.
  const selectedPlayer = selection?.kind === 'player' ? selection.playerIndex : null
  const selectedSeat = useMemo(() => {
    if (selectedPlayer === null) return null
    for (let seat = 0; seat < portraits.length; seat++) {
      if (rowForSeat(compact, seat) === selectedPlayer) return seat
    }
    return null
  }, [compact, portraits.length, selectedPlayer])

  const column = (seat: number) => {
    const row = rowForSeat(compact, seat)
    if (row === null) return null
    const rect = portraits[seat]
    const size = Math.max(24, Math.min(44, Math.round(rect.w * 0.62)))
    return (
      <div
        key={seat}
        className={`pick-col team-${teamOf(seat)}`}
        style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h + 6 }}
      >
        <PlayerPickColumn compact={compact} rich={rich} playerIndex={row} size={size} />
      </div>
    )
  }

  return (
    <div className="hit-layer">
      {portraits.map((rect, seat) => {
        const row = rowForSeat(compact, seat)
        if (row === null) return null
        const model = playerModel(compact, row)
        const label = heroDisplayName(rich, catalog, model.cdn, model.heroOrder ?? undefined)
        const name = playerName(compact, rich, row)
        return (
          <button
            key={seat}
            type="button"
            className={`hit hit-portrait team-${teamOf(seat)}${selectedPlayer === row ? ' is-selected' : ''}`}
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            title={name ? `${name} · ${label}` : label}
            onClick={() => select(selectedPlayer === row ? null : { kind: 'player', playerIndex: row })}
          />
        )
      })}
      {expandAll
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(column)
        : selectedSeat !== null && column(selectedSeat)}
    </div>
  )
}

export function PlayerPickColumn({
  compact,
  rich,
  playerIndex,
  size,
}: {
  compact: TwitchCompactState
  rich: TwitchRichState | null
  playerIndex: number
  size: number
}) {
  const catalog = useOverlayStore((s) => s.catalog)
  const select = useOverlayStore((s) => s.select)
  const picks = compact.players?.[playerIndex]?.[1] ?? [null, null, null, null]

  return (
    <>
      {picks.map((ref, box) => {
        const pickName = refName(compact, ref)
        const label = pickName ? displayName(rich, catalog, pickName, typeof ref === 'number' ? ref : undefined) : 'Empty'
        const index = typeof ref === 'number' ? ref : null
        return (
          <button
            key={box}
            type="button"
            className={`pick-tile${box === 3 ? ' is-ult' : ''}${pickName ? '' : ' is-empty'}`}
            style={{ width: size, height: size }}
            title={label}
            disabled={index === null}
            onClick={() => index !== null && select({ kind: 'ability', i: index })}
          >
            {pickName ? <AbilityIcon name={pickName} label={label} size={size - 8} /> : null}
          </button>
        )
      })}
    </>
  )
}
