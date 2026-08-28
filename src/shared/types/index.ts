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

/** Personal (per linked Windrun profile) stats for one ability. */
export interface PersonalAbilityStats {
  games: number
  wins: number
  winrate: number
  avgPickPosition: number | null
}

/** Personal (per linked Windrun profile) stats for one hero model. */
export interface PersonalHeroStats {
  games: number
  wins: number
  winrate: number
}

/** Linked Windrun player profile shown in settings (cached in Metadata). */
export interface PlayerProfileInfo {
  playerId: number
  nickname: string | null
  avatarUrl: string | null
  /** ISO timestamp of the last successful stats fetch, null if never fetched. */
  lastFetchedAt: string | null
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
  /** Role-aware suggestions mode. 'off' (default) keeps scoring bit-identical
   * to the role-less path; 'fixed' scores against roleFixedPositions; 'dynamic'
   * infers the vacant position(s) from teammates' build trajectories. */
  roleMode: 'off' | 'fixed' | 'dynamic'
  /** Fixed-mode position multi-select (values 1-5). Ignored unless roleMode==='fixed'. */
  roleFixedPositions: number[]
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
  /** Linked-profile games on this ability (present only when personalization is active). */
  personalGames?: number
  /** Linked-profile winrate on this ability [0, 1]. */
  personalWinrate?: number
  /** consolidatedScore minus the global-only score — how far personalization moved it. */
  personalScoreDelta?: number
  /** True when this slot is top-tier ONLY because of the linked profile's stats
   * (a global-only ranking would not recommend it). Drives the corner marker. */
  isPersonallyDriven?: boolean
  /** consolidatedScore minus the role-less score — how far the role layer moved
   * it (present only when a role mode is active and the layer contributed). */
  roleScoreDelta?: number
  /** The effective position that produced roleScoreDelta's best fit (1-5). */
  roleBestPosition?: number
  /** Needs-engine reason chips ('covers:<need>' | 'duplicate:<need>'). */
  roleReasons?: string[]
  /** Mechanically inert on the selected model (cleave on ranged) — never top-tier. */
  inertOnModel?: boolean
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
  /** Role-aware suggestions context (absent when roleMode==='off' or My Spot is
   * unknown — the payload is then bit-identical to the role-less path). */
  roleContext?: RoleContextDisplay
}

/** What the role layer decided this scan — drives the overlay's role UI. */
export interface RoleContextDisplay {
  mode: 'fixed' | 'dynamic'
  /** Why the layer is (in)active THIS scan: 'active' = scoring applied;
   * 'noData' = DB has no shift columns yet (pre-2.6 scrape); 'noSpot' = My
   * Spot unknown. Present on every scan processed with a role mode on, so the
   * overlay never has to guess — an absent roleContext then only ever means
   * "the last scan predates the mode toggle". */
  status: 'active' | 'noData' | 'noSpot'
  /** Positions suggestions were scored against. Empty in dynamic mode while the
   * evidence gate is closed (scoring is then neutral). */
  effectivePositions: number[]
  /** Mean build greed of teammates with picks, [-1, +1]; null before any picks. */
  teamGreed: number | null
  /** Per-teammate estimated positions (hero_order keyed; null until confident). */
  teammates: {
    heroOrder: number
    estimatedPosition: number | null
    /** picks/4, a display hint — estimates are approximations, never facts. */
    confidence: number
  }[]
  /** Dynamic mode only: false while waiting for enough teammate picks. */
  dynamicGateOpen?: boolean
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
  /** Linked-profile games on this hero (present only when personalization is active). */
  personalGames?: number
  /** Linked-profile winrate on this hero [0, 1]. */
  personalWinrate?: number
  /** consolidatedScore minus the global-only score — how far personalization moved it. */
  personalScoreDelta?: number
  /** True when this model is top-tier ONLY because of the linked profile's stats. */
  isPersonallyDriven?: boolean
  /** Role-layer adjustment included in the score (scaled — models carry a far
   * weaker role signal than abilities). */
  roleScoreDelta?: number
  /** Effective position (1-5) that produced the best role fit. */
  roleBestPosition?: number
  identificationConfidence: number
  strongAbilitySynergies: HeroSynergyDisplay[]
  weakAbilitySynergies: HeroSynergyDisplay[]
}

export interface HeroSpotDisplay {
  heroOrder: number
  heroName: string
  dbHeroId: number
}
