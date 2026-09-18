import { createStore } from 'zustand/vanilla'
import type { ScanResult } from '@shared/types'
import type { PickEvent } from '@shared/types/stream'
import type { IdentifiedHeroModel } from '@core/domain/types'
import type { ModelAssignment } from '@core/domain/model-picks-from-ocr'
import { orderByDraftTurns } from '@core/domain/pick-attribution'
import { buildTurnSchedule } from '@core/gsi/draft-clock'
import type {
  PlayerCardCapture,
  CardRowState,
  GsiHeroEvent,
  SlotRowMapping,
} from '@core/domain/slot-row-correlation'

// @DEV-GUIDE: Ephemeral draft session state, main-process-only (NOT synced via @zubridge).
// Holds mutable caches and user selections that only exist during an active overlay session:
//
// - initialPoolAbilitiesCache: ML scan results for the initial ability pool (ultimates + standard)
//   Cached so that rescan (selected abilities only) can merge with the original pool.
// - identifiedHeroModelsCache: Hero models identified from the draft board.
// - mySelectedSpotDbId/HeroOrder: The hero slot the user clicked "My Spot" on.
// - mySelectedModelDbHeroId/HeroOrder: The hero model the user clicked "My Model" on.
//
// resetSession() clears everything when the overlay closes or the user presses Reset.
// Caches/selections are written by ScanProcessingService via store.setState() and by
// DraftHandlers (user spot/model selection). Renderers read this state indirectly via
// enriched overlay:data payloads, not via direct sync.

export interface DraftSessionSlice {
  initialPoolAbilitiesCache: { ultimates: ScanResult[]; standard: ScanResult[] }
  identifiedHeroModelsCache: IdentifiedHeroModel[]
  mySelectedSpotDbId: number | null
  mySelectedSpotHeroOrder: number | null
  mySelectedModelDbHeroId: number | null
  mySelectedModelHeroOrder: number | null
  /** Last ACCEPTED selected-abilities scan (rescan contamination guard baseline). */
  selectedAbilitiesCache: ScanResult[]
  /** Consecutive contamination-guard rejections (capped; see scan-processor). */
  rescanRejectionStreak: number
  /** True when the most recent rescan was discarded by the contamination guard. */
  lastRescanRejected: boolean
  /** True when the most recent rescan was a hasty no-op (contaminated, no new info). */
  lastRescanHasty: boolean
  /** Pool hero orders whose model has been drafted — mirrors modelAssignments
   * (playing mode) for the scan processor's picked tiles and suggestions. */
  pickedModelHeroOrders: number[]
  /** Model -> player attribution, derived from card OCR in playing mode
   * (core/domain/model-picks-from-ocr.ts). */
  modelAssignments: ModelAssignment[]
  /** Attributed pick events (experimental auto-rescan); empty otherwise. */
  draftTimeline: PickEvent[]
  /** Player cards captured at initial scan (NO HERO reference for the GSI
   * slot <-> scan row correlation; see slot-row-correlation.ts). */
  playerCardBaselines: PlayerCardCapture[]
  /** Per-row card change state (pending/changed + first-seen times). */
  playerCardRows: CardRowState[]
  /** Unresolved GSI "slot gained a hero" events (spectate/replay). */
  gsiHeroEvents: GsiHeroEvent[]
  /** Committed GSI slot <-> scan row mappings (sticky for the draft). */
  slotRowMappings: SlotRowMapping[]
  /** OCR'd hero names per player row (ocr-service; names are always English). */
  ocrHeroNamesByRow: Record<
    number,
    { name: string; displayName: string; similarity: number }
  >
  /**
   * OCR'd PLAYER names per row, matched against the names GSI reports (spectate).
   * Resolves a row's identity before its player has drafted a model, which the
   * hero name cannot do. The value is the exact GSI name, so the slot join is
   * equality rather than another fuzzy match.
   */
  ocrPlayerNamesByRow: Record<number, { name: string; similarity: number }>
  /** Latest OCR'd "YOU WILL DRAFT IN" seconds + its capture time (playing
   * mode; countdown-based own-row detection). */
  draftCountdown: { seconds: number; atMs: number } | null
  /** Own row derived from the countdown vs the turn schedule (auto-rescan
   * computes it — it owns the pick-phase anchor; spot-detection consumes).
   * Validated 4/4 on live lobby games 2026-08-26. */
  countdownSpotRow: { row: number; deltaS: number; atMs: number } | null
}

