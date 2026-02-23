import { createStore } from 'zustand/vanilla'
import type { ScanResult } from '@shared/types'
import type { IdentifiedHeroModel } from '@core/domain/types'

// @DEV-GUIDE: Ephemeral draft session state, main-process-only (NOT synced via @zubridge).
// Holds mutable caches and user selections that only exist during an active overlay session:
//
// - initialPoolAbilitiesCache: ML scan results for the initial ability pool (ultimates + standard)
//   Cached so that rescan (selected abilities only) can merge with the original pool.
// - identifiedHeroModelsCache: Hero models identified from the draft board.
// - mySelectedSpotDbId/HeroOrder: The hero slot the user clicked "My Spot" on.
// - mySelectedModelDbHeroId/HeroOrder: The hero model the user clicked "My Model" on.
//
// resetSession() clears everything when the overlay closes. The store is accessed by
// ScanProcessingService (reads caches) and DraftHandlers (user spot/model selection).
// Renderers read this state indirectly via enriched overlay:data payloads, not via direct sync.

export interface DraftSessionSlice {
  initialPoolAbilitiesCache: { ultimates: ScanResult[]; standard: ScanResult[] }
  identifiedHeroModelsCache: IdentifiedHeroModel[]
  mySelectedSpotDbId: number | null
  mySelectedSpotHeroOrder: number | null
  mySelectedModelDbHeroId: number | null
  mySelectedModelHeroOrder: number | null
}

export interface DraftStoreActions {
  resetSession(): void
  setPoolCache(cache: {
    ultimates: ScanResult[]
    standard: ScanResult[]
  }): void
  setHeroModelsCache(models: IdentifiedHeroModel[]): void
  selectMySpot(dbHeroId: number | null, heroOrder: number | null): void
  selectMyModel(dbHeroId: number | null, heroOrder: number | null): void
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

    // Actions
    resetSession: () =>
      set({
        initialPoolAbilitiesCache: { ultimates: [], standard: [] },
        identifiedHeroModelsCache: [],
        mySelectedSpotDbId: null,
        mySelectedSpotHeroOrder: null,
        mySelectedModelDbHeroId: null,
        mySelectedModelHeroOrder: null,
      }),

    setPoolCache: (cache) => set({ initialPoolAbilitiesCache: cache }),

    setHeroModelsCache: (models) =>
      set({ identifiedHeroModelsCache: models }),

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
  }))
}
