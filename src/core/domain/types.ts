import type { AbilityDetail, ScanResult, AppSettings } from '@shared/types'
import type {
  SynergyPartner,
  AbilitySynergyPair,
  HeroAbilitySynergyRow,
} from '@core/database/repositories/synergy-repository'

// @DEV-GUIDE: Domain types for the scan processing pipeline. Defines:
// - ScoredEntity / TopTierEntity: Abilities/heroes with consolidated scores and top-tier flags
// - IdentifiedHeroModel: A hero identified from its defining ability via ML scan
// - DraftSessionState: Mutable state carried between initial scan and rescans
// - Repository interfaces (HeroLookup, AbilityLookup, SynergyLookup, TripletLookup, etc.):
//   Dependency injection contracts so domain logic stays pure (zero Electron imports).
// - ScanProcessorDeps: Aggregated deps interface passed to processScanResults().
//
// These types are consumed by scan-processor.ts, scoring.ts, hero-identification.ts,
// synergy-enrichment.ts, op-trap-filter.ts, and top-tier.ts.

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** An entity (ability or hero model) prepared for scoring. */
export interface ScoredEntity {
  entityType: 'ability' | 'hero'
  internalName: string
  displayName: string
  winrate: number | null
  pickRate: number | null
  consolidatedScore: number
  isUltimateFromCoordSource?: boolean
  isUltimateFromDb?: boolean
  /** Hero-order on screen (present for both ability slots and hero entities). */
  heroOrder?: number
  /** DB hero ID — only present for hero entities. */
  dbHeroId?: number | null
}

/** Entity with top-tier selection flags applied. */
export interface TopTierEntity extends ScoredEntity {
  isSynergySuggestionForMySpot: boolean
  isGeneralTopTier: boolean
}

// ---------------------------------------------------------------------------
// Hero Identification
// ---------------------------------------------------------------------------

/** A hero identified from its defining ability (ability_order === 2). */
export interface IdentifiedHeroModel {
  heroOrder: number
  heroName: string
  heroDisplayName: string
  dbHeroId: number | null
  winrate: number | null
  highSkillWinrate: number | null
  pickRate: number | null
  hsPickRate: number | null
  identificationConfidence: number
}

// ---------------------------------------------------------------------------
// Scan Processor I/O
// ---------------------------------------------------------------------------

/** State that the scan processor reads from and writes to. */
export interface DraftSessionState {
  initialPoolAbilitiesCache: { ultimates: ScanResult[]; standard: ScanResult[] }
  identifiedHeroModelsCache: IdentifiedHeroModel[]
  mySelectedSpotDbId: number | null
  mySelectedSpotHeroOrder: number | null
  mySelectedModelDbHeroId: number | null
  mySelectedModelHeroOrder: number | null
}

// ---------------------------------------------------------------------------
// Repository Interfaces (dependency-injection contracts — no Electron imports)
// ---------------------------------------------------------------------------

export interface HeroLookup {
  getByAbilityName(
    abilityName: string,
  ): { heroId: number; heroName: string; heroDisplayName: string | null } | null
  getById(heroId: number): {
    heroId: number
    name: string
    displayName: string
    winrate: number | null
    highSkillWinrate: number | null
    pickRate: number | null
    hsPickRate: number | null
  } | null
}

export interface AbilityLookup {
  getDetails(names: string[]): Map<string, AbilityDetail>
}

export interface SynergyLookup {
  getHighWinrateCombinations(
    baseAbilityName: string,
    draftPoolNames: string[],
  ): SynergyPartner[]
  getAllOPCombinations(threshold: number): AbilitySynergyPair[]
  getAllTrapCombinations(threshold: number): AbilitySynergyPair[]
  getAllHeroSynergies(threshold: number): HeroAbilitySynergyRow[]
  getAllHeroTrapSynergies(threshold: number): HeroAbilitySynergyRow[]
  getAllHeroAbilitySynergiesUnfiltered(): HeroAbilitySynergyRow[]
}

export interface TripletLookup {
  getThirdAbilitiesForPairs(
    pairKeys: { a: number; b: number }[],
  ): Map<string, { thirdAbilityName: string; thirdAbilityDisplayName: string; tripletWinrate: number; tripletPicks: number }[]>
}

export interface AbilityIdLookup {
  getNameToIdMap(): Map<string, number>
}

export interface SettingsLookup {
  getSettings(): AppSettings
}

export interface ScanProcessorDeps {
  heroes: HeroLookup
  abilities: AbilityLookup & AbilityIdLookup
  synergies: SynergyLookup
  triplets?: TripletLookup
  settings: SettingsLookup
}
