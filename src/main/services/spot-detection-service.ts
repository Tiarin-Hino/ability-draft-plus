import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { WindowManager } from './window-manager'
import type { StreamServerService } from './stream-server-service'

// @DEV-GUIDE: Auto "My Spot" selection from GSI. While PLAYING (not spectating),
// Dota's GSI player block carries team_name + team_slot, which the parser maps to
// the scan's player index (0-4 radiant, 5-9 dire) as localPlayer.slotIndex — so the
// user's spot is known without clicking the overlay button.
//
// Applied at most ONCE per initial scan (the scan-processor resets selections on
// every initial scan, and scan-processing-service calls onInitialScanProcessed):
// - immediately after the initial scan when GSI already knows the slot, or
// - on a later GSI snapshot if GSI connects/reports the slot afterwards.
// A manual deselect after auto-selection is respected (the once-flag stays set);
// the manual My Spot button keeps working as an override either way.
//
// Selection mirrors the draft:selectMySpot IPC handler exactly: DraftStore update
// + broadcast to both windows so the overlay highlight and control panel sync.

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
  /** True once auto-selection ran for the current initial scan generation. */
  let applied = false
  /** True between an initial scan and the auto-selection attempt succeeding. */
  let armed = false

  function tryApply(): void {
    if (applied || !armed) return

    const state = draftStore.getState()
    // Initial scan must have identified the board, and the user must not have
    // picked a spot already (fresh initial scans reset it to null anyway)
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

    applied = true
    armed = false
    draftStore.getState().selectMySpot(hero.dbHeroId, slotIndex)
    logger.info('My Spot auto-selected from GSI', {
      slotIndex,
      hero: hero.heroDisplayName,
      player: snapshot?.localPlayer?.name,
    })

    const payload = { selectedHeroOrderForDrafting: slotIndex }
    const cp = windowManager.getControlPanelWindow()
    const overlay = windowManager.getOverlayWindow()
    if (cp && !cp.isDestroyed()) cp.webContents.send('draft:selectMySpot', payload)
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('draft:selectMySpot', payload)
    }
  }

  // GSI may learn the slot after the initial scan (server started late, Dota
  // reconnect) — every snapshot is a cheap retry while armed.
  streamService.onGsiSnapshot(() => tryApply())

  return {
    onInitialScanProcessed(): void {
      applied = false
      armed = true
      tryApply()
    },
  }
}
