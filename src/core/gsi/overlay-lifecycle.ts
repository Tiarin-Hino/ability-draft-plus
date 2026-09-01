// @DEV-GUIDE: Pure decision logic for the overlay auto-close feature (GSI-
// driven, zero Electron imports). With auto draft tracking on, the overlay
// closes itself when the draft ends (no manual close between matches) and
// reopens when the match finishes OR a new draft starts — whichever comes
// first. Rules that keep it polite:
// - Close only on the HERO_SELECTION -> post-draft TRANSITION. A user who
//   manually reopens the overlay mid-game is never fought (no transition
//   fires again), and an overlay opened mid-game for any reason stays.
// - Reopen ONLY if the close was ours (autoClosedMatchId set). A manual
//   close is the user's call and stays closed.
// - A new draft is a HERO_SELECTION with a DIFFERENT matchId (or unknown
//   ids); the same matchId re-entering HERO_SELECTION is replay flapping.
// The main-process wiring additionally suppresses the control-panel restore
// on auto-close (the game is starting — stealing focus would alt-tab the
// player out) and gates the whole feature on settings.

export const GSI_POST_DRAFT_PHASES: ReadonlySet<string> = new Set([
  'DOTA_GAMERULES_STATE_STRATEGY_TIME',
  'DOTA_GAMERULES_STATE_TEAM_SHOWCASE',
  'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD',
  'DOTA_GAMERULES_STATE_PRE_GAME',
  'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
])

export const GSI_POST_GAME_PHASE = 'DOTA_GAMERULES_STATE_POST_GAME'
const HERO_SELECTION = 'DOTA_GAMERULES_STATE_HERO_SELECTION'

export interface OverlayLifecycleState {
  /** Phase from the previous snapshot (transition detection). */
  lastPhase: string | null
  /** matchId whose draft-end WE closed the overlay for; null = no debt. */
  autoClosedMatchId: string | null
  /** True when the auto-close happened without a known matchId. */
  autoClosedUnknownMatch: boolean
}

export type OverlayLifecycleAction = 'close' | 'open' | null

export function initialOverlayLifecycleState(): OverlayLifecycleState {
  return { lastPhase: null, autoClosedMatchId: null, autoClosedUnknownMatch: false }
}

/**
 * Feed one GSI snapshot; returns the action to take (if any) and the next
 * state. Feed EVERY snapshot, enabled or not, so phase transitions stay
 * accurate; while disabled no action is ever emitted and no reopen debt
 * accrues (disabling mid-cycle also clears an outstanding debt).
 */
export function nextOverlayLifecycle(
  state: OverlayLifecycleState,
  snapshot: { gamePhase: string | null; matchId: string | null },
  overlayActive: boolean,
  enabled: boolean,
): { action: OverlayLifecycleAction; state: OverlayLifecycleState } {
  const phase = snapshot.gamePhase
  const next: OverlayLifecycleState = { ...state, lastPhase: phase ?? state.lastPhase }

  if (!enabled) {
    next.autoClosedMatchId = null
    next.autoClosedUnknownMatch = false
    return { action: null, state: next }
  }

  if (phase === null) return { action: null, state: next }

  // Draft just ended (transition out of HERO_SELECTION into the match)
  if (
    overlayActive &&
    state.lastPhase === HERO_SELECTION &&
    GSI_POST_DRAFT_PHASES.has(phase)
  ) {
    next.autoClosedMatchId = snapshot.matchId
    next.autoClosedUnknownMatch = snapshot.matchId === null
    return { action: 'close', state: next }
  }

  // We owe the user a reopen?
  const closedByUs = state.autoClosedMatchId !== null || state.autoClosedUnknownMatch
  if (!overlayActive && closedByUs) {
    const matchEnded = phase === GSI_POST_GAME_PHASE
    const newDraft =
      phase === HERO_SELECTION &&
      (snapshot.matchId === null ||
        state.autoClosedMatchId === null ||
        snapshot.matchId !== state.autoClosedMatchId)
    if (matchEnded || newDraft) {
      next.autoClosedMatchId = null
      next.autoClosedUnknownMatch = false
      return { action: 'open', state: next }
    }
  }

  // Overlay reappeared by other means (manual reopen) — debt is settled.
  if (overlayActive && closedByUs) {
    next.autoClosedMatchId = null
    next.autoClosedUnknownMatch = false
  }

  return { action: null, state: next }
}
