import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { WindowManager } from './window-manager'
import type { StreamServerService } from './stream-server-service'

// @DEV-GUIDE: Auto "My Spot" + "My Model" selection from GSI while PLAYING (not
// spectating) — the automated replacement for the overlay's manual buttons (which
// are hidden when automatic draft tracking is enabled).
// - Spot: the GSI player block carries team_name + team_slot, which the parser maps
//   to the scan's player index (0-4 radiant, 5-9 dire) as localPlayer.slotIndex.
// - Model: once the user picks their hero, GSI's hero block reports it as an npc
//   short name (localHeroNpcName); matched against the identified pool heroes by
//   DB name (npc name minus underscores — same convention as stream-server).
//
// Each selection applies at most ONCE per initial scan (the scan-processor resets
// selections on every initial scan, and scan-processing-service calls
// onInitialScanProcessed): immediately when GSI already knows the value, or on a
// later GSI snapshot when it arrives (the model typically lands mid-draft). A
// manual deselect after auto-selection is respected (the once-flags stay set).
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
  /** True once the respective auto-selection ran for this initial scan generation. */
  let spotApplied = false
  let modelApplied = false
  /** True between an initial scan and the auto-selection attempts succeeding. */
  let armed = false

  function broadcast(channel: string, payload: unknown): void {
    const cp = windowManager.getControlPanelWindow()
    const overlay = windowManager.getOverlayWindow()
    if (cp && !cp.isDestroyed()) cp.webContents.send(channel, payload)
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload)
  }

  function trySelectSpot(): void {
    if (spotApplied) return

    const state = draftStore.getState()
    if (state.identifiedHeroModelsCache.length === 0) return
    if (state.mySelectedSpotHeroOrder !== null) return

    const { snapshot, connected } = streamService.getGsiState()
    const slotIndex = snapshot?.localPlayer?.slotIndex ?? null
    if (!connected || slotIndex === null) return

    const hero = state.identifiedHeroModelsCache.find(
      (m) => m.heroOrder === slotIndex,
    )
    if (!hero || hero.dbHeroId === null) {
      // Row not identified — a corrected initial rescan re-arms via
      // onInitialScanProcessed, so don't burn the once-flag on this
      logger.warn('GSI knows the spot but its hero row is unidentified', {
        slotIndex,
      })
      return
    }

    spotApplied = true
    draftStore.getState().selectMySpot(hero.dbHeroId, slotIndex)
    logger.info('My Spot auto-selected from GSI', {
      slotIndex,
      hero: hero.heroDisplayName,
      player: snapshot?.localPlayer?.name,
    })
    broadcast('draft:selectMySpot', { selectedHeroOrderForDrafting: slotIndex })
  }

  function trySelectModel(): void {
    if (modelApplied) return

    const state = draftStore.getState()
    if (state.identifiedHeroModelsCache.length === 0) return
    if (state.mySelectedModelHeroOrder !== null) return

    const { snapshot, connected } = streamService.getGsiState()
    const npcName = snapshot?.localHeroNpcName ?? null
    if (!connected || !npcName) return

    // npc short name -> DB hero name convention: underscores stripped
    const dbName = npcName.replace(/_/g, '')
    const model = state.identifiedHeroModelsCache.find(
      (m) => m.heroName === dbName,
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
    trySelectSpot()
    trySelectModel()
    if (spotApplied && modelApplied) armed = false
  }

  // GSI learns things over time (the model pick lands mid-draft; the server may
  // start late) — every snapshot is a cheap retry while armed.
  streamService.onGsiSnapshot(() => tryApply())

  return {
    onInitialScanProcessed(): void {
      spotApplied = false
      modelApplied = false
      armed = true
      tryApply()
    },
  }
}
