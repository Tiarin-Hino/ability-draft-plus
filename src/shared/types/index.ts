export interface Hero {
  heroId: number
  name: string
  displayName: string
  winrate: number | null
  highSkillWinrate: number | null
  pickRate: number | null
  hsPickRate: number | null
  windrunId: number | null
}

export interface AbilityDetail {
  abilityId: number
  name: string
  displayName: string
  heroId: number
  winrate: number | null
  highSkillWinrate: number | null
  pickRate: number | null
  hsPickRate: number | null
  isUltimate: boolean
  abilityOrder: number
}

export interface AbilitySynergy {
  synergyId: number
  baseAbilityId: number
  synergyAbilityId: number
  synergyWinrate: number
  synergyIncrease: number | null
  isOp: boolean
}

export interface HeroAbilitySynergy {
  synergyId: number
  heroId: number
  abilityId: number
  synergyWinrate: number
  synergyIncrease: number | null
  isOp: boolean
}

export interface SystemDisplayInfo {
  width: number
  height: number
  scaleFactor: number
  resolutionString: string
}

export interface AppSettings {
  opThreshold: number
  trapThreshold: number
  language: string
  themeMode: 'light' | 'dark' | 'system'
}

export interface SlotCoordinate {
  x: number
  y: number
  width: number
  height: number
  hero_order: number
  ability_order?: number
  is_ultimate?: boolean
}

export interface ResolutionLayout {
  heroes_params: { width: number; height: number }
  selected_abilities_params: { width: number; height: number }
  ultimate_slots_coords: SlotCoordinate[]
  standard_slots_coords: SlotCoordinate[]
  selected_abilities_coords?: SlotCoordinate[]
  models_coords?: SlotCoordinate[]
  heroes_coords?: SlotCoordinate[]
}

export interface LayoutCoordinatesConfig {
  resolutions: Record<string, ResolutionLayout>
}

export interface ScanResult {
  name: string | null
  confidence: number
  hero_order: number
  ability_order: number
  is_ultimate: boolean
  coord: SlotCoordinate
}

export interface EnrichedScanSlot extends ScanResult {
  displayName: string
  winrate: number | null
  pickRate: number | null
  consolidatedScore: number
  isGeneralTopTier: boolean
  isSynergySuggestionForMySpot: boolean
  isUltimateFromDb: boolean
  highWinrateCombinations: SynergyPairDisplay[]
  lowWinrateCombinations: SynergyPairDisplay[]
  strongHeroSynergies: HeroSynergyDisplay[]
  weakHeroSynergies: HeroSynergyDisplay[]
}

export interface OverlayDataPayload {
  initialSetup: boolean
  scanData: {
    ultimates: EnrichedScanSlot[]
    standard: EnrichedScanSlot[]
    selectedAbilities: EnrichedScanSlot[]
  } | null
  targetResolution: string
  scaleFactor: number
  opCombinations: SynergyPairDisplay[]
  trapCombinations: SynergyPairDisplay[]
  heroSynergies: HeroSynergyDisplay[]
  heroTraps: HeroSynergyDisplay[]
  heroModels: HeroModelDisplay[]
  heroesForMySpotUI: HeroSpotDisplay[]
  selectedHeroForDraftingDbId: number | null
  selectedModelHeroOrder: number | null
  heroesCoords: SlotCoordinate[]
  heroesParams: { width: number; height: number }
  modelsCoords: SlotCoordinate[]
}

export interface ThirdAbilitySuggestion {
  name: string
  displayName: string
  tripletWinrate: number
  tripletPicks: number
}

export interface SynergyPairDisplay {
  ability1DisplayName: string
  ability2DisplayName: string
  synergyWinrate: number
  suggestedThird?: ThirdAbilitySuggestion
  inflatedSynergy?: boolean
}

export interface HeroSynergyDisplay {
  heroDisplayName: string
  abilityDisplayName: string
  synergyWinrate: number
}

export interface HeroModelDisplay {
  heroOrder: number
  heroName: string
  heroDisplayName: string
  dbHeroId: number | null
  winrate: number | null
  pickRate: number | null
  consolidatedScore: number
  isGeneralTopTier: boolean
  identificationConfidence: number
  strongAbilitySynergies: HeroSynergyDisplay[]
  weakAbilitySynergies: HeroSynergyDisplay[]
}

export interface HeroSpotDisplay {
  heroOrder: number
  heroName: string
  dbHeroId: number
}

export interface UpdateNotification {
  status: 'not-available' | 'available' | 'downloading' | 'downloaded' | 'error'
  info?: Record<string, unknown>
  error?: string
  progress?: { percent: number; transferred: number; total: number }
}
