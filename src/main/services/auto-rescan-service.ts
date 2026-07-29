import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { StreamServerService } from './stream-server-service'
import type { ScanTriggerService } from './scan-trigger-service'
import type { CursorParker } from './cursor-parker'
import type { AppStore } from '../store/app-store'
import type { GsiSnapshot } from '@core/gsi/types'
import { GSI_HERO_SELECTION_PHASE } from '@core/gsi/types'
import {
  buildTurnSchedule,
  turnAt,
  elapsedTurnsBetween,
  type TurnWindow,
} from '@core/gsi/draft-clock'
import { attributePicks } from '@core/domain/pick-attribution'
import { AUTO_RESCAN_INTERVAL_MS } from '@shared/constants/thresholds'

// @DEV-GUIDE: EXPERIMENTAL GSI-driven auto-rescan + pick attribution (disabled by
// default — experimentalAutoDraftTracking setting). Every 5s during an active draft it
// triggers the same rescan pipeline as Ctrl+Shift+R, with the cursor parked during the
// screenshot, then attributes pool departures to players via the draft turn clock.
//
// Gates per tick (ALL must hold): setting on, overlay active, GSI connected and in
// hero selection, an initial scan done (the pool grid is still the user's Ctrl+Shift+S),
// ML idle, the user's slot known, and it is NOT the user's turn (cursor parking during
// their own pick would be hostile — suppression is the no-BlockInput mitigation).
//
// User slot resolution: GSI local player matched into allplayers by accountid
// (spectating), else the manual My Spot selection (mySelectedSpotHeroOrder IS the
// player slot 0-9). Unknown slot -> no auto-rescan at all (fail safe).
//
// Draft anchor: wall clock at the GSI transition INTO hero selection. The turn
// schedule constants are UNVALIDATED (see draft-clock.ts) — this whole service is
// opt-in experimental until the capture spike tunes them.
//
// Known drift source: manual rescans between ticks shrink the pool outside our
// prev/next diff, surfacing later as spurious model markers. Logged, accepted for v1;
// attribution is recomputable and the board's snapshot grouping is unaffected.

const logger = log.scope('auto-rescan')

export interface AutoRescanService {
  start(): void
  stop(): void
}

