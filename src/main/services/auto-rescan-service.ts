import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { StreamServerService } from './stream-server-service'
import type { ScanTriggerService } from './scan-trigger-service'
import type { AppStore } from '../store/app-store'
import { GSI_HERO_SELECTION_PHASE } from '@core/gsi/types'
import { gsiSnapshotMode } from '@core/gsi/parser'
import {
  buildTurnSchedule,
  turnsEndedBetween,
  type TurnWindow,
} from '@core/gsi/draft-clock'
import { attributePicksByRow } from '@core/domain/pick-attribution'
import {
  AUTO_RESCAN_TICK_MS,
  AUTO_RESCAN_PICK_VISIBLE_DELAY_S,
  AUTO_RESCAN_MAX_TARGET_RETRIES,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: EXPERIMENTAL GSI-driven TURN-CLOCK auto-rescan (disabled by default —
// experimentalAutoDraftTracking setting). Instead of blind full rescans on a timer,
// scans fire when the draft clock says a pick just happened, and cover ONLY the rows
// that can have changed:
// - The pick phase is anchored to GSI map.clock_time crossing 0 (the -59..0 ramp is
//   the preview; see draft-clock.ts for the validated schedule constants).
// - When a turn ends (+AUTO_RESCAN_PICK_VISIBLE_DELAY_S for the icon to render),
//   that player's row is queued and a TARGETED rescan of the queued rows runs
//   (~4 slots instead of 40).
// - When a round's last turn ends, a FULL 40-slot reconciliation rescan runs in the
//   5s round break, catching anything the targeted scans missed (clock drift, hasty
//   retries that hit the cap).
// - Attribution is a ROW DIFF (pick-attribution.ts): a new name in row X IS player
//   X's pick. The clock never guesses who picked what — it only decides when/where
//   to look, so clock drift can delay detection but never mis-attribute.
// Contaminated captures (hover tooltip; scan-processor guard) and hasty no-ops keep
// the queued rows and retry next tick, up to AUTO_RESCAN_MAX_TARGET_RETRIES.
//
// Gates per tick (ALL must hold): setting on, overlay active, initial scan done
// (the pool grid is still the user's Ctrl+Shift+S), ML idle, GSI connected and in
// hero selection, pick-phase anchor set. Draft sessions are keyed by GSI matchid
// (replay seeking flaps game_state); clock/pending state resets per new match.

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
): AutoRescanService {
  let timer: NodeJS.Timeout | null = null
  let tickRunning = false

  const schedule: TurnWindow[] = buildTurnSchedule()
  const scheduleEndS = schedule[schedule.length - 1].endS

  let draftMatchId: string | null = null
  let lastPhase: string | null = null
  /** Wall-clock ms of the pick-phase start (GSI clock_time crossing 0). */
  let pickAnchorMs: number | null = null
  /** Seconds (pick-phase relative) up to which turn ends have been queued. */
  let queuedUpToS = 0
  /** Player rows queued for a targeted rescan (turn ended, pick not yet read). */
  const pendingRows = new Set<number>()
  /** True when a queued turn completed a round — escalate to a full rescan. */
  let fullScanDue = false
  let targetRetries = 0

  function resetDraftSession(): void {
    pickAnchorMs = null
    queuedUpToS = 0
    pendingRows.clear()
    fullScanDue = false
    targetRetries = 0
  }

  streamService.onGsiSnapshot((snapshot) => {
    // Pick-phase anchor: clock_time runs -59 -> 0 during the preview; the first
    // turn starts at 0. While the clock reports positive values the anchor is
    // continuously re-derived (self-corrects pauses/drift); a clock frozen at 0
    // sets it exactly once, at the crossing.
    if (
      snapshot.gamePhase === GSI_HERO_SELECTION_PHASE &&
      snapshot.clockTime !== null &&
      snapshot.clockTime >= 0 &&
      (pickAnchorMs === null || snapshot.clockTime > 0)
    ) {
      if (pickAnchorMs === null) {
        logger.info('Pick phase anchored (clock crossed zero)', {
          clockTime: snapshot.clockTime,
        })
      }
      pickAnchorMs = Date.now() - snapshot.clockTime * 1000
    }

    if (snapshot.gamePhase === lastPhase) return
    const prevPhase = lastPhase
    lastPhase = snapshot.gamePhase

    if (snapshot.gamePhase === GSI_HERO_SELECTION_PHASE) {
      // Replay seeking / directed camera makes game_state flap in and out of hero
      // selection every few seconds. Only a DIFFERENT matchid (or the very first
      // entry) is a new draft; re-entries keep the anchor and timeline.
      const isSameDraft =
        draftMatchId !== null &&
        snapshot.matchId !== null &&
        snapshot.matchId === draftMatchId
      if (isSameDraft) {
        logger.info('Re-entered hero selection (same match, keeping session)', {
          matchId: snapshot.matchId,
        })
        return
      }
      draftMatchId = snapshot.matchId
      resetDraftSession()
      draftStore.getState().clearDraftTimeline()
      logger.info('Draft started (GSI hero selection)', {
        prevPhase,
        matchId: snapshot.matchId,
        mode: gsiSnapshotMode(snapshot),
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

  async function tick(): Promise<void> {
    if (tickRunning) return
    tickRunning = true
    try {
      const settings = dbService.metadata.getSettings()
      if (!settings.experimentalAutoDraftTracking) return
      if (!appStore.getState().overlayActive) return
      if (appStore.getState().mlStatus !== 'ready') return
      if (pickAnchorMs === null) return

      const { snapshot, connected } = streamService.getGsiState()
      if (!connected || snapshot?.gamePhase !== GSI_HERO_SELECTION_PHASE) return

      // The pool grid is still the user's manual initial scan (Ctrl+Shift+S)
      if (poolNames().length === 0) return

      const elapsedS = (Date.now() - pickAnchorMs) / 1000
      if (elapsedS > scheduleEndS + 30) {
        // Draft is definitely over even if GSI hasn't left hero selection yet
        return
      }

      // Queue rows whose turn ended long enough ago for the icon to be visible
      const visibleUpToS = elapsedS - AUTO_RESCAN_PICK_VISIBLE_DELAY_S
      if (visibleUpToS > queuedUpToS) {
        const ended = turnsEndedBetween(schedule, queuedUpToS, visibleUpToS)
        for (const turn of ended) {
          pendingRows.add(turn.playerIndex)
          // Last turn of a round -> reconcile the whole board in the 5s break
          if (turn.seq % 10 === 9) fullScanDue = true
        }
        queuedUpToS = visibleUpToS
      }

      if (pendingRows.size === 0 && !fullScanDue) return

      const store = draftStore.getState()
      const prevSelected = store.selectedAbilitiesCache
      const heroOrders = fullScanDue ? undefined : [...pendingRows]

      await scanTrigger.performScan(false, { heroOrders })

      const after = draftStore.getState()
      if (after.lastRescanRejected || after.lastRescanHasty) {
        // Tooltip over the rows — capture void, state untouched. Retry next
        // tick; past the cap, drop and let the round-break full scan catch up.
        targetRetries += 1
        if (targetRetries > AUTO_RESCAN_MAX_TARGET_RETRIES) {
          logger.warn('Targeted rescan retry cap hit; deferring to round break', {
            rows: [...pendingRows],
          })
          pendingRows.clear()
          fullScanDue = false
          targetRetries = 0
        }
        return
      }

      const events = attributePicksByRow({
        prevSelected,
        nextSelected: after.selectedAbilitiesCache,
        nextSeq: after.draftTimeline.length,
        clockTime: snapshot.clockTime,
      })

      logger.info('Turn-driven rescan complete', {
        targeted: heroOrders ?? 'full',
        newPicks: events.length,
        clockTime: snapshot.clockTime,
        elapsedS: Math.round(elapsedS),
      })

      pendingRows.clear()
      fullScanDue = false
      targetRetries = 0

      if (events.length > 0) {
        draftStore.getState().appendPickEvents(events)
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
      timer = setInterval(() => void tick(), AUTO_RESCAN_TICK_MS)
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
