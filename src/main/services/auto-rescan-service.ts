import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { StreamServerService } from './stream-server-service'
import type { ScanTriggerService } from './scan-trigger-service'
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
import { attributePicksByRow } from '@core/domain/pick-attribution'
import { heroNameToken } from '@core/domain/own-row-detection'
import {
  AUTO_RESCAN_TICK_MS,
  AUTO_RESCAN_PICK_VISIBLE_DELAY_S,
  AUTO_RESCAN_MAX_TARGET_RETRIES,
  AUTO_RESCAN_REPLAY_INTERVAL_MS,
  REPLAY_CLOCK_REWIND_THRESHOLD_S,
  MODEL_PICK_CONFIRM_DELAY_MS,
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
// Model picks come from GSI in both spectator kinds (tile diffing is disabled by
// scan-processing-service there — the spectator screen's coordinate offsets make
// tile diffs unreliable).
//
// Gates per tick (ALL must hold): setting on, overlay active, ML idle, GSI
// connected and in hero selection; the turn logic additionally needs an initial
// scan done and the pick-phase anchor set. Draft sessions are keyed by GSI matchid
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
  /**
   * Model -> player attribution, keyed at FIRST-SEEN time: the pool tile greys
   * exactly when the assigning player's turn ends (user-verified), so the turn
   * that triggered the first-seen scan identifies the picker. The mapping is
   * tentative until the two-scan persistence commit (commit time lags by one
   * turn and must NOT be used for attribution). 'self' marks the user's own
   * model (GSI hero block match): its row is resolved at COMMIT time from the
   * OCR-derived My Spot (localPlayer.slotIndex is lobby-order, not the visual
   * row — see own-row-detection.ts), which may still be resolving at first-seen.
   */
  const tentativeModelPicker = new Map<number, number | 'self'>()
  /** Accepted rescans this session — the 1st sweeps up all preview-time picks
   * at once, so its timing carries no per-turn information. */
  let acceptedRescans = 0
  /** When set, a model-tile CONFIRMATION capture (zero ability rows) is due —
   * resolves pending tile changes in ~1.5s instead of one turn later. */
  let modelConfirmAtMs: number | null = null
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
    tentativeModelPicker.clear()
    acceptedRescans = 0
    modelConfirmAtMs = null
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

      // Fast model-pick confirmation: a tile read changed last scan — capture
      // just the model tiles again (zero ability rows) so the persistence rule
      // commits in ~1.5s instead of one full turn later
      if (modelConfirmAtMs !== null && Date.now() >= modelConfirmAtMs) {
        modelConfirmAtMs = null
        await runRescan([], undefined, snapshot.clockTime, null, 'model-confirm')
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
    }
  }

  /**
   * Attribute model-tile changes to players. AUTHORITATIVE source: the card
   * OCR (the drafter's card prints the hero's name — see ocrRowForPoolHero);
   * turn timing is the fallback while OCR hasn't read the card. Newly PENDING
   * tiles are tentatively mapped to the single turn that triggered this scan
   * (ambiguous multi-turn scans and the first sweep-up rescan attribute
   * nothing); newly COMMITTED tiles resolve OCR-first, then tentative. The
   * user's own model resolves via the OCR-derived My Spot ('self').
   */
  /**
   * The unique player row whose card OCR'd as the given POOL hero, or null
   * (not OCR'd yet / ambiguous). Direct evidence of who drafted the model —
   * the draft screen prints the hero's name on the drafter's card.
   */
  function ocrRowForPoolHero(order: number): number | null {
    const state = draftStore.getState()
    const heroName = state.identifiedHeroModelsCache.find(
      (m) => m.heroOrder === order,
    )?.heroName
    if (!heroName) return null
    const token = heroNameToken(heroName)
    const rows = Object.entries(state.ocrHeroNamesByRow)
      .filter(([, ocr]) => heroNameToken(ocr.name) === token)
      .map(([row]) => Number(row))
    return rows.length === 1 ? rows[0] : null
  }

  function attributeModelPicks(
    prevPending: readonly number[],
    prevPicked: readonly number[],
    scannedRows: number[] | undefined,
  ): void {
    const state = draftStore.getState()
    const { snapshot } = streamService.getGsiState()

    const localNpc = snapshot?.localHeroNpcName ?? null
    const localToken = localNpc ? heroNameToken(localNpc) : null

    // Tentative mapping at FIRST-SEEN time
    const prevPendingSet = new Set(prevPending)
    const newlyPending = state.pendingModelChanges.filter(
      (order) => !prevPendingSet.has(order),
    )
    for (const order of newlyPending) {
      const heroName = state.identifiedHeroModelsCache.find(
        (m) => m.heroOrder === order,
      )?.heroName
      if (
        localToken !== null &&
        heroName !== undefined &&
        heroNameToken(heroName) === localToken
      ) {
        tentativeModelPicker.set(order, 'self')
      } else if (acceptedRescans > 1 && scannedRows?.length === 1) {
        tentativeModelPicker.set(order, scannedRows[0])
      }
    }
    // Pending entries that neither persisted nor committed were flickers
    const stillRelevant = new Set([
      ...state.pendingModelChanges,
      ...state.pickedModelHeroOrders,
    ])
    for (const order of [...tentativeModelPicker.keys()]) {
      if (!stillRelevant.has(order)) tentativeModelPicker.delete(order)
    }

    // Commit priority: the LOCAL player's model goes to the known My Spot row
    // (countdown/OCR-validated — a single card misread must never move it,
    // observed 2026-08-26); other models take the card-OCR row (direct
    // evidence), with the turn-timing tentative mapping as the fallback while
    // OCR hasn't read the card (reconcileModelAssignmentsWithOcr fixes later)
    const prevPickedSet = new Set(prevPicked)
    const assignments: import('../store/draft-store').ModelAssignment[] = []
    for (const order of state.pickedModelHeroOrders) {
      if (prevPickedSet.has(order)) continue
      const tentative = tentativeModelPicker.get(order)
      tentativeModelPicker.delete(order)
      const ocrRow = ocrRowForPoolHero(order)
      const spotRow =
        tentative === 'self' ? state.mySelectedSpotHeroOrder : null
      if (spotRow !== null && ocrRow !== null && ocrRow !== spotRow) {
        logger.warn(
          'Card OCR disagrees with My Spot for the local model — trusting the spot',
          { order, ocrRow, spotRow },
        )
      }
      const playerIndex =
        spotRow ?? ocrRow ?? (tentative === 'self' ? undefined : tentative)
      if (playerIndex === undefined) {
        logger.info('Model pick left unattributed (awaiting card OCR)', { order })
        continue
      }
      assignments.push({ poolHeroOrder: order, playerIndex })
    }
    if (assignments.length > 0) {
      draftStore.getState().appendModelAssignments(assignments)
      logger.info('Model picks attributed', { assignments })
    }
  }

  /**
   * Card OCR lands on its own schedule (often a scan after the model commit)
   * and outranks turn-timing guesses: append assignments timing couldn't make
   * and CORRECT ones it got wrong (observed: adjacent-turn misattribution put
   * Night Stalker on the wrong team's row, 2026-08-26).
   */
  function reconcileModelAssignmentsWithOcr(): boolean {
    const state = draftStore.getState()
    if (state.pickedModelHeroOrders.length === 0) return false

    // The LOCAL player's model is anchored to the known My Spot row — card
    // OCR must never "correct" it onto another player (misread protection)
    const { snapshot } = streamService.getGsiState()
    const localToken = snapshot?.localHeroNpcName
      ? heroNameToken(snapshot.localHeroNpcName)
      : null
    const spotRow = state.mySelectedSpotHeroOrder

    let changed = false
    let assignments = [...state.modelAssignments]
    for (const order of state.pickedModelHeroOrders) {
      const heroName = state.identifiedHeroModelsCache.find(
        (m) => m.heroOrder === order,
      )?.heroName
      const isLocalModel =
        localToken !== null &&
        heroName !== undefined &&
        heroNameToken(heroName) === localToken
      const ocrRow =
        isLocalModel && spotRow !== null ? spotRow : ocrRowForPoolHero(order)
      if (ocrRow === null) continue
      const existing = assignments.find((a) => a.poolHeroOrder === order)
      if (!existing) {
        assignments.push({ poolHeroOrder: order, playerIndex: ocrRow })
        changed = true
        logger.info('Model assignment added from card OCR', {
          order,
          row: ocrRow,
        })
      } else if (existing.playerIndex !== ocrRow) {
        assignments = assignments.map((a) =>
          a.poolHeroOrder === order ? { ...a, playerIndex: ocrRow } : a,
        )
        changed = true
        logger.info('Model assignment corrected by card OCR', {
          order,
          from: existing.playerIndex,
          to: ocrRow,
        })
      }
    }
    if (changed) draftStore.setState({ modelAssignments: assignments })
    return changed
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
    untimedKind?: 'periodic' | 'model-confirm',
  ): Promise<void> {
    const before = draftStore.getState()
    const prevSelected = before.selectedAbilitiesCache
    const prevPendingModels = before.pendingModelChanges
    const prevPickedModels = before.pickedModelHeroOrders

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

    acceptedRescans += 1
    attributeModelPicks(prevPendingModels, prevPickedModels, attributionRows)
    reconcileModelAssignmentsWithOcr()

    // Pending tile changes await their persistence confirmation — schedule the
    // fast model-only capture (chains naturally if new changes keep appearing)
    modelConfirmAtMs =
      draftStore.getState().pendingModelChanges.length > 0
        ? Date.now() + MODEL_PICK_CONFIRM_DELAY_MS
        : null

    const events = attributePicksByRow({
      prevSelected,
      nextSelected: after.selectedAbilitiesCache,
      nextSeq: after.draftTimeline.length,
      clockTime,
    })

    logger.info('Turn-driven rescan complete', {
      targeted: heroOrders ?? 'full',
      newPicks: events.length,
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
    // +1-2s, loses under CPU load). A model-draft turn also lands here — it
    // never yields an ability pick, costing at most one extra capture per turn.
    if (heroOrders && heroOrders.length > 0) {
      const rowsWithEvents = new Set(events.map((e) => e.playerIndex))
      for (const row of heroOrders) {
        if (!rowsWithEvents.has(row) && !retriedEmptyRows.has(row)) {
          retriedEmptyRows.add(row)
          pendingRows.add(row)
        }
      }
    }

    if (events.length > 0) {
      draftStore.getState().appendPickEvents(events)
    }
    streamService.refresh()
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
