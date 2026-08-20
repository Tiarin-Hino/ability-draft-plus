import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'
import type { LayoutService } from './layout-service'
import type { WindowManager } from './window-manager'
import type { ScanResult } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'
import { processScanResults } from '@core/domain/scan-processor'

// @DEV-GUIDE: Bridges ML scan results to the overlay UI. After the ML worker returns raw
// ability/hero detections, this service:
// 1. Reads current draft state from DraftStore (caches, user selections)
// 2. Queries DB repositories for ability stats, synergies, triplets, and thresholds
// 3. Delegates to the pure domain function processScanResults() in src/core/domain/
// 4. Updates DraftStore with new state (caches, selected hero/spot)
// 5. Broadcasts the enriched OverlayDataPayload to BOTH overlay and control panel windows
//
// The pure domain logic (scoring, synergy filtering, OP/trap detection) lives in src/core/
// and has zero Electron imports. This service is the Electron-aware adapter that feeds it.

const logger = log.scope('scan-processing')

export interface ScanProcessingService {
  handleScanResults(
    results: InitialScanResults | ScanResult[],
    isInitialScan: boolean,
    resolution: string,
    scaleFactor: number,
    modelTiles?: import('@core/domain/model-pick-detection').ModelTileCapture[],
    playerCardTiles?: import('@core/domain/slot-row-correlation').PlayerCardCapture[],
  ): void
}

