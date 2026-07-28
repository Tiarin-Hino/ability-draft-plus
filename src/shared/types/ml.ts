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
