import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { StreamServerService } from './stream-server-service'
import type { ScanTriggerService } from './scan-trigger-service'
import type { OcrService } from './ocr-service'
import type { AppStore } from '../store/app-store'
import { GSI_HERO_SELECTION_PHASE } from '@core/gsi/types'
import type { GsiSnapshot } from '@core/gsi/types'
import { gsiSnapshotMode } from '@core/gsi/parser'
import {
  buildTurnSchedule,
  turnsEndedBetween,
  countdownTargetRow,
  type TurnWindow,
} from '@core/gsi/draft-clock'
import { reconcileAbilityPicks } from '@core/domain/pick-attribution'
import {
  resolveModelAssignments,
  reconcileModelMarkers,
} from '@core/domain/model-picks-from-ocr'
import type { PickEvent } from '@shared/types/stream'
import {
  AUTO_RESCAN_TICK_MS,
  AUTO_RESCAN_PICK_VISIBLE_DELAY_S,
  AUTO_RESCAN_MAX_TARGET_RETRIES,
  AUTO_RESCAN_REPLAY_INTERVAL_MS,
  REPLAY_CLOCK_REWIND_THRESHOLD_S,
  OCR_SETTLE_TIMEOUT_MS,
  OCR_FINAL_PASS_SETTLE_TIMEOUT_MS,
  DRAFT_FINAL_PASS_TIMEOUT_MS,
  DRAFT_FINAL_RESCAN_TIMEOUT_MS,
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
// - Attribution is by CARD SLOT (pick-attribution.ts): a new name in row X IS
//   player X's pick. Standard boxes count as a SET (Dota reorders them), the
//   ultimate box singly; a name that vanishes with every box readable is renamed
//   (misread) or removed (phantom). The clock never guesses who picked what.
// - ORDER: every new pick is stamped with `seenAtS` (seconds since the anchor at
//   capture start) and the draft store places it at its player's serpentine turn
//   (orderByDraftTurns), so late or batched discovery never reorders the history
//   and a pick that is never read leaves a gap instead of shifting later picks.
//   No anchor (replay, mid-draft join) -> unstamped -> placed by pick count.
// Contaminated captures (hover tooltip; scan-processor guard) and hasty no-ops keep
// the queued rows and retry next tick, up to AUTO_RESCAN_MAX_TARGET_RETRIES.
//
// Fallback auto INITIAL scan: if the user never pressed the initial-scan hotkey,
// the pool is scanned automatically autoInitialScanDelayS (setting) after the draft
// clock is first identified (hero selection + clock_time present) — one attempt per draft.
//
// Three session kinds:
// - PLAYING: turn-driven targeted scanning (the headline path).
// - SPECTATING (live): same turn-driven scanning — a live spectated draft runs on
//   the real turn clock.
// - REPLAY: auto-detected, not a GSI mode — a spectated draft whose clock REWINDS
//   by more than REPLAY_CLOCK_REWIND_THRESHOLD_S (seeking; observed live: clock
//   back at -59 with the schedule at 38s). Sticky for the rest of the draft
//   session; falls back to plain periodic FULL rescans
//   (AUTO_RESCAN_REPLAY_INTERVAL_MS) with the same row-diff attribution.
// MODEL PICKS: in PLAYING mode they are read off the drafter's card — every
// capture's name strips are OCR'd, the rescan waits for that (settle) and applies
// the reads via core/domain/model-picks-from-ocr.ts, so a model pick is sequenced
// before the ability picks found in the same capture. No tile state, no turn
// timing. In spectate GSI reports every hero and slot-mapping-service emits the
// markers instead.
// NEW MATCH: GSI hero selection with a different matchid clears the whole draft
// session (resetDraftState — pool, board, slot mapping), not just this service's
// clock state, so the auto initial scan runs for the new draft. Nothing else
// resets a session in background mode, and a game closed mid-draft never
// reaches the draft end either.
// DRAFT END: the last turn's scheduled scan always falls AFTER GSI leaves hero
// selection, so finalizeDraft() runs one last capture on that transition — and
// overlay auto-close awaits it, because closing the overlay ends capture. That
// capture waits for card OCR to DRAIN (OCR_FINAL_PASS_SETTLE_TIMEOUT_MS, not the
// per-scan 1.5s): a strip still queued when auto-close resets the session is
// dropped, and that was how most last-turn model picks went missing.
//
// Gates per tick (ALL must hold): setting on, overlay active, ML idle, GSI
// connected and in hero selection; the turn logic additionally needs an initial
// scan done and the pick-phase anchor set. Draft sessions are keyed by GSI matchid
// (replay seeking flaps game_state); clock/pending state resets per new match.

const logger = log.scope('auto-rescan')

export interface AutoRescanService {
  start(): void
  stop(): void
  /**
   * One final capture + card OCR when hero selection ends, so the last picks
   * land before the overlay may close. Idempotent per draft (every caller gets
   * the same promise), bounded by DRAFT_FINAL_PASS_TIMEOUT_MS, never rejects.
   */
  finalizeDraft(): Promise<void>
  /**
   * Re-arm for the CURRENT draft after a manual draft reset (overlay Reset
   * button, control panel): the auto initial scan runs again once the draft
   * clock is seen. The match identity is kept, so the same draft is not taken
   * for a new match.
   */
  resetSession(): void
}

export function createAutoRescanService(
  appStore: AppStore,
  draftStore: StoreApi<DraftStore>,
  dbService: DatabaseService,
  streamService: StreamServerService,
  scanTrigger: ScanTriggerService,
  ocrService: Pick<OcrService, 'settle'>,
  /** Clears the WHOLE draft session (pool, board, slot mapping) — the same
   * reset closing the overlay performs. Called when GSI reports a new match. */
  resetDraftState: () => void,
): AutoRescanService {
  let timer: NodeJS.Timeout | null = null
  let tickRunning = false
  /** Settles when the in-flight tick finishes (the final pass waits on it). */
  let tickDone: Promise<void> = Promise.resolve()
  /** This draft's final pass, once started (see finalizeDraft). */
  let finalPass: Promise<void> | null = null

  const schedule: TurnWindow[] = buildTurnSchedule()
  const scheduleEndS = schedule[schedule.length - 1].endS

  let draftMatchId: string | null = null
  let lastPhase: string | null = null
  /** Wall-clock ms when a hero-selection clock was first seen (draft identified). */
  let draftClockSeenAtMs: number | null = null
  /** One fallback auto initial scan per draft session. */
  let autoInitialScanAttempted = false
  /** Wall-clock ms of the pick-phase start (GSI clock_time crossing 0). */
  let pickAnchorMs: number | null = null
  /** Seconds (pick-phase relative) up to which turn ends have been queued. */
  let queuedUpToS = 0
  /** Player rows queued for a targeted rescan (turn ended, pick not yet read). */
  const pendingRows = new Set<number>()
  /** True when a queued turn completed a round — escalate to a full rescan. */
  let fullScanDue = false
  let targetRetries = 0
  /** Wall-clock ms of the last replay-mode periodic full rescan. */
  let lastReplayScanMs = 0
  /** Previous clock_time inside hero selection — rewind detector input. */
  let lastClockTime: number | null = null
  /** Sticky per draft session: a big clock rewind marked this as a replay. */
  let replayDetected = false
  /** A clock <= -8 (the preview ramp) was seen — proves we witnessed the draft
   * start, the precondition for a trustworthy pick-phase anchor. */
  let sawPreviewClock = false
  let scheduleUnknownLogged = false
  /** Rows already given their one empty-targeted-scan retry this turn. */
  const retriedEmptyRows = new Set<number>()
  /** Capture stamp of the last countdown reading already logged. */
  let lastCountdownAtMs = 0

  function resetDraftSession(): void {
    draftClockSeenAtMs = null
    autoInitialScanAttempted = false
    pickAnchorMs = null
    queuedUpToS = 0
    pendingRows.clear()
    fullScanDue = false
    targetRetries = 0
    lastReplayScanMs = 0
    lastClockTime = null
    replayDetected = false
    sawPreviewClock = false
    scheduleUnknownLogged = false
    retriedEmptyRows.clear()
    lastCountdownAtMs = 0
    finalPass = null
  }

  function handlePhaseChange(snapshot: GsiSnapshot): void {
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
      // A DIFFERENT match than the one tracked means the previous draft is over,
      // whether or not the overlay closed in between: clear its pool too. The
      // auto initial scan only fires with no pool loaded, so a leftover pool
      // froze the board on the old draft — every draft in background mode (no
      // auto-close to reset it), or after the game closed mid-draft
      // (2026-09-18). Both ids must be known: a null matchid (replay flapping,
      // menus) is not proof of a new match.
      const previousMatchId = draftMatchId
      if (
        previousMatchId !== null &&
        snapshot.matchId !== null &&
        snapshot.matchId !== previousMatchId
      ) {
        resetDraftState()
        logger.info('New match — previous draft session cleared', {
          previousMatchId,
          matchId: snapshot.matchId,
        })
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
      // Catch the last picks while the draft screen is still up (overlay
      // auto-close awaits this same promise before closing)
      void finalizeDraft()
    }
  }

  streamService.onGsiSnapshot((snapshot) => {
    // Session identity FIRST, so a new draft's reset cannot clobber clock state
    // derived from the same snapshot (mid-draft joins report a clock immediately)
    handlePhaseChange(snapshot)

    if (
      snapshot.gamePhase !== GSI_HERO_SELECTION_PHASE ||
      snapshot.clockTime === null
    ) {
      return
    }

    // Draft clock identified — starts the fallback auto-initial-scan countdown
    if (draftClockSeenAtMs === null) {
      draftClockSeenAtMs = Date.now()
      logger.info('Draft clock identified', { clockTime: snapshot.clockTime })
    }

    // Per-turn countdowns only reach -7; anything deeper is the PREVIEW ramp.
    // Seeing it proves we witnessed the draft from (near) the start — the only
    // condition under which the anchor below is trustworthy. Joining mid-draft
    // (app/GSI started late) must NOT anchor: clock-0 crossings happen at every
    // turn boundary and would offset the whole schedule (observed 2026-08-26).
    if (snapshot.clockTime <= -8) sawPreviewClock = true

    // Replay detector: a spectated draft whose clock jumps BACKWARD beyond the
    // per-turn countdown depth is being seeked — the turn schedule is void for
    // the rest of this session. (Playing-mode clocks legitimately rewind by
    // exactly 7s per turn, hence the gate and the threshold.)
    if (
      !replayDetected &&
      gsiSnapshotMode(snapshot) === 'spectating' &&
      lastClockTime !== null &&
      snapshot.clockTime < lastClockTime - REPLAY_CLOCK_REWIND_THRESHOLD_S
    ) {
      replayDetected = true
      logger.info('Replay detected (draft clock rewound) — periodic rescans', {
        from: lastClockTime,
        to: snapshot.clockTime,
      })
      // Seen-times measured against a seeked clock mean nothing: order by count
      const timeline = draftStore.getState().draftTimeline
      if (timeline.some((event) => event.seenAtS !== undefined)) {
        draftStore.getState().setDraftTimeline(
          timeline.map((event) => {
            const unstamped = { ...event }
            delete unstamped.seenAtS
            return unstamped
          }),
        )
      }
    }
    lastClockTime = snapshot.clockTime

    // Pick-phase anchor. Empirical clock behavior (live-validated): the preview
    // ramp counts -59 -> 0 (1:1 with wall time), the first turn starts at 0,
    // and DURING picking the clock shows a PER-TURN -7..0 countdown — it never
    // goes positive. So the anchor is PREDICTED from any preview snapshot
    // (anchor = now - clock, a moment in the future) and refreshed while that
    // prediction is still ahead of us; this survives GSI missing the ~1s window
    // where the preview clock reads exactly 0. Once wall time passes the
    // anchor, negative clocks are turn timers and must never touch it.
    const now = Date.now()
    if (!sawPreviewClock) return // mid-draft join: no trustworthy anchor exists
    if (snapshot.clockTime < 0) {
      if (pickAnchorMs === null || now < pickAnchorMs) {
        if (pickAnchorMs === null) {
          logger.info('Pick phase anchor predicted from preview clock', {
            clockTime: snapshot.clockTime,
            startsInS: -snapshot.clockTime,
          })
        }
        pickAnchorMs = now - snapshot.clockTime * 1000
      }
    } else if (pickAnchorMs === null || now < pickAnchorMs) {
      // Clock at 0 (or hypothetically positive) while the start is still
      // pending — the authoritative crossing; snap the anchor to it.
      logger.info('Pick phase anchored (clock crossed zero)', {
        clockTime: snapshot.clockTime,
      })
      pickAnchorMs = now - snapshot.clockTime * 1000
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
    let finishTick = (): void => {}
    tickDone = new Promise((resolve) => {
      finishTick = resolve
    })
    try {
      const settings = dbService.metadata.getSettings()
      if (!settings.experimentalAutoDraftTracking) return
      if (!appStore.getState().overlayActive) return
      if (appStore.getState().mlStatus !== 'ready') return

      const { snapshot, connected } = streamService.getGsiState()
      if (!connected || snapshot?.gamePhase !== GSI_HERO_SELECTION_PHASE) return

      // Countdown-derived own-row candidate: "YOU WILL DRAFT IN: N" at capture
      // time t means the local player's next turn starts at t+N — matched
      // against the schedule via the anchor. Published to DraftStore for
      // spot-detection (validated 4/4 across slots on live lobby games,
      // 2026-08-26, deltas 1.5-2.1s).
      const countdown = draftStore.getState().draftCountdown
      if (
        countdown !== null &&
        countdown.atMs !== lastCountdownAtMs &&
        pickAnchorMs !== null &&
        sawPreviewClock
      ) {
        lastCountdownAtMs = countdown.atMs
        const elapsedAtCapture = (countdown.atMs - pickAnchorMs) / 1000
        const candidate = countdownTargetRow({
          countdownS: countdown.seconds,
          elapsedS: elapsedAtCapture,
        })
        logger.info('Countdown spot candidate', {
          n: countdown.seconds,
          elapsedS: Math.round(elapsedAtCapture),
          row: candidate?.row ?? null,
          deltaS: candidate === null ? null : Number(candidate.deltaS.toFixed(1)),
        })
        if (candidate !== null) {
          draftStore.setState({
            countdownSpotRow: {
              row: candidate.row,
              deltaS: candidate.deltaS,
              atMs: countdown.atMs,
            },
          })
        }
      }

      if (poolNames().length === 0) {
        // Fallback auto INITIAL scan: the user hasn't scanned the pool yet —
        // do it for them once, autoInitialScanDelayS (user setting; slower PCs
        // need the draft screen fully rendered) after the draft clock was seen
        if (
          !autoInitialScanAttempted &&
          draftClockSeenAtMs !== null &&
          Date.now() - draftClockSeenAtMs >=
            settings.autoInitialScanDelayS * 1000
        ) {
          autoInitialScanAttempted = true
          logger.info('Auto initial scan (no manual scan yet)', {
            clockTime: snapshot.clockTime,
          })
          await scanTrigger.performScan(true)
        }
        // Turn logic needs the pool baseline either way
        return
      }

      // REPLAY (auto-detected via clock rewind) or MID-DRAFT JOIN (preview ramp
      // never seen, so no trustworthy anchor exists): the turn schedule is void
      // — plain periodic FULL rescans; attribution stays row-diff/OCR-correct.
      // Live spectating (no rewind seen) runs the turn-driven path below.
      if (replayDetected || !sawPreviewClock) {
        if (!replayDetected && !scheduleUnknownLogged) {
          scheduleUnknownLogged = true
          logger.info('Joined draft mid-progress (no preview clock) — periodic full rescans')
        }
        if (Date.now() - lastReplayScanMs < AUTO_RESCAN_REPLAY_INTERVAL_MS) {
          return
        }
        lastReplayScanMs = Date.now()
        pendingRows.clear()
        fullScanDue = false
        await runRescan(undefined, undefined, snapshot.clockTime, null, 'periodic')
        return
      }

      if (pickAnchorMs === null) return

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
          // A NEW turn re-earns the row its one empty-scan retry
          retriedEmptyRows.delete(turn.playerIndex)
          // Last turn of a round -> reconcile the whole board in the 5s break
          if (turn.seq % 10 === 9) fullScanDue = true
        }
        queuedUpToS = visibleUpToS
      }

      if (pendingRows.size === 0 && !fullScanDue) return

      const attributionRows = [...pendingRows]
      const heroOrders = fullScanDue ? undefined : attributionRows
      await runRescan(heroOrders, attributionRows, snapshot.clockTime, elapsedS)

    } catch (error) {
      logger.error('Auto-rescan tick failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      tickRunning = false
      finishTick()
    }
  }

  /** Playing mode is where card OCR owns model picks (spectate: GSI does). */
  function isPlaying(): boolean {
    const { snapshot } = streamService.getGsiState()
    return snapshot !== null && gsiSnapshotMode(snapshot) === 'playing'
  }

  /**
   * Apply the current card reads to the model picks: assignments, the picked
   * set the scan processor reads, and the timeline's existing markers
   * (re-labelled/moved/dropped in place). Returns NEW markers without seq —
   * the caller sequences them ahead of the same capture's ability picks.
   */
  function applyOcrModelPicks(
    clockTime: number | null,
    seenAtS: number | undefined,
  ): Omit<PickEvent, 'seq'>[] {
    const state = draftStore.getState()
    if (state.identifiedHeroModelsCache.length === 0) return []
    const { snapshot } = streamService.getGsiState()
    const localNpc = snapshot?.localHeroNpcName ?? null
    const spotRow = state.mySelectedSpotHeroOrder

    const assignments = resolveModelAssignments({
      poolModels: state.identifiedHeroModelsCache,
      ocrByRow: state.ocrHeroNamesByRow,
      local: localNpc !== null && spotRow !== null ? { heroName: localNpc, row: spotRow } : null,
    })
    const update = reconcileModelMarkers(state.draftTimeline, assignments, clockTime, seenAtS)

    if (update.added.length > 0 || update.corrected.length > 0 || update.dropped > 0) {
      const heroName = (order: number | undefined): string =>
        state.identifiedHeroModelsCache.find((m) => m.heroOrder === order)?.heroName ??
        `#${order}`
      logger.info('Model picks from card OCR', {
        added: update.added.map((m) => `row ${m.playerIndex}: ${heroName(m.poolHeroOrder)}`),
        ...(update.corrected.length > 0
          ? {
              corrected: update.corrected.map(
                (c) => `${heroName(c.poolHeroOrder)} row ${c.fromRow} -> ${c.toRow}`,
              ),
            }
          : {}),
        ...(update.dropped > 0 ? { dropped: update.dropped } : {}),
      })
    }

    if (JSON.stringify(assignments) !== JSON.stringify(state.modelAssignments)) {
      draftStore.setState({
        modelAssignments: assignments,
        pickedModelHeroOrders: assignments.map((a) => a.poolHeroOrder),
      })
    }
    if (update.corrected.length > 0 || update.dropped > 0) {
      draftStore.getState().setDraftTimeline(update.timeline)
    }
    return update.added
  }

  /**
   * Run one rescan (targeted rows or full) and attribute new picks by row diff.
   * attributionRows = the turns whose end triggered this scan (independent of
   * scan coverage: a round-break FULL scan still reads one specific turn's pick).
   */
  async function runRescan(
    heroOrders: number[] | undefined,
    attributionRows: number[] | undefined,
    clockTime: number | null,
    elapsedS: number | null,
    untimedKind?: 'periodic' | 'final',
  ): Promise<void> {
    // When this capture happens on the draft clock — new picks carry it so the
    // store can place them at their turn (the final pass is timed too)
    const seenAtS =
      pickAnchorMs !== null && sawPreviewClock && !replayDetected
        ? Math.round((Date.now() - pickAnchorMs) / 100) / 10
        : undefined

    await scanTrigger.performScan(false, { heroOrders })

    // Card reads from THIS capture first. A model pick is evidence even when the
    // ability rows were obscured (the name strips are a separate region), and
    // applying it before sequencing keeps it ahead of this capture's picks.
    const newMarkers: Omit<PickEvent, 'seq'>[] = []
    if (isPlaying()) {
      const final = untimedKind === 'final'
      const settleStartedAt = Date.now()
      const drained = await ocrService.settle(
        final ? OCR_FINAL_PASS_SETTLE_TIMEOUT_MS : OCR_SETTLE_TIMEOUT_MS,
      )
      if (final) {
        logger.info('Draft final pass card OCR', {
          drained,
          waitedMs: Date.now() - settleStartedAt,
        })
      }
      newMarkers.push(...applyOcrModelPicks(clockTime, seenAtS))
    }

    const after = draftStore.getState()
    const rejected = after.lastRescanRejected || after.lastRescanHasty
    let newAbilities: Omit<PickEvent, 'seq'>[] = []
    if (!rejected) {
      const update = reconcileAbilityPicks({
        timeline: after.draftTimeline,
        nextSelected: after.selectedAbilitiesCache,
        clockTime,
        seenAtS,
      })
      if (update.corrected.length > 0 || update.phantoms.length > 0) {
        logger.info('Ability picks healed', {
          ...(update.corrected.length > 0
            ? { renamed: update.corrected.map((c) => `row ${c.playerIndex}: ${c.from} -> ${c.to}`) }
            : {}),
          ...(update.phantoms.length > 0
            ? {
                phantomsRemoved: update.phantoms.map((p) => `row ${p.playerIndex}: ${p.name}`),
              }
            : {}),
        })
      }
      if (
        update.corrected.length > 0 ||
        update.phantoms.length > 0 ||
        update.vacatedChanged ||
        update.timeline.length !== after.draftTimeline.length
      ) {
        draftStore.getState().setDraftTimeline(update.timeline)
      }
      newAbilities = update.added
    }

    // Provisional seq only: the store re-orders every pick to its draft turn
    const baseSeq = draftStore.getState().draftTimeline.length
    const markers: PickEvent[] = newMarkers.map((m, i) => ({ ...m, seq: baseSeq + i }))
    const events: PickEvent[] = newAbilities.map((e, i) => ({
      ...e,
      seq: baseSeq + markers.length + i,
    }))
    if (markers.length > 0 || events.length > 0) {
      draftStore.getState().appendPickEvents([...markers, ...events])
    }

    if (rejected) {
      if (markers.length > 0) streamService.refresh()
      // Tooltip over the rows: ability read void, state untouched. Retry next
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

    logger.info('Turn-driven rescan complete', {
      targeted: heroOrders ?? 'full',
      attributionRows: attributionRows ?? null,
      newPicks: events.length,
      newModelMarkers: markers.length,
      clockTime,
      ...(elapsedS !== null
        ? { elapsedS: Math.round(elapsedS) }
        : { kind: untimedKind ?? 'untimed' }),
    })

    pendingRows.clear()
    fullScanDue = false
    targetRetries = 0

    // One bounded retry for a targeted row whose pick did not show up: the
    // icon reveal races the capture right after a turn (measured marginal at
    // +1-2s, loses under CPU load). A row whose card just read a model drafted
    // its model this turn, so there is nothing more to find there.
    if (heroOrders && heroOrders.length > 0) {
      const rowsWithEvents = new Set([...markers, ...events].map((e) => e.playerIndex))
      for (const row of heroOrders) {
        if (!rowsWithEvents.has(row) && !retriedEmptyRows.has(row)) {
          retriedEmptyRows.add(row)
          pendingRows.add(row)
        }
      }
    }

    streamService.refresh()
  }

  /** Resolves true when the promise settles within ms, false on timeout. */
  function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    return Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  function finalizeDraft(): Promise<void> {
    if (finalPass !== null) return finalPass
    finalPass = (async () => {
      const startedAt = Date.now()
      const skip = (reason: string): void => {
        logger.info('Draft final pass skipped', { reason, durationMs: Date.now() - startedAt })
      }
      const settings = dbService.metadata.getSettings()
      if (!settings.experimentalAutoDraftTracking) return skip('auto draft tracking off')
      if (poolNames().length === 0) return skip('no draft tracked')

      // The last round's scan is typically STILL RUNNING when hero selection ends
      // (live 2026-09-16: gating on mlStatus first saw 'scanning', skipped, and
      // the overlay closed under that scan). Wait for it before any readiness
      // check — auto-close awaits this whole pass, so its capture stays valid.
      if (!(await within(tickDone, DRAFT_FINAL_PASS_TIMEOUT_MS))) {
        return skip('in-flight scan did not finish in time')
      }
      if (!appStore.getState().overlayActive) return skip('overlay already closed')
      if (appStore.getState().mlStatus !== 'ready') {
        return skip(`ml not ready (${appStore.getState().mlStatus})`)
      }

      tickRunning = true // hold off ticks: this capture is the last word
      try {
        const clockTime = streamService.getGsiState().snapshot?.clockTime ?? null
        const finished = await within(
          runRescan(undefined, undefined, clockTime, null, 'final'),
          DRAFT_FINAL_RESCAN_TIMEOUT_MS,
        )
        logger.info('Draft final pass', {
          finished,
          durationMs: Date.now() - startedAt,
          modelPicks: draftStore.getState().modelAssignments.length,
          picks: draftStore.getState().draftTimeline.length,
        })
      } finally {
        tickRunning = false
      }
    })().catch((error: unknown) => {
      logger.warn('Draft final pass failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return finalPass
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
    finalizeDraft,
    resetSession(): void {
      resetDraftSession()
      logger.info('Draft session reset manually — auto-rescan re-armed', {
        matchId: draftMatchId,
      })
    },
  }
}