export function createScanProcessingService(
  store: StoreApi<DraftStore>,
  dbService: DatabaseService,
  layoutService: LayoutService,
  windowManager: WindowManager,
  streamService?: Pick<
    import('./stream-server-service').StreamServerService,
    'onScanProcessed' | 'getGsiState'
  >,
  spotDetection?: Pick<
    import('./spot-detection-service').SpotDetectionService,
    'onInitialScanProcessed'
  >,
  slotMapping?: Pick<
    import('./slot-mapping-service').SlotMappingService,
    'onCardTiles'
  >,
): ScanProcessingService {
  // Enrichment failures must reach the overlay: without this broadcast the renderer's
  // scanState stays pinned at 'scanning' with every button disabled.
  function broadcastError(message: string): void {
    const payload = { error: message }
    const overlay = windowManager.getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('ml:scanResults', payload)
    }
    const cp = windowManager.getControlPanelWindow()
    if (cp && !cp.isDestroyed()) {
      cp.webContents.send('ml:scanResults', payload)
    }
  }

  return {
    handleScanResults(
      results,
      isInitialScan,
      resolution,
      scaleFactor,
      modelTiles,
      playerCardTiles,
    ) {
      const start = performance.now()

      try {
        const state = store.getState()

        const coords = layoutService.getLayout(resolution)
        if (!coords) {
          logger.error('No layout coordinates for resolution', { resolution })
          broadcastError(`No layout coordinates for resolution: ${resolution}`)
          return
        }

        // Player-card change detection + GSI slot correlation runs on EVERY
        // capture — the cards are spatially separate from the ability rows, so
        // the contamination guard's verdict below is irrelevant to them.
        slotMapping?.onCardTiles(playerCardTiles, isInitialScan)

        // While SPECTATING, GSI is the authoritative model-pick source and the
        // spectator draft screen's coordinate offsets make tile diffs garbage
        // (observed: 'Unknown Hero' commits) — drop the tiles entirely.
        const gsiSnapshot = streamService?.getGsiState().snapshot
        const spectating = (gsiSnapshot?.players.length ?? 0) > 0
        const output = processScanResults({
          rawResults: results,
          isInitialScan,
          modelTiles: spectating ? undefined : modelTiles,
          state: {
            initialPoolAbilitiesCache: state.initialPoolAbilitiesCache,
            identifiedHeroModelsCache: state.identifiedHeroModelsCache,
            mySelectedSpotDbId: state.mySelectedSpotDbId,
            mySelectedSpotHeroOrder: state.mySelectedSpotHeroOrder,
            mySelectedModelDbHeroId: state.mySelectedModelDbHeroId,
            mySelectedModelHeroOrder: state.mySelectedModelHeroOrder,
            selectedAbilitiesCache: state.selectedAbilitiesCache,
            rescanRejectionStreak: state.rescanRejectionStreak,
            modelTileBaselines: state.modelTileBaselines,
            pendingModelChanges: state.pendingModelChanges,
            pickedModelHeroOrders: state.pickedModelHeroOrders,
          },
          deps: {
            heroes: dbService.heroes,
            abilities: dbService.abilities,
            synergies: dbService.synergies,
            triplets: dbService.triplets,
            settings: dbService.metadata,
          },
          modelCoords: coords.models_coords ?? [],
          heroesCoords: coords.heroes_coords ?? [],
          heroesParams: coords.heroes_params ?? { width: 0, height: 0 },
          targetResolution: resolution,
          scaleFactor,
        })

        // Update store with new state
        store.setState({
          initialPoolAbilitiesCache:
            output.updatedState.initialPoolAbilitiesCache,
          identifiedHeroModelsCache:
            output.updatedState.identifiedHeroModelsCache,
          mySelectedSpotDbId: output.updatedState.mySelectedSpotDbId,
          mySelectedSpotHeroOrder: output.updatedState.mySelectedSpotHeroOrder,
          mySelectedModelDbHeroId: output.updatedState.mySelectedModelDbHeroId,
          mySelectedModelHeroOrder:
            output.updatedState.mySelectedModelHeroOrder,
          selectedAbilitiesCache: output.updatedState.selectedAbilitiesCache,
          rescanRejectionStreak: output.updatedState.rescanRejectionStreak,
          lastRescanRejected: output.rescanRejected === true,
          lastRescanHasty: output.rescanHasty === true,
          modelTileBaselines: output.updatedState.modelTileBaselines,
          pendingModelChanges: output.updatedState.pendingModelChanges,
          pickedModelHeroOrders: output.updatedState.pickedModelHeroOrders,
        })

        if (output.newlyPickedModels && output.newlyPickedModels.length > 0) {
          // Cross-check against the GSI local-hero log line when playing:
          // your own pick must show up here within a scan or two of the
          // 'GSI local player' heroModel update
          const names = output.newlyPickedModels.map((order) => {
            const model = output.updatedState.identifiedHeroModelsCache.find(
              (m) => m.heroOrder === order,
            )
            return model ? `${order}:${model.heroDisplayName}` : `${order}:?`
          })
          logger.info('Model picks detected (tile diff)', { models: names })
        }

        if (output.rescanRejected) {
          logger.warn(
            'Rescan discarded by contamination guard (pick slot obscured); state unchanged',
          )
        }
        if (output.rescanHasty) {
          logger.debug('Hasty rescan (no new picks) skipped; state unchanged')
        }
        if (output.rescanRebaselined) {
          logger.warn(
            'Contamination-guard rejection cap reached — accepted scan as new baseline',
          )
        }

        // Broadcast enriched data to both windows
        const overlay = windowManager.getOverlayWindow()
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send('overlay:data', output.overlayPayload)
          // A scan repaints the whole hotspot layer, and those hotspots are
          // hover-ONLY (they never toggle click-through themselves), so they
          // depend entirely on mouse-move forwarding still being armed. Window
          // operations around a scan can drop it silently — re-apply the
          // current state so tooltips work without the user first clicking
          // something. Idempotent and preserves an in-progress hover.
          windowManager.refreshOverlayMouseEvents()
        }

        const cp = windowManager.getControlPanelWindow()
        if (cp && !cp.isDestroyed()) {
          cp.webContents.send('overlay:data', output.overlayPayload)
        }

        // Third consumer: the streamer-view server (caches its own last payload)
        streamService?.onScanProcessed(output.overlayPayload, isInitialScan)

        // Initial scans reset the spot selection — give GSI auto spot detection
        // a chance to re-apply it from the local player's team slot
        if (isInitialScan) spotDetection?.onInitialScanProcessed()

        const durationMs = Math.round(performance.now() - start)
        logger.info('Scan processing complete', { durationMs, isInitialScan })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan processing failed', { error: message })
        broadcastError(`Scan processing failed: ${message}`)
      }
    },
  }
}
