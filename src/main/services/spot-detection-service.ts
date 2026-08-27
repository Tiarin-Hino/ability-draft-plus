import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { WindowManager } from './window-manager'
import type { StreamServerService } from './stream-server-service'
import {
  resolveOwnRowFromOcr,
  heroNameToken,
} from '@core/domain/own-row-detection'

// @DEV-GUIDE: Auto "My Spot" + "My Model" selection from GSI while PLAYING (not
// spectating) — the automated replacement for the overlay's manual buttons (which
// are hidden when automatic draft tracking is enabled).
// - Spot: NO GSI field matches the draft screen's visual row order (team_slot and
//   player_slot are both lobby-order — disproven on live games 2026-08-25; only
//   the team half is trustworthy). Two screen-side signals derive it instead:
//   1. Draft countdown (INSTANT — lands seconds into the preview): auto-rescan
//      matches the OCR'd "YOU WILL DRAFT IN: N" against the turn schedule and
//      publishes DraftStore.countdownSpotRow. Validated 4/4 across slots on
//      live lobby games 2026-08-26 (deltas 1.5-2.1s; the 2.5s matcher tolerance
//      can never straddle two 7s-spaced turns).
//   2. GSI hero block x card-name OCR (lands after the user DRAFTS their model,
//      near-certain): resolveOwnRowFromOcr over DraftStore.ocrHeroNamesByRow.
//      It CONFIRMS the countdown pick (fills in the model's dbHeroId, no UI
//      churn) or CORRECTS it (re-broadcast).
//   Every GSI snapshot retries both while armed.
// - Model: once the user picks their hero, GSI's hero block reports it as an npc
//   short name (localHeroNpcName); matched against the identified pool heroes
//   via heroNameToken (underscore-normalized + npc aliases, e.g. zuus->zeus).
//
// Each signal applies at most ONCE per initial scan (the scan-processor resets
// selections on every initial scan, and scan-processing-service calls
// onInitialScanProcessed). A manual selection disables both signals; a manual
// deselect of an auto pick is respected by the signal that made it — but the
// OCR signal, if still pending, will place its authoritative row once.
//
// Selection mirrors the draft:selectMySpot/selectMyModel IPC handlers exactly:
// DraftStore update + broadcast to both windows.

const logger = log.scope('spot-detection')

export interface SpotDetectionService {
  /** Called by scan-processing-service after every successful INITIAL scan. */
  onInitialScanProcessed(): void
}

