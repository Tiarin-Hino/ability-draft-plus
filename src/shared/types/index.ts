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
  overlayOpacity: number
  overlayAnchor: 'left' | 'right'
  streamPort: number
  streamAutostart: boolean
  /** GSI-driven automatic draft tracking (auto initial scan, auto spot/model,
   * turn-driven rescans + pick attribution). Default off. */
  experimentalAutoDraftTracking: boolean
  /** Seconds to wait after the draft clock is identified before the automatic
   * initial scan (slower PCs need the draft screen fully rendered). */
  autoInitialScanDelayS: number
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
  /**
   * Present only when pick-slot template matching REJECTED its best candidate
   * (name === null on a non-empty pick box) — carries what would have matched
   * (and who ran it closest, for margin failures) so the miss is diagnosable
   * from main-process logs.
   */
  rejectedMatch?: {
    bestName: string | null
    secondName: string | null
    margin: number | null
  }
}

export interface EnrichedScanSlot extends ScanResult {
  displayName: string
  winrate: number | null
  pickRate: number | null
  consolidatedScore: number
  isGeneralTopTier: boolean
  isSynergySuggestionForMySpot: boolean
  isUltimateFromDb: boolean
  /** True when the ML model could not identify this slot (confidence below threshold). */
  isUnknown?: boolean
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
  /** My Spot PLAYER row 0-9 (authoritative — the dbId above is the MODEL hero
   * and must not be resolved against pool rows; see spot-detection-service). */
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
  heroesCoords: SlotCoordinate[]
  heroesParams: { width: number; height: number }
  modelsCoords: SlotCoordinate[]
  /** When automatic draft tracking is on, the overlay hides the manual
   * My Spot / My Model buttons (both are selected automatically via GSI). */
  autoDraftTrackingEnabled: boolean
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
  /** Valve internal names — optional (populated by op-trap-filter; consumed by the streamer view for icons). */
  ability1Name?: string
  ability2Name?: string
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
  /** True when tile-diff detection saw this model get picked (never reverts). */
  isPicked?: boolean
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
