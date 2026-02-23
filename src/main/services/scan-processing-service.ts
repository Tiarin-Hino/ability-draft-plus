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
  ): void
}

export function createScanProcessingService(
  store: StoreApi<DraftStore>,
  dbService: DatabaseService,
  layoutService: LayoutService,
  windowManager: WindowManager,
): ScanProcessingService {
  return {
    handleScanResults(results, isInitialScan, resolution, scaleFactor) {
      const start = performance.now()

      try {
        const state = store.getState()

        const coords = layoutService.getLayout(resolution)
        if (!coords) {
          logger.error('No layout coordinates for resolution', { resolution })
          return
        }

        const output = processScanResults({
          rawResults: results,
          isInitialScan,
          state: {
            initialPoolAbilitiesCache: state.initialPoolAbilitiesCache,
            identifiedHeroModelsCache: state.identifiedHeroModelsCache,
            mySelectedSpotDbId: state.mySelectedSpotDbId,
            mySelectedSpotHeroOrder: state.mySelectedSpotHeroOrder,
            mySelectedModelDbHeroId: state.mySelectedModelDbHeroId,
            mySelectedModelHeroOrder: state.mySelectedModelHeroOrder,
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
        })

        // Broadcast enriched data to both windows
        const overlay = windowManager.getOverlayWindow()
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send('overlay:data', output.overlayPayload)
        }

        const cp = windowManager.getControlPanelWindow()
        if (cp && !cp.isDestroyed()) {
          cp.webContents.send('overlay:data', output.overlayPayload)
        }

        const durationMs = Math.round(performance.now() - start)
        logger.info('Scan processing complete', { durationMs, isInitialScan })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Scan processing failed', { error: message })
      }
    },
  }
}
