import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { StreamServerService } from './stream-server-service'
import type { ScanTriggerService } from './scan-trigger-service'
import type { AppStore } from '../store/app-store'
import { GSI_HERO_SELECTION_PHASE } from '@core/gsi/types'
import {
  buildTurnSchedule,
  elapsedTurnsBetween,
  type TurnWindow,
} from '@core/gsi/draft-clock'
import { attributePicks } from '@core/domain/pick-attribution'
import { AUTO_RESCAN_INTERVAL_MS } from '@shared/constants/thresholds'

// @DEV-GUIDE: EXPERIMENTAL GSI-driven auto-rescan + pick attribution (disabled by
// default — experimentalAutoDraftTracking setting). Every 5s during an active draft it
// triggers the same rescan pipeline as Ctrl+Shift+R and attributes pool departures to
// players via the draft turn clock.
//
// Gates per tick (ALL must hold): setting on, overlay active, GSI connected and in
// hero selection, an initial scan done (the pool grid is still the user's Ctrl+Shift+S),
// and ML idle. The capture is NEVER protected by moving the user's mouse — instead the
// scan-processor's contamination guard discards any rescan where a previously
// confident pick slot reads unknown (an in-game hover tooltip covered the tiles), and
// this service skips attribution for that tick (DraftStore.lastRescanRejected) and
// simply retries a few seconds later.
//
// Draft sessions are keyed by GSI matchid (replay seeking flaps game_state); the
// anchor is wall clock at the first hero-selection entry per match. Turn schedule
// constants are still being validated against captures (see draft-clock.ts).
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
): AutoRescanService {
  let timer: NodeJS.Timeout | null = null
  let tickRunning = false

  const schedule: TurnWindow[] = buildTurnSchedule()
  let draftAnchorMs: number | null = null
  let lastAttributedS = 0
  let nextSeq = 0
  let lastPhase: string | null = null
  let draftMatchId: string | null = null

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

      const elapsedS = (Date.now() - draftAnchorMs) / 1000

      const scheduleEndS = schedule[schedule.length - 1].endS
      if (elapsedS > scheduleEndS + 30) {
        // Draft is definitely over even if GSI hasn't left hero selection yet
        return
      }

      const prevPool = poolNames()
      await scanTrigger.performScan(false)

      if (draftStore.getState().lastRescanRejected) {
        // Contamination guard fired (hover tooltip over the pick slots) — this
        // capture is void. Do not advance attribution; retry next tick.
        logger.info('Rescan discarded by contamination guard; retrying next tick')
        return
      }

      const newPool = poolNames()

      // Attribution is DEPARTURE-driven: a scan without pool departures carries
      // no pick information (picks land ~7s apart vs the 5s scan cadence), so
      // turns simply keep accumulating until the next departure shows up.
      // Model picks are observed directly via GSI now, so no synthetic
      // modelSelectionMarker events are emitted from clock guesses anymore —
      // elapsed turns are capped to the number of departures.
      const newPoolSet = new Set(newPool)
      const departedCount = prevPool.filter((n) => !newPoolSet.has(n)).length
      if (departedCount === 0) {
        return
      }

      const elapsedTurns = elapsedTurnsBetween(
        schedule,
        lastAttributedS,
        elapsedS,
      ).slice(0, departedCount)

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
        logger.info('Attributed picks', { events: events.length })
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
