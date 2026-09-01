import { describe, it, expect } from 'vitest'
import {
  initialOverlayLifecycleState,
  nextOverlayLifecycle,
  type OverlayLifecycleState,
} from '@core/gsi/overlay-lifecycle'

const HERO_SELECTION = 'DOTA_GAMERULES_STATE_HERO_SELECTION'
const STRATEGY = 'DOTA_GAMERULES_STATE_STRATEGY_TIME'
const IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME'

function feed(
  state: OverlayLifecycleState,
  phase: string | null,
  matchId: string | null,
  overlayActive: boolean,
  enabled = true,
) {
  return nextOverlayLifecycle(state, { gamePhase: phase, matchId }, overlayActive, enabled)
}

describe('overlay lifecycle (GSI auto-close)', () => {
  it('closes on the draft-end transition and reopens at match end', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    const closed = feed(s, STRATEGY, 'm1', true)
    expect(closed.action).toBe('close')
    s = closed.state

    // Mid-game snapshots do nothing while we hold the debt
    expect(feed(s, IN_PROGRESS, 'm1', false).action).toBeNull()
    ;({ state: s } = feed(s, IN_PROGRESS, 'm1', false))

    const reopened = feed(s, POST_GAME, 'm1', false)
    expect(reopened.action).toBe('open')
    expect(reopened.state.autoClosedMatchId).toBeNull()
  })

  it('reopens on a NEW draft, not on the same match flapping back', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    ;({ state: s } = feed(s, STRATEGY, 'm1', true)) // close fires
    // Replay seek back into the same match's hero selection: stay closed
    expect(feed(s, HERO_SELECTION, 'm1', false).action).toBeNull()
    // A different match's draft: reopen
    expect(feed(s, HERO_SELECTION, 'm2', false).action).toBe('open')
  })

  it('never fights a manual reopen mid-game', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    ;({ state: s } = feed(s, STRATEGY, 'm1', true)) // auto-close
    // User manually reopened: overlay active during the game — no close action
    // (no HERO_SELECTION transition), and the reopen debt is settled
    const r = feed(s, IN_PROGRESS, 'm1', true)
    expect(r.action).toBeNull()
    expect(r.state.autoClosedMatchId).toBeNull()
    // ...so a manual close later stays closed at POST_GAME
    expect(feed(r.state, POST_GAME, 'm1', false).action).toBeNull()
  })

  it('does not close an overlay opened mid-game (no draft-end transition)', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, IN_PROGRESS, 'm1', false))
    expect(feed(s, IN_PROGRESS, 'm1', true).action).toBeNull()
  })

  it('a manual close owes no reopen', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    // Overlay reads inactive at the transition (user closed it during draft)
    const r = feed(s, STRATEGY, 'm1', false)
    expect(r.action).toBeNull()
    expect(feed(r.state, POST_GAME, 'm1', false).action).toBeNull()
  })

  it('unknown matchIds still close and reopen on the next draft', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, null, true))
    const closed = feed(s, STRATEGY, null, true)
    expect(closed.action).toBe('close')
    expect(feed(closed.state, HERO_SELECTION, null, false).action).toBe('open')
  })

  it('disabled: emits nothing and clears any outstanding debt', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    ;({ state: s } = feed(s, STRATEGY, 'm1', true)) // close fires, debt held
    const off = feed(s, POST_GAME, 'm1', false, false)
    expect(off.action).toBeNull()
    expect(off.state.autoClosedMatchId).toBeNull()
    // Re-enabling later does not resurrect the old debt
    expect(feed(off.state, POST_GAME, 'm1', false, true).action).toBeNull()
  })

  it('tolerates null phases without losing transition context', () => {
    let s = initialOverlayLifecycleState()
    ;({ state: s } = feed(s, HERO_SELECTION, 'm1', true))
    ;({ state: s } = feed(s, null, null, true)) // absent map block
    // lastPhase retained -> the next post-draft phase still closes
    expect(feed(s, STRATEGY, 'm1', true).action).toBe('close')
  })
})
