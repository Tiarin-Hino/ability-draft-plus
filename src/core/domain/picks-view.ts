import type {
  PicksAbility,
  PicksPlayer,
  PicksViewState,
  StreamAbilitySlot,
  StreamBoardState,
} from '@shared/types/stream'

// @DEV-GUIDE: Pure derivation of the Picks View snapshot (Streamer View № 2) from a
// built stream board state. The caller (stream-server-service) derives a snapshot from
// every 'drafting' board build and CACHES it: unlike the board, the picks strips must
// keep showing the finished draft after the overlay session is reset or closed, so the
// snapshot is only ever REPLACED by a newer drafting build (a new draft's initial scan
// naturally starts the next snapshot) — never cleared. Keep this derivation total and
// cheap; it runs on every board build.

function toPicksAbility(slot: StreamAbilitySlot): PicksAbility {
  return {
    name: slot.name,
    displayName: slot.displayName,
    iconPath: slot.iconPath,
    isUnknown: slot.isUnknown,
  }
}

/**
 * Project a full board state down to the picks strips' snapshot.
 * Returns null for non-drafting states — the caller keeps its previous snapshot.
 */
export function buildPicksViewState(board: StreamBoardState): PicksViewState | null {
  if (board.phase !== 'drafting') return null

  const players: PicksPlayer[] = board.players.map((player) => ({
    playerIndex: player.playerIndex,
    team: player.team,
    playerName: player.playerName,
    heroDisplayName: player.model?.displayName ?? null,
    portraitPath: player.model?.portraitPath ?? null,
    picks: player.picks.map((pick) => (pick ? toPicksAbility(pick) : null)),
  }))

  return { players, meta: board.meta }
}
