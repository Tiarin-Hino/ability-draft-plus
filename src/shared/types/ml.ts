import type { ScanResult, ResolutionLayout } from './index'

// --- Worker Request Messages (main → worker) ---

export interface MlWorkerInitRequest {
  type: 'init'
  payload: {
    modelPath: string
    classNamesPath: string
    useDirectML: boolean
  }
}

export interface MlWorkerScanRequest {
  type: 'scan'
  payload: {
    screenshotBuffer: ArrayBuffer
    layout: ResolutionLayout
    confidenceThreshold: number
    isInitialScan: boolean
    /**
     * Ability internal names currently in the DB (= still in the draft pool).
     * Model classes outside this list are masked during classification, so
     * removed-from-pool abilities kept in the model are never predicted.
     * Omitted/empty → no masking.
     */
    activeClassNames?: string[]
    /**
     * Rescan only: restrict the selected-abilities scan to these player rows
     * (hero_order 0-9). Omitted → scan all rows. Ignored for initial scans.
     * Used by the GSI turn-driven auto-rescan to scan ~4 slots instead of 40.
     */
    heroOrders?: number[]
  }
}

export interface MlWorkerDisposeRequest {
  type: 'dispose'
}

export type MlWorkerRequest = MlWorkerInitRequest | MlWorkerScanRequest | MlWorkerDisposeRequest

// --- Worker Response Messages (worker → main) ---

export interface MlWorkerReadyResponse {
  status: 'ready'
  executionProvider: string
}

export interface MlWorkerSuccessResponse {
  status: 'success'
  results: InitialScanResults | ScanResult[]
  isInitialScan: boolean
  /**
   * Normalized crops of the 12 model portrait tiles (raw RGB at
   * MODEL_TILE_COMPARE_SIZE²), captured on every scan for picked-model diff
   * detection. Buffers are transferred, not copied. Absent when the layout has
   * no models_coords or a tile crop failed.
   */
  modelTiles?: { heroOrder: number; tile: ArrayBuffer }[]
}

export interface MlWorkerErrorResponse {
  status: 'error'
  type?: 'init-error'
  error: { message: string; stack?: string }
}

export type MlWorkerResponse =
  | MlWorkerReadyResponse
  | MlWorkerSuccessResponse
  | MlWorkerErrorResponse

// --- Scan Result Structures ---

export interface InitialScanResults {
  ultimates: ScanResult[]
  standard: ScanResult[]
  selectedAbilities: ScanResult[]
  heroDefiningAbilities: ScanResult[]
}