export function createAutoRescanService(
  appStore: AppStore,
  draftStore: StoreApi<DraftStore>,
  dbService: DatabaseService,
  streamService: StreamServerService,
  scanTrigger: ScanTriggerService,
  cursorParker: CursorParker,
): AutoRescanService {
  let timer: NodeJS.Timeout | null = null
  let tickRunning = false

  const schedule: TurnWindow[] = buildTurnSchedule()
  let draftAnchorMs: number | null = null
  let lastAttributedS = 0
  let nextSeq = 0
  let lastPhase: string | null = null
  let draftMatchId: string | null = null
  let warnedNoSlot = false

  streamService.onGsiSnapshot((snapshot) => {
    if (snapshot.gamePhase === lastPhase) return
    const prevPhase = lastPhase
    lastPhase = snapshot.gamePhase

    if (snapshot.gamePhase === GSI_HERO_SELECTION_PHASE) {
      // Replay seeking / directed camera makes game_state flap in and out of hero
      // selection every few seconds. Only a DIFFERENT matchid (or the very first
      // entry) is a new draft; re-entries keep the anchor and timeline.
      const isSameDraft =
        draftAnchorMs !== null &&
        snapshot.matchId !== null &&
        snapshot.matchId === draftMatchId
      if (isSameDraft) {
        logger.info('Re-entered hero selection (same match, keeping session)', {
          matchId: snapshot.matchId,
        })
        return
      }
      draftAnchorMs = Date.now()
      draftMatchId = snapshot.matchId
      lastAttributedS = 0
      nextSeq = 0
      warnedNoSlot = false
      draftStore.getState().clearDraftTimeline()
      logger.info('Draft started (GSI hero selection)', {
        prevPhase,
        matchId: snapshot.matchId,
      })
    } else if (prevPhase === GSI_HERO_SELECTION_PHASE) {
      logger.info('Left hero selection (session retained for possible re-entry)', {
        nextPhase: snapshot.gamePhase,
      })
    }
  })

  function poolNames(): string[] {
    const cache = draftStore.getState().initialPoolAbilitiesCache
    return [...cache.ultimates, ...cache.standard]
      .map((slot) => slot.name)
      .filter((name): name is string => name !== null)
  }

  /** Pure spectator: allplayers present but no local player — there is no own turn. */
  function isSpectating(snapshot: GsiSnapshot | null): boolean {
    return (
      snapshot !== null &&
      snapshot.players.length > 0 &&
      snapshot.localPlayer === null
    )
  }

  function resolveUserSlot(snapshot: GsiSnapshot | null): number | null {
    if (snapshot?.localPlayer?.accountId) {
      const match = snapshot.players.find(
        (p) => p.accountId === snapshot.localPlayer?.accountId,
      )
      if (match) return match.slotIndex
    }
    return draftStore.getState().mySelectedSpotHeroOrder
  }

  async function tick(): Promise<void> {
    if (tickRunning) return
    tickRunning = true
    try {
      const settings = dbService.metadata.getSettings()
      if (!settings.experimentalAutoDraftTracking) return
      if (!appStore.getState().overlayActive) return
      if (appStore.getState().mlStatus !== 'ready') return
      if (draftAnchorMs === null) return

      const { snapshot, connected } = streamService.getGsiState()
      if (!connected || snapshot?.gamePhase !== GSI_HERO_SELECTION_PHASE) return

      // The pool grid is still the user's manual initial scan (Ctrl+Shift+S)
      if (poolNames().length === 0) return

      // Spectators/casters have no pick turn to protect — scan without suppression.
      // Only a PLAYING user with an unknown slot forces idle (cursor parking during
      // their own pick would be hostile and we cannot tell when their turn is).
      const spectating = isSpectating(snapshot)
      const userSlot = spectating ? null : resolveUserSlot(snapshot)
      if (!spectating && userSlot === null) {
        if (!warnedNoSlot) {
          warnedNoSlot = true
          logger.warn('Auto-rescan idle: playing with unknown slot — select My Spot')
        }
        return
      }

      const elapsedS = (Date.now() - draftAnchorMs) / 1000
      const currentTurn = turnAt(elapsedS, schedule)

      const scheduleEndS = schedule[schedule.length - 1].endS
      if (elapsedS > scheduleEndS + 30) {
        // Draft is definitely over even if GSI hasn't left hero selection yet
        return
      }

      if (userSlot !== null && currentTurn?.playerIndex === userSlot) {
        // Suppressed: never park the cursor during the user's own pick
        return
      }

      const prevPool = poolNames()
      await scanTrigger.performScan(false, {
        beforeCapture: () => cursorParker.park(),
        afterCapture: () => cursorParker.restore(),
      })
      const newPool = poolNames()

      const elapsedTurns = elapsedTurnsBetween(schedule, lastAttributedS, elapsedS)
      if (elapsedTurns.length === 0 && prevPool.length === newPool.length) {
        return
      }

      const { events, unattributed } = attributePicks({
        prevPoolNames: prevPool,
        newPoolNames: newPool,
        elapsedTurns,
        nextSeq,
        clockTime: snapshot.clockTime,
      })
      lastAttributedS = elapsedS
      nextSeq += events.length

      if (events.length > 0) {
        draftStore.getState().appendPickEvents(events)
        logger.info('Attributed picks', {
          events: events.length,
          markers: events.filter((e) => e.kind === 'modelSelectionMarker').length,
        })
      }
      if (unattributed.length > 0) {
        logger.warn('Unattributed pool departures (attribution drift)', {
          abilities: unattributed,
        })
      }
      streamService.refresh()
    } catch (error) {
      logger.error('Auto-rescan tick failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      tickRunning = false
    }
  }

  return {
    start(): void {
      if (timer) return
      timer = setInterval(() => void tick(), AUTO_RESCAN_INTERVAL_MS)
      logger.info('Auto-rescan service armed (gated by experimental setting)')
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
