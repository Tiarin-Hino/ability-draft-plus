import type { ScanResult, ResolutionLayout, SlotCoordinate } from './index'

// --- Worker Request Messages (main → worker) ---

export interface MlWorkerInitRequest {
  type: 'init'
  payload: {
    modelPath: string
    classNamesPath: string
    useDirectML: boolean
    /**
     * Directory of official ability icons (userData/stream-icons/abilities,
     * maintained by icon-cache-service). When present, picked-ability slots
     * are identified by template matching against these icons instead of the
     * classifier; absent/unreadable → classifier fallback for pick slots.
     */
    pickIconsDir?: string
    /**
     * Dev builds only: directory where the worker dumps the 48x48 crops of
     * REJECTED pick-slot template matches as PNGs (what the matcher actually
     * saw), for offline root-cause analysis. Omitted in packaged builds.
     */
    rejectedCropsDir?: string
    /**
     * Dev builds only: directory where the worker dumps POOL crops the
     * classifier rejected (below its confidence gate). The pool is scanned
     * once, so an Unknown there costs the whole draft — these crops are the
     * only way to see WHY (hover tooltip, animation, odd position).
     */
    lowConfCropsDir?: string
    /**
     * Reference-tile library for model-tile identification:
     * <dir>/<hero_internal_name>/<n>.png, gathered by the data-gather script's
     * models mode. Absent/empty → model-tile matching is skipped.
     */
    modelTilesDir?: string
  }
}

export interface MlWorkerScanRequest {
  type: 'scan'
  payload: {
    /** RAW RGB bitmap (3 channels), transferred — NOT an encoded image. */
    screenshotBuffer: ArrayBuffer
    screenshotWidth: number
    screenshotHeight: number
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
    /**
     * Rescan only: ability names the current draft can actually contain,
     * split by slot type — a standard pick box can only hold one of the
     * pool's 36 standard abilities and the ultimate box (row index 3) one of
     * its 12 ultimates (initial pool + already-picked names reconstruct the
     * full sets). Per-type scoping keeps winner margins wide and rules out
     * cross-type confusions entirely. Omitted/empty set → that slot type
     * matches against every cached icon.
     */
    pickCandidates?: PickCandidates
    /**
     * Rescan only: pool slots that read Unknown earlier and are worth
     * re-classifying (pool art is static until the ability is drafted). Slots
     * that now read EMPTY are skipped — the ability was picked, and
     * classifying an empty box invites a confident misread.
     */
    retryPoolSlots?: SlotCoordinate[]
  }
}

/** Pick-slot template-matching candidates, split by pick-box type. */
export interface PickCandidates {
  standard: string[]
  ultimates: string[]
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
  /**
   * Normalized crops of the 10 player cards (heroes_coords regions at
   * PLAYER_CARD_COMPARE_SIZE²), captured on every scan for the GSI slot <->
   * scan row correlation (spectate/replay name placement). Buffers are
   * transferred, not copied. Absent when the layout has no heroes_coords.
   */
  playerCardTiles?: { row: number; tile: ArrayBuffer }[]
  /**
   * Hero-name strips (upper half of each player card) as upscaled grayscale
   * PNGs for OCR in the main process. Buffers are transferred. Absent when the
   * layout has no heroes_coords.
   */
  nameStrips?: { row: number; png: ArrayBuffer }[]
  /** Results for payload.retryPoolSlots (only slots that were re-read). */
  poolRetryResults?: ScanResult[]
  /**
   * Model-tile identification via NCC against the reference-tile library
   * (userData/model-tiles). Absent when the library is empty/missing —
   * diagnostic + fallback signal alongside the W-slot classifier
   * identification, compared by the diagnostic harness.
   */
  modelTileMatches?: {
    heroOrder: number
    name: string | null
    score: number
    bestName: string | null
    secondName: string | null
    margin: number | null
  }[]
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