export function createSpotDetectionService(
  draftStore: StoreApi<DraftStore>,
  windowManager: WindowManager,
  streamService: Pick<StreamServerService, 'getGsiState' | 'onGsiSnapshot'>,
): SpotDetectionService {
  /** Once-flags per initial-scan generation (see DEV-GUIDE). */
  let countdownApplied = false
  let ocrApplied = false
  let modelApplied = false
  /** True between an initial scan and the auto-selection attempts succeeding. */
  let armed = false
  /** Row this service last auto-applied — distinguishes our own selection from
   * a manual one (only our own may be corrected by the OCR signal). */
  let autoAppliedRow: number | null = null

  function broadcast(channel: string, payload: unknown): void {
    const cp = windowManager.getControlPanelWindow()
    const overlay = windowManager.getOverlayWindow()
    if (cp && !cp.isDestroyed()) cp.webContents.send(channel, payload)
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload)
  }

  function applySpot(dbHeroId: number | null, row: number): void {
    draftStore.getState().selectMySpot(dbHeroId, row)
    autoAppliedRow = row
    broadcast('draft:selectMySpot', { selectedHeroOrderForDrafting: row })
  }

  function trySelectSpotFromCountdown(): void {
    if (countdownApplied || ocrApplied) return

    const state = draftStore.getState()
    if (state.mySelectedSpotHeroOrder !== null) {
      // Selected before we got a reading (manual, or OCR won the race) —
      // this signal's work is done for the draft
      countdownApplied = true
      return
    }

    const candidate = state.countdownSpotRow
    if (candidate === null) return

    countdownApplied = true
    applySpot(null, candidate.row)
    logger.info('My Spot auto-selected (draft countdown)', {
      row: candidate.row,
      deltaS: Number(candidate.deltaS.toFixed(1)),
    })
  }

  function trySelectSpotFromOcr(): void {
    if (ocrApplied) return

    const state = draftStore.getState()
    const current = state.mySelectedSpotHeroOrder
    if (current !== null && current !== autoAppliedRow) {
      // Manually selected (fresh, or over our auto pick) — never fight the user
      ocrApplied = true
      return
    }

    const { snapshot, connected } = streamService.getGsiState()
    const npcName = snapshot?.localHeroNpcName ?? null
    if (!connected || !npcName) return

    // slotIndex (team_name + team_slot) is lobby-order — only its team HALF is
    // meaningful; the visual row comes from the OCR match below
    const slotIndex = snapshot?.localPlayer?.slotIndex ?? null
    const teamHalfStart = slotIndex === null ? null : slotIndex < 5 ? 0 : 5

    const row = resolveOwnRowFromOcr({
      ocrHeroNamesByRow: state.ocrHeroNamesByRow,
      localHeroNpcName: npcName,
      teamHalfStart,
    })
    // Model not on a card yet / not OCR'd yet — every snapshot retries
    if (row === null) return

    const token = heroNameToken(npcName)
    const poolHero = state.identifiedHeroModelsCache.find(
      (m) => heroNameToken(m.heroName) === token,
    )
    const dbHeroId = poolHero?.dbHeroId ?? null

    ocrApplied = true
    if (current === row) {
      // Countdown pick confirmed — just fill in the hero id, no UI churn
      draftStore.getState().selectMySpot(dbHeroId, row)
      logger.info('My Spot confirmed (GSI model x card OCR)', {
        row,
        model: npcName,
      })
      return
    }
    applySpot(dbHeroId, row)
    logger.info(
      current === null
        ? 'My Spot auto-selected (GSI model x card OCR)'
        : 'My Spot corrected by OCR (countdown pick was wrong)',
      {
        row,
        previousRow: current,
        model: npcName,
        teamHalfStart,
        player: snapshot?.localPlayer?.name,
      },
    )
  }

  function trySelectModel(): void {
    if (modelApplied) return

    const state = draftStore.getState()
    if (state.identifiedHeroModelsCache.length === 0) return
    if (state.mySelectedModelHeroOrder !== null) return

    const { snapshot, connected } = streamService.getGsiState()
    const npcName = snapshot?.localHeroNpcName ?? null
    if (!connected || !npcName) return

    const token = heroNameToken(npcName)
    const model = state.identifiedHeroModelsCache.find(
      (m) => heroNameToken(m.heroName) === token,
    )
    if (!model || model.dbHeroId === null) {
      logger.warn('GSI reported a picked model outside the identified pool', {
        npcName,
      })
      return
    }

    modelApplied = true
    draftStore.getState().selectMyModel(model.dbHeroId, model.heroOrder)
    logger.info('My Model auto-selected from GSI', {
      heroOrder: model.heroOrder,
      hero: model.heroDisplayName,
    })
    broadcast('draft:selectMyModel', { selectedModelHeroOrder: model.heroOrder })
  }

  function tryApply(): void {
    if (!armed) return
    trySelectSpotFromCountdown()
    trySelectSpotFromOcr()
    trySelectModel()
    if (ocrApplied && modelApplied) armed = false
  }

  // GSI learns things over time (the countdown lands during the preview, the
  // model pick mid-draft; the server may start late) — every snapshot is a
  // cheap retry while armed.
  streamService.onGsiSnapshot(() => tryApply())

  return {
    onInitialScanProcessed(): void {
      countdownApplied = false
      ocrApplied = false
      modelApplied = false
      autoAppliedRow = null
      armed = true
      tryApply()
    },
  }
}