export type { ModelAssignment }

export interface DraftStoreActions {
  resetSession(): void
  selectMySpot(dbHeroId: number | null, heroOrder: number | null): void
  selectMyModel(dbHeroId: number | null, heroOrder: number | null): void
  /** Append picks; the timeline is kept in DRAFT order (each pick at its
   * player's serpentine turn, placed by when it was seen), not discovery order. */
  appendPickEvents(events: PickEvent[]): void
  /** Replace the timeline (corrections/removals), same draft ordering. */
  setDraftTimeline(timeline: PickEvent[]): void
  clearDraftTimeline(): void
}

export type DraftStore = DraftSessionSlice & DraftStoreActions

/** Every turn of an Ability Draft (serpentine, 5 rounds × 10) with its time window. */
const DRAFT_SCHEDULE = buildTurnSchedule()

export function createDraftStore() {
  return createStore<DraftStore>((set) => ({
    // Initial state
    initialPoolAbilitiesCache: { ultimates: [], standard: [] },
    identifiedHeroModelsCache: [],
    mySelectedSpotDbId: null,
    mySelectedSpotHeroOrder: null,
    mySelectedModelDbHeroId: null,
    mySelectedModelHeroOrder: null,
    selectedAbilitiesCache: [],
    rescanRejectionStreak: 0,
    lastRescanRejected: false,
    lastRescanHasty: false,
    pickedModelHeroOrders: [],
    modelAssignments: [],
    draftTimeline: [],
    playerCardBaselines: [],
    playerCardRows: [],
    gsiHeroEvents: [],
    slotRowMappings: [],
    ocrHeroNamesByRow: {},
    ocrPlayerNamesByRow: {},
    draftCountdown: null,
    countdownSpotRow: null,

    // Actions
    resetSession: () =>
      set({
        initialPoolAbilitiesCache: { ultimates: [], standard: [] },
        identifiedHeroModelsCache: [],
        mySelectedSpotDbId: null,
        mySelectedSpotHeroOrder: null,
        mySelectedModelDbHeroId: null,
        mySelectedModelHeroOrder: null,
        selectedAbilitiesCache: [],
        rescanRejectionStreak: 0,
        lastRescanRejected: false,
        lastRescanHasty: false,
        pickedModelHeroOrders: [],
        modelAssignments: [],
        draftTimeline: [],
        playerCardBaselines: [],
        playerCardRows: [],
        gsiHeroEvents: [],
        slotRowMappings: [],
        ocrHeroNamesByRow: {},
        ocrPlayerNamesByRow: {},
        draftCountdown: null,
        countdownSpotRow: null,
      }),

    selectMySpot: (dbHeroId, heroOrder) =>
      set({
        mySelectedSpotDbId: dbHeroId,
        mySelectedSpotHeroOrder: heroOrder,
      }),

    selectMyModel: (dbHeroId, heroOrder) =>
      set({
        mySelectedModelDbHeroId: dbHeroId,
        mySelectedModelHeroOrder: heroOrder,
      }),

    appendPickEvents: (events) =>
      set((state) => ({
        draftTimeline: orderByDraftTurns([...state.draftTimeline, ...events], DRAFT_SCHEDULE),
      })),

    setDraftTimeline: (timeline) =>
      set({ draftTimeline: orderByDraftTurns(timeline, DRAFT_SCHEDULE) }),

    clearDraftTimeline: () => set({ draftTimeline: [], modelAssignments: [] }),
  }))
}
