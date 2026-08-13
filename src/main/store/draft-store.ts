import { createStore } from 'zustand/vanilla'
import type { ScanResult } from '@shared/types'
import type { PickEvent } from '@shared/types/stream'
import type { IdentifiedHeroModel } from '@core/domain/types'
import type { ModelTileCapture } from '@core/domain/model-pick-detection'

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
  /** Model tiles captured at initial scan (unpicked reference for pick detection). */
  modelTileBaselines: ModelTileCapture[]
  /** Model tiles that read changed in the last scan, awaiting confirmation. */
  pendingModelChanges: number[]
  /** Pool hero orders whose model was detected as picked (never reverts). */
  pickedModelHeroOrders: number[]
  /** Attributed pick events (experimental auto-rescan); empty otherwise. */
  draftTimeline: PickEvent[]
}

export interface DraftStoreActions {
  resetSession(): void
  selectMySpot(dbHeroId: number | null, heroOrder: number | null): void
  selectMyModel(dbHeroId: number | null, heroOrder: number | null): void
  appendPickEvents(events: PickEvent[]): void
  clearDraftTimeline(): void
}

export type DraftStore = DraftSessionSlice & DraftStoreActions

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
    modelTileBaselines: [],
    pendingModelChanges: [],
    pickedModelHeroOrders: [],
    draftTimeline: [],

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
        modelTileBaselines: [],
        pendingModelChanges: [],
        pickedModelHeroOrders: [],
        draftTimeline: [],
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
      set((state) => ({ draftTimeline: [...state.draftTimeline, ...events] })),

    clearDraftTimeline: () => set({ draftTimeline: [] }),
  }))
}
