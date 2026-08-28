import type {
  ScanResult,
  EnrichedScanSlot,
  OverlayDataPayload,
  HeroModelDisplay,
  HeroSpotDisplay,
  SlotCoordinate,
} from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'
import type {
  ScoredEntity,
  DraftSessionState,
  ScanProcessorDeps,
  IdentifiedHeroModel,
} from './types'
import { calculateConsolidatedScore, calculatePersonalizedScore } from './scoring'
import { computeShiftAxes, type ShiftAxes } from './shift-axes'
import {
  resolveRoleContext,
  computeRoleScore,
  toRoleContextDisplay,
  type RoleContext,
  type RoleTagInput,
} from './role-scoring'
import { isInertOnModel, type AbilityTag } from './ability-tags'
import { identifyHeroModels } from './hero-identification'
import {
  getAbilitySynergySplit,
  getHeroSynergiesForAbility,
  getAbilitySynergiesForHero,
} from './synergy-enrichment'
import {
  filterRelevantOPCombinations,
  filterRelevantTrapCombinations,
  filterRelevantHeroSynergies,
  filterRelevantHeroTraps,
} from './op-trap-filter'
import { determineTopTierEntities } from './top-tier'
import { detectModelPicks } from './model-pick-detection'
import type { ModelTileCapture } from './model-pick-detection'
import {
  RESCAN_GUARD_MAX_CONSECUTIVE_REJECTIONS,
  PERSONAL_SCORE_DELTA_EPSILON,
  ROLE_MODEL_WEIGHT_SCALE,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Central business logic — transforms raw ML scan results into a fully-enriched
// OverlayDataPayload for the overlay UI. This is pure TypeScript with ZERO Electron imports.
//
// processScanResults() pipeline (14 phases):
// 1. Branch initial scan vs rescan (rescan diffs against cached pool)
// 2. Collect unique ability names from pool and picked abilities
// 3. Batch DB lookup for ability details (winrate, pick rate, display name)
// 3.5. Role context (role-aware suggestions): shift axes + effective positions +
//      teammate estimates — null with roleMode 'off' (bit-identical path)
// 4. Build heroes-in-pool set (from identified hero models)
// 5. Per-ability synergy enrichment (high/low winrate partner pairs)
// 6. Per-ability hero synergies (which heroes synergize with each ability)
// 7. Per-hero-model ability synergies (which abilities synergize with each hero)
// 8. Global OP/Trap combination filtering (above/below threshold)
// 8.5. Enrich pairs with triplet context (suggested third ability badge)
// 9. My Spot synergistic partners (abilities synergizing with user's picked abilities)
// 10. Score all entities (consolidated score = 0.4 * winrate + 0.6 * pickOrder;
//     with a linked Windrun profile the inputs are personal-blended — scoring.ts;
//     with a role mode active, abilities get the capped role delta on top — role-scoring.ts)
// 11. Check if My Spot already picked an ultimate
// 12. Determine top-tier entities (max 10, synergy suggestions prioritized)
// 13. Enrich scan slots with all computed data for overlay display
// 14. Assemble final OverlayDataPayload
//
// The function is deterministic and side-effect-free. All DB access is via the deps interface
// (dependency injection). Called by ScanProcessingService in the main process.

export interface ScanProcessorInput {
  rawResults: InitialScanResults | ScanResult[]
  isInitialScan: boolean
  state: DraftSessionState
  deps: ScanProcessorDeps
  modelCoords: SlotCoordinate[]
  heroesCoords: SlotCoordinate[]
  heroesParams: { width: number; height: number }
  targetResolution: string
  scaleFactor: number
  /**
   * Normalized model portrait tiles captured with this scan. Initial scan:
   * stored as the unpicked baseline. Rescan: diffed against the baseline to
   * detect picked models (see model-pick-detection.ts).
   */
  modelTiles?: ModelTileCapture[]
}

export interface ScanProcessorOutput {
  overlayPayload: OverlayDataPayload
  updatedState: DraftSessionState
  /**
   * True when a rescan was discarded by the contamination guard (a previously
   * confident pick slot read as unknown — an in-game hover tooltip covered the
   * tiles). State is unchanged and the payload is rebuilt from the cached picks;
   * callers (auto-rescan) must not treat the scan as fresh evidence.
   */
  rescanRejected?: boolean
  /** Pool hero orders whose model pick was committed by THIS scan. */
  newlyPickedModels?: number[]
  /**
   * True when the guard hit RESCAN_GUARD_MAX_CONSECUTIVE_REJECTIONS and this
   * (still-contaminated-looking) rescan was accepted as the new baseline —
   * escape hatch against a poisoned baseline stalling updates forever.
   */
  rescanRebaselined?: boolean
  /**
   * True when a contaminated-looking rescan carried NO new picks — a "hasty"
   * capture (scan landed mid-pick or an overlay briefly covered the slots).
   * Skipped as a harmless no-op: state untouched, no rejection streak, and the
   * next rescan starts fresh.
   */
  rescanHasty?: boolean
}

/** Stable identity of a selected-abilities slot: its layout coordinate. */
function slotKey(slot: ScanResult): string {
  return `${slot.coord.x},${slot.coord.y}`
}

/**
 * Contamination guard: picks never un-pick, so a scanned slot that previously
 * held a confident name but now reads unknown means the capture was obscured
 * (hover tooltip). A slot changing to a DIFFERENT confident name is allowed —
 * that is a correction of an earlier misread, and rejecting it would deadlock.
 * Rescans may be PARTIAL (targeted auto-rescan); only slots present in the
 * scan are judged — unscanned baseline slots carry no evidence either way.
 */
function isRescanContaminated(
  previous: ScanResult[],
  scanned: ScanResult[],
): boolean {
  const prevByCoord = new Map(previous.map((s) => [slotKey(s), s]))
  for (const next of scanned) {
    const prev = prevByCoord.get(slotKey(next))
    if (prev !== undefined && prev.name !== null && next.name === null) {
      return true
    }
  }
  return false
}

/**
 * Merges a (possibly partial) rescan into the selected-abilities baseline by
 * slot coordinate: scanned slots replace their baseline entries, unscanned
 * baseline entries are kept, never-seen slots are appended in scan order.
 */
function mergeSelectedSlots(
  previous: ScanResult[],
  scanned: ScanResult[],
): ScanResult[] {
  const scannedByCoord = new Map(scanned.map((s) => [slotKey(s), s]))
  const merged = previous.map((p) => scannedByCoord.get(slotKey(p)) ?? p)
  const prevKeys = new Set(previous.map(slotKey))
  for (const s of scanned) {
    if (!prevKeys.has(slotKey(s))) merged.push(s)
  }
  return merged
}

/**
 * Main orchestration function. Transforms raw ML scan results into a fully-enriched
 * OverlayDataPayload. Pure TypeScript — zero Electron imports.
 */
export function processScanResults(
  input: ScanProcessorInput,
): ScanProcessorOutput {
  const { rawResults, isInitialScan, deps, modelCoords, heroesCoords, heroesParams, targetResolution, scaleFactor } = input
  const state = cloneState(input.state)

  // --- Phase 1: Initial vs Rescan branching ---
  let ultimates: ScanResult[]
  let standard: ScanResult[]
  let selectedAbilities: ScanResult[]
  let rescanRejected = false
  let rescanRebaselined = false
  let rescanHasty = false

  let newlyPickedModels: number[] = []

  if (isInitialScan) {
    const initial = rawResults as InitialScanResults
    ultimates = initial.ultimates
    standard = initial.standard
    selectedAbilities = initial.selectedAbilities
    state.selectedAbilitiesCache = [...selectedAbilities]
    state.rescanRejectionStreak = 0

    // Model-tile baseline: the unpicked reference state for pick detection
    state.modelTileBaselines = input.modelTiles ?? []
    state.pendingModelChanges = []
    state.pickedModelHeroOrders = []

    // Cache pool for future rescans
    state.initialPoolAbilitiesCache = {
      ultimates: [...ultimates],
      standard: [...standard],
    }

    // Reset user selections on new draft
    state.mySelectedSpotDbId = null
    state.mySelectedSpotHeroOrder = null
    state.mySelectedModelDbHeroId = null
    state.mySelectedModelHeroOrder = null

    // Identify hero models from hero-defining abilities
    state.identifiedHeroModelsCache = identifyHeroModels(
      initial.heroDefiningAbilities,
      modelCoords,
      deps.heroes,
    )
  } else {
    // Rescan: rawResults = newly scanned selected/picked ability slots. The scan
    // may be PARTIAL (targeted auto-rescan covers only specific players' rows);
    // accepted results MERGE into selectedAbilitiesCache by slot coordinate.
    const scannedSlots = rawResults as ScanResult[]

    const contaminated = isRescanContaminated(
      state.selectedAbilitiesCache,
      scannedSlots,
    )
    const baselineNames = new Set(
      state.selectedAbilitiesCache.map((s) => s.name).filter(Boolean),
    )
    const hasNewPicks = scannedSlots.some(
      (a) => a.name !== null && !baselineNames.has(a.name),
    )

    if (contaminated && !hasNewPicks) {
      // Hasty capture: it carries no new information at all, so there is
      // nothing to protect against — skip it without counting a rejection.
      rescanHasty = true
      selectedAbilities = state.selectedAbilitiesCache
    } else if (
      contaminated &&
      state.rescanRejectionStreak < RESCAN_GUARD_MAX_CONSECUTIVE_REJECTIONS
    ) {
      // Discard this capture: keep state untouched and rebuild the payload from
      // the last accepted picks so consumers still get a consistent refresh.
      rescanRejected = true
      state.rescanRejectionStreak += 1
      selectedAbilities = state.selectedAbilitiesCache
    } else {
      // Clean scan, or the rejection cap was hit — accept and re-baseline.
      rescanRebaselined = contaminated
      state.rescanRejectionStreak = 0
      state.selectedAbilitiesCache = mergeSelectedSlots(
        state.selectedAbilitiesCache,
        scannedSlots,
      )
      selectedAbilities = state.selectedAbilitiesCache

      // Remove every known picked ability from the cached pool (idempotent —
      // names picked in earlier scans are already gone from the pool)
      const pickedNames = new Set(
        selectedAbilities.map((a) => a.name).filter(Boolean) as string[],
      )
      state.initialPoolAbilitiesCache = {
        ultimates: state.initialPoolAbilitiesCache.ultimates.filter(
          (a) => !pickedNames.has(a.name ?? ''),
        ),
        standard: state.initialPoolAbilitiesCache.standard.filter(
          (a) => !pickedNames.has(a.name ?? ''),
        ),
      }
    }

    ultimates = state.initialPoolAbilitiesCache.ultimates
    standard = state.initialPoolAbilitiesCache.standard

    // Picked-model detection runs on every rescan, independent of the ability
    // contamination verdict (the model arcs are separate screen regions and
    // the two-scan persistence rule absorbs capture glitches)
    if (input.modelTiles && state.modelTileBaselines.length > 0) {
      const detection = detectModelPicks({
        baselines: state.modelTileBaselines,
        current: input.modelTiles,
        pending: state.pendingModelChanges,
        picked: state.pickedModelHeroOrders,
      })
      state.pickedModelHeroOrders = detection.picked
      state.pendingModelChanges = detection.pending
      newlyPickedModels = detection.newlyPicked
    }
  }

  // --- Phase 2: Collect ability names ---
  const uniquePoolNames = new Set<string>()
  for (const slot of [...ultimates, ...standard]) {
    if (slot.name) uniquePoolNames.add(slot.name)
  }

  const pickedAbilityNames = new Set<string>()
  for (const slot of selectedAbilities) {
    if (slot.name) pickedAbilityNames.add(slot.name)
  }

  const allRelevantNames = new Set([...uniquePoolNames, ...pickedAbilityNames])
  const poolNamesArray = Array.from(uniquePoolNames)

  // --- Phase 3: Database lookups ---
  const abilityDetailsMap = deps.abilities.getDetails(
    Array.from(allRelevantNames),
  )
  const settings = deps.settings.getSettings()
  const { opThreshold, trapThreshold } = settings

  // Personal stats of the linked Windrun profile (empty maps = personalization
  // off; scores then match the global-only path exactly — see scoring.ts)
  const personalAbilityStats =
    deps.playerStats?.getAbilityStatsByName() ??
    new Map<string, import('@shared/types').PersonalAbilityStats>()
  const personalHeroStats =
    deps.playerStats?.getHeroStatsByName() ??
    new Map<string, import('@shared/types').PersonalHeroStats>()

  // --- Phase 3.5: Role context (role-aware suggestions) ---
  // Only computed with a role mode EXPLICITLY active AND My Spot known —
  // otherwise null, and every downstream score is bit-identical to the
  // role-less path (anything but 'fixed'/'dynamic' counts as off).
  const roleModeActive =
    settings.roleMode === 'fixed' || settings.roleMode === 'dynamic'
  const allShifts = roleModeActive ? deps.abilities.getAllShifts() : []
  // A database that predates the shifts scrape has NULL in every shift column;
  // role scoring would then hand every ability the same meaningless delta.
  // Treat "no shift data at all" as role-off until the next data update.
  const hasShiftData = allShifts.some((row) => row.gpmShift !== null)
  const shiftAxesByName: Map<string, ShiftAxes> =
    roleModeActive && hasShiftData ? computeShiftAxes(allShifts) : new Map()
  // Hero MODELS have their own shift entries — percentiled among heroes only
  // (their raw magnitudes are far below ability shifts) and weight-scaled at
  // scoring time (ROLE_MODEL_WEIGHT_SCALE).
  const heroAxesByName: Map<string, ShiftAxes> =
    roleModeActive && hasShiftData
      ? computeShiftAxes(deps.heroes.getAllShifts())
      : new Map()
  const roleContext: RoleContext | null =
    roleModeActive && hasShiftData
      ? resolveRoleContext(
          settings,
          selectedAbilities,
          state.mySelectedSpotHeroOrder,
          shiftAxesByName,
        )
      : null

  // Tags layer: my own picks' tag sets feed the needs engine; the selected
  // model's attack type drives the inert-ability hard filter. Both are no-ops
  // without the tags dep (dataset not shipped/loaded).
  const myPickTags: ReadonlySet<AbilityTag>[] =
    deps.tags !== undefined && state.mySelectedSpotHeroOrder !== null
      ? selectedAbilities
          .filter((s) => s.hero_order === state.mySelectedSpotHeroOrder && s.name)
          .map((s) => deps.tags!.getTags(s.name!))
          .filter((t): t is ReadonlySet<AbilityTag> => t !== undefined)
      : []
  const myModelAttackType = (() => {
    if (deps.tags === undefined || state.mySelectedModelDbHeroId === null) return undefined
    const model = state.identifiedHeroModelsCache.find(
      (m) => m.dbHeroId === state.mySelectedModelDbHeroId,
    )
    return model !== undefined ? deps.tags.getHeroAttackType(model.heroName) : undefined
  })()

  // --- Phase 4: Build heroes-in-pool set ---
  const heroesInPool = new Set<string>()
  for (const model of state.identifiedHeroModelsCache) {
    if (model.dbHeroId !== null) {
      heroesInPool.add(model.heroName)
    }
  }

  // --- Phase 5: Per-ability synergy enrichment ---
  const abilitySynergyMap = new Map<
    string,
    {
      high: { ability1DisplayName: string; ability2DisplayName: string; synergyWinrate: number }[]
      low: { ability1DisplayName: string; ability2DisplayName: string; synergyWinrate: number }[]
    }
  >()

  for (const abilityName of uniquePoolNames) {
    const details = abilityDetailsMap.get(abilityName)
    const displayName = details?.displayName ?? abilityName
    const split = getAbilitySynergySplit(
      abilityName,
      poolNamesArray,
      deps.synergies,
    )
    // Fix ability1DisplayName to use the display name
    abilitySynergyMap.set(abilityName, {
      high: split.high.map((s) => ({
        ...s,
        ability1DisplayName: displayName,
      })),
      low: split.low.map((s) => ({
        ...s,
        ability1DisplayName: displayName,
      })),
    })
  }

  // --- Phase 6: Per-ability hero synergies ---
  const allHeroAbilitySynergies =
    deps.synergies.getAllHeroAbilitySynergiesUnfiltered()

  const abilityHeroSynergyMap = new Map<
    string,
    {
      strong: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
      weak: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
    }
  >()

  for (const abilityName of uniquePoolNames) {
    const heroSyn = getHeroSynergiesForAbility(
      abilityName,
      allHeroAbilitySynergies,
      heroesInPool,
    )
    abilityHeroSynergyMap.set(abilityName, heroSyn)
  }

  // --- Phase 7: Per-hero-model ability synergies ---
  const poolAndPickedNames = new Set([
    ...uniquePoolNames,
    ...pickedAbilityNames,
  ])

  const heroModelSynergyMap = new Map<
    string,
    {
      strong: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
      weak: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
    }
  >()

  for (const model of state.identifiedHeroModelsCache) {
    if (model.dbHeroId === null) continue
    const heroSyn = getAbilitySynergiesForHero(
      model.heroName,
      allHeroAbilitySynergies,
      poolAndPickedNames,
    )
    heroModelSynergyMap.set(model.heroName, heroSyn)
  }

  // --- Phase 8: OP/Trap combinations for global panels ---
  const allOPCombs = deps.synergies.getAllOPCombinations(opThreshold)
  const opCombinations = filterRelevantOPCombinations(
    allOPCombs,
    uniquePoolNames,
    pickedAbilityNames,
  )

  const allHeroSynergiesOP = deps.synergies.getAllHeroSynergies(opThreshold)
  const heroSynergies = filterRelevantHeroSynergies(
    allHeroSynergiesOP,
    uniquePoolNames,
    pickedAbilityNames,
    heroesInPool,
    opThreshold,
  )

  const allTrapCombs = deps.synergies.getAllTrapCombinations(trapThreshold)
  const trapCombinations = filterRelevantTrapCombinations(
    allTrapCombs,
    uniquePoolNames,
    pickedAbilityNames,
  )

  const allHeroTrapsDB = deps.synergies.getAllHeroTrapSynergies(trapThreshold)
  const heroTraps = filterRelevantHeroTraps(
    allHeroTrapsDB,
    uniquePoolNames,
    pickedAbilityNames,
    heroesInPool,
  )

  // --- Phase 8.5: Enrich pairs with triplet context ---
  if (deps.triplets) {
    enrichPairsWithTriplets(opCombinations, trapCombinations, deps)
  }

  // --- Phase 9: My Spot synergistic partners ---
  const synergisticPartnersInPool = new Set<string>()
  if (state.mySelectedSpotDbId !== null) {
    for (const slot of selectedAbilities) {
      if (!slot.name) continue
      const combos = deps.synergies.getHighWinrateCombinations(
        slot.name,
        poolNamesArray,
      )
      for (const combo of combos) {
        synergisticPartnersInPool.add(combo.partnerInternalName)
      }
    }
  }

  // --- Phase 10: Score all entities ---
  const allScoredEntities = buildScoredEntities(
    ultimates,
    standard,
    abilityDetailsMap,
    state.identifiedHeroModelsCache,
    new Set(state.pickedModelHeroOrders),
    personalAbilityStats,
    personalHeroStats,
    roleContext,
    shiftAxesByName,
    heroAxesByName,
    deps.tags,
    myPickTags,
    myModelAttackType,
  )

  // --- Phase 11: Check if My Spot has picked an ultimate ---
  const mySpotHasUlt = checkMySpotPickedUltimate(
    selectedAbilities,
    state.mySelectedSpotHeroOrder,
    abilityDetailsMap,
  )

  // --- Phase 12: Determine top-tier entities ---
  // Abilities mechanically inert on the selected model (cleave on a ranged
  // model) are a HARD exclusion from suggestions, not a score tweak.
  const topTierCandidates = allScoredEntities.filter((e) => !e.inertOnModel)
  const topTierEntities = determineTopTierEntities(
    topTierCandidates,
    state.mySelectedModelDbHeroId,
    mySpotHasUlt,
    synergisticPartnersInPool,
  )

  // --- Phase 12.5: Personally-driven picks (linked Windrun profile) ---
  // Flag entities that made the GENERAL top-tier cut only because personal
  // blending raised their score: re-rank with the personal contribution
  // stripped and mark entities present now but absent from that baseline (a
  // positive delta is also required, so an entity that merely inherited a slot
  // from a personally-DEMOTED competitor is not claimed as "because of you").
  // Synergy suggestions are exempt — their inclusion is membership-driven.
  if (allScoredEntities.some((e) => e.personalScoreDelta !== undefined)) {
    const baselineEntities = topTierCandidates.map((e) => ({
      ...e,
      consolidatedScore: e.consolidatedScore - (e.personalScoreDelta ?? 0),
    }))
    const baselineGeneralNames = new Set(
      determineTopTierEntities(
        baselineEntities,
        state.mySelectedModelDbHeroId,
        mySpotHasUlt,
        synergisticPartnersInPool,
      )
        .filter((e) => e.isGeneralTopTier)
        .map((e) => e.internalName),
    )
    for (const entity of topTierEntities) {
      if (
        entity.isGeneralTopTier &&
        (entity.personalScoreDelta ?? 0) > PERSONAL_SCORE_DELTA_EPSILON &&
        !baselineGeneralNames.has(entity.internalName)
      ) {
        entity.isPersonallyDriven = true
      }
    }
  }

  // Build top-tier lookup for fast enrichment
  const topTierLookup = new Map(
    topTierEntities.map((e) => [e.internalName, e]),
  )

  // --- Phase 13: Enrich scan slots and hero models for UI ---
  const enrichedUltimates = enrichSlots(
    ultimates,
    abilityDetailsMap,
    abilitySynergyMap,
    abilityHeroSynergyMap,
    topTierLookup,
    allScoredEntities,
  )

  const enrichedStandard = enrichSlots(
    standard,
    abilityDetailsMap,
    abilitySynergyMap,
    abilityHeroSynergyMap,
    topTierLookup,
    allScoredEntities,
  )

  const enrichedSelected = enrichSlots(
    selectedAbilities,
    abilityDetailsMap,
    new Map(), // Selected abilities don't need per-slot synergy data
    new Map(),
    new Map(), // Selected abilities don't get top-tier flags
    [],
  )

  const enrichedHeroModels = enrichHeroModels(
    state.identifiedHeroModelsCache,
    heroModelSynergyMap,
    topTierLookup,
    allScoredEntities,
    new Set(state.pickedModelHeroOrders),
  )

  const heroesForMySpotUI = buildHeroesForMySpotUI(
    state.identifiedHeroModelsCache,
  )

  // --- Phase 14: Assemble overlay payload ---
  const overlayPayload: OverlayDataPayload = {
    initialSetup: false,
    scanData: {
      ultimates: enrichedUltimates,
      standard: enrichedStandard,
      selectedAbilities: enrichedSelected,
    },
    targetResolution,
    scaleFactor,
    opCombinations,
    trapCombinations,
    heroSynergies,
    heroTraps,
    heroModels: enrichedHeroModels,
    heroesForMySpotUI,
    selectedHeroForDraftingDbId: state.mySelectedSpotDbId,
    selectedSpotHeroOrder: state.mySelectedSpotHeroOrder,
    selectedModelHeroOrder: state.mySelectedModelHeroOrder,
    heroesCoords,
    heroesParams,
    modelsCoords: modelCoords,
    autoDraftTrackingEnabled: settings.experimentalAutoDraftTracking === true,
    roleContext: buildRoleContextDisplay(
      roleModeActive,
      hasShiftData,
      settings.roleMode as 'fixed' | 'dynamic',
      state.mySelectedSpotHeroOrder,
      roleContext,
    ),
  }

  return {
    overlayPayload,
    updatedState: state,
    rescanRejected,
    rescanRebaselined,
    rescanHasty,
    newlyPickedModels,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A scan processed with a role mode ON always carries a roleContext with a
// status, so the overlay can say WHY the layer is inactive ('noData'/'noSpot')
// instead of guessing. An absent roleContext then only ever means the last
// scan predates the mode toggle (or fixed mode with nothing selected).
function buildRoleContextDisplay(
  roleModeActive: boolean,
  hasShiftData: boolean,
  mode: 'fixed' | 'dynamic',
  mySpotHeroOrder: number | null,
  roleContext: RoleContext | null,
): import('@shared/types').RoleContextDisplay | undefined {
  if (roleContext !== null) return toRoleContextDisplay(roleContext)
  if (!roleModeActive) return undefined
  const inactive = { effectivePositions: [], teamGreed: null, teammates: [] }
  if (!hasShiftData) return { mode, status: 'noData', ...inactive }
  if (mySpotHeroOrder === null) return { mode, status: 'noSpot', ...inactive }
  return undefined // fixed mode with an empty selection
}

// @DEV-GUIDE: Deep-clones the mutable DraftSessionState to avoid mutating the caller's copy.
// Arrays are shallow-copied (ScanResult objects are treated as immutable).
function cloneState(state: DraftSessionState): DraftSessionState {
  return {
    initialPoolAbilitiesCache: {
      ultimates: [...state.initialPoolAbilitiesCache.ultimates],
      standard: [...state.initialPoolAbilitiesCache.standard],
    },
    identifiedHeroModelsCache: [...state.identifiedHeroModelsCache],
    mySelectedSpotDbId: state.mySelectedSpotDbId,
    mySelectedSpotHeroOrder: state.mySelectedSpotHeroOrder,
    mySelectedModelDbHeroId: state.mySelectedModelDbHeroId,
    mySelectedModelHeroOrder: state.mySelectedModelHeroOrder,
    selectedAbilitiesCache: [...state.selectedAbilitiesCache],
    rescanRejectionStreak: state.rescanRejectionStreak,
    modelTileBaselines: [...state.modelTileBaselines],
    pendingModelChanges: [...state.pendingModelChanges],
    pickedModelHeroOrders: [...state.pickedModelHeroOrders],
  }
}

// @DEV-GUIDE: Converts all pool abilities + hero models into ScoredEntity objects.
// Each entity gets a consolidatedScore (0.4 * winrate + 0.6 * pickOrder) for ranking.
// With a linked Windrun profile the score inputs are personal-blended (scoring.ts);
// entity.winrate/pickRate stay GLOBAL for display — personal numbers surface via
// the personal* fields. Deduplicates by name (an ability can appear in both
// ultimates and standard arrays).
// Picked ABILITIES are naturally absent (rescans subtract them from the pool arrays),
// but the models cache keeps every identified model, so models already drafted by ANY
// player must be skipped here or they keep surfacing as top-tier suggestions.
function buildScoredEntities(
  ultimates: ScanResult[],
  standard: ScanResult[],
  abilityDetailsMap: Map<string, import('@shared/types').AbilityDetail>,
  heroModels: IdentifiedHeroModel[],
  pickedModelHeroOrders: ReadonlySet<number>,
  personalAbilityStats: Map<string, import('@shared/types').PersonalAbilityStats>,
  personalHeroStats: Map<string, import('@shared/types').PersonalHeroStats>,
  roleContext: RoleContext | null,
  shiftAxesByName: ReadonlyMap<string, ShiftAxes>,
  heroAxesByName: ReadonlyMap<string, ShiftAxes>,
  tags: import('./ability-tags').AbilityTagsLookup | undefined,
  myPickTags: ReadonlySet<AbilityTag>[],
  myModelAttackType: import('./ability-tags').HeroAttackType | undefined,
): ScoredEntity[] {
  const entities: ScoredEntity[] = []
  const seen = new Set<string>()

  for (const slot of [...ultimates, ...standard]) {
    if (!slot.name || seen.has(slot.name)) continue
    seen.add(slot.name)

    const details = abilityDetailsMap.get(slot.name)
    const scored = calculatePersonalizedScore(
      details?.winrate ?? null,
      details?.pickRate ?? null,
      personalAbilityStats.get(slot.name),
    )
    const candidateTags = tags?.getTags(slot.name)
    // Role layer applies AFTER the personal blend (fixed layer order), so
    // "you win with it" and "it fits your role" stack rather than fight.
    // Heroes are exempt — hero models have no shift data.
    const tagInput: RoleTagInput | undefined =
      tags !== undefined ? { candidateTags, myPickTags } : undefined
    const role = computeRoleScore(
      shiftAxesByName.get(slot.name),
      roleContext,
      tagInput,
    )
    const consolidatedScore =
      role !== null
        ? Math.min(1, Math.max(0, scored.consolidatedScore + role.delta))
        : scored.consolidatedScore
    entities.push({
      entityType: 'ability',
      internalName: slot.name,
      displayName: details?.displayName ?? slot.name,
      winrate: details?.winrate ?? null,
      pickRate: details?.pickRate ?? null,
      consolidatedScore,
      personalGames: scored.personalGames,
      personalWinrate: scored.personalWinrate,
      personalScoreDelta: scored.personalScoreDelta,
      roleScoreDelta: role?.delta,
      roleBestPosition: role?.bestPosition,
      roleReasons: role !== null && role.reasons.length > 0 ? role.reasons : undefined,
      inertOnModel: isInertOnModel(candidateTags, myModelAttackType) || undefined,
      isUltimateFromCoordSource: slot.is_ultimate,
      isUltimateFromDb: details?.isUltimate,
      heroOrder: slot.hero_order,
    })
  }

  for (const model of heroModels) {
    if (model.dbHeroId === null) continue
    if (pickedModelHeroOrders.has(model.heroOrder)) continue
    const scored = calculatePersonalizedScore(
      model.winrate,
      model.pickRate,
      personalHeroStats.get(model.heroName),
    )
    // Models get greed-fit only (no tags/needs), from hero-model shift entries
    // percentiled among heroes, scaled down — the model barely determines farm
    // priority compared to the build.
    const role = computeRoleScore(heroAxesByName.get(model.heroName), roleContext)
    const roleDelta = role !== null ? role.delta * ROLE_MODEL_WEIGHT_SCALE : undefined
    const consolidatedScore =
      roleDelta !== undefined
        ? Math.min(1, Math.max(0, scored.consolidatedScore + roleDelta))
        : scored.consolidatedScore
    entities.push({
      entityType: 'hero',
      internalName: model.heroName,
      displayName: model.heroDisplayName,
      winrate: model.winrate,
      pickRate: model.pickRate,
      consolidatedScore,
      personalGames: scored.personalGames,
      personalWinrate: scored.personalWinrate,
      personalScoreDelta: scored.personalScoreDelta,
      roleScoreDelta: roleDelta,
      roleBestPosition: role?.bestPosition,
      dbHeroId: model.dbHeroId,
      heroOrder: model.heroOrder,
    })
  }

  return entities
}

function checkMySpotPickedUltimate(
  selectedAbilities: ScanResult[],
  mySpotHeroOrder: number | null,
  abilityDetailsMap: Map<string, import('@shared/types').AbilityDetail>,
): boolean {
  if (mySpotHeroOrder === null) return false

  for (const slot of selectedAbilities) {
    if (slot.hero_order !== mySpotHeroOrder) continue
    if (!slot.name) continue
    const details = abilityDetailsMap.get(slot.name)
    if (details?.isUltimate || slot.is_ultimate) return true
  }
  return false
}

type SynergyMap = Map<
  string,
  {
    high: { ability1DisplayName: string; ability2DisplayName: string; synergyWinrate: number }[]
    low: { ability1DisplayName: string; ability2DisplayName: string; synergyWinrate: number }[]
  }
>

type HeroSynergyMap = Map<
  string,
  {
    strong: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
    weak: { heroDisplayName: string; abilityDisplayName: string; synergyWinrate: number }[]
  }
>

// @DEV-GUIDE: Attaches all enrichment data to each scan slot for overlay rendering.
// Merges DB details, synergy lists, top-tier flags, and consolidated scores onto each slot.
// Unknown abilities (name === null) get a safe fallback via makeUnknownSlot(); so do
// predicted names with no DB row (ability removed from the pool / DB not yet scraped) —
// rendering those as normal slots would show raw internal names with a fake neutral score.
// (Class masking in the ML worker normally prevents removed-class predictions upstream;
// this is the defense-in-depth net for when masking is unavailable.)
function enrichSlots(
  slots: ScanResult[],
  abilityDetailsMap: Map<string, import('@shared/types').AbilityDetail>,
  abilitySynergyMap: SynergyMap,
  abilityHeroSynergyMap: HeroSynergyMap,
  topTierLookup: Map<string, import('./types').TopTierEntity>,
  allScoredEntities: ScoredEntity[],
): EnrichedScanSlot[] {
  const scoredAbilityLookup = new Map(
    allScoredEntities
      .filter((e) => e.entityType === 'ability')
      .map((e) => [e.internalName, e]),
  )
  return slots.map((slot) => {
    if (!slot.name) {
      return makeUnknownSlot(slot)
    }

    const details = abilityDetailsMap.get(slot.name)
    if (!details) {
      return makeUnknownSlot(slot)
    }
    const synergies = abilitySynergyMap.get(slot.name)
    const heroSyn = abilityHeroSynergyMap.get(slot.name)
    const topTier = topTierLookup.get(slot.name)
    const scored = scoredAbilityLookup.get(slot.name)

    return {
      ...slot,
      displayName: details.displayName,
      winrate: details.winrate,
      pickRate: details.pickRate,
      consolidatedScore: scored?.consolidatedScore ?? calculateConsolidatedScore(
        details.winrate,
        details.pickRate,
      ),
      personalGames: scored?.personalGames,
      personalWinrate: scored?.personalWinrate,
      personalScoreDelta: scored?.personalScoreDelta,
      roleScoreDelta: scored?.roleScoreDelta,
      roleBestPosition: scored?.roleBestPosition,
      roleReasons: scored?.roleReasons,
      inertOnModel: scored?.inertOnModel,
      isGeneralTopTier: topTier?.isGeneralTopTier ?? false,
      isSynergySuggestionForMySpot:
        topTier?.isSynergySuggestionForMySpot ?? false,
      isPersonallyDriven: topTier?.isPersonallyDriven ?? false,
      isUltimateFromDb: details.isUltimate,
      highWinrateCombinations: synergies?.high ?? [],
      lowWinrateCombinations: synergies?.low ?? [],
      strongHeroSynergies: heroSyn?.strong ?? [],
      weakHeroSynergies: heroSyn?.weak ?? [],
    }
  })
}

function makeUnknownSlot(slot: ScanResult): EnrichedScanSlot {
  return {
    ...slot,
    // Fallback only — renderers translate unknown slots via i18n (tooltip.unknownAbility)
    displayName: 'Unknown Ability',
    isUnknown: true,
    winrate: null,
    pickRate: null,
    consolidatedScore: 0,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isPersonallyDriven: false,
    isUltimateFromDb: false,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
  }
}

// @DEV-GUIDE: Converts identified hero models into HeroModelDisplay objects for overlay.
// Attaches synergy lists (strong/weak ability partners) and top-tier flags.
function enrichHeroModels(
  heroModels: IdentifiedHeroModel[],
  heroModelSynergyMap: HeroSynergyMap,
  topTierLookup: Map<string, import('./types').TopTierEntity>,
  allScoredEntities: ScoredEntity[],
  pickedModelHeroOrders: ReadonlySet<number>,
): HeroModelDisplay[] {
  const scoredHeroLookup = new Map(
    allScoredEntities
      .filter((e) => e.entityType === 'hero')
      .map((e) => [e.internalName, e]),
  )
  return heroModels.map((model) => {
    const scored = scoredHeroLookup.get(model.heroName)
    const topTier = topTierLookup.get(model.heroName)
    const synergies = heroModelSynergyMap.get(model.heroName)

    return {
      isPicked: pickedModelHeroOrders.has(model.heroOrder),
      heroOrder: model.heroOrder,
      heroName: model.heroName,
      heroDisplayName: model.heroDisplayName,
      dbHeroId: model.dbHeroId,
      winrate: model.winrate,
      pickRate: model.pickRate,
      consolidatedScore: scored?.consolidatedScore ?? calculateConsolidatedScore(
        model.winrate,
        model.pickRate,
      ),
      personalGames: scored?.personalGames,
      personalWinrate: scored?.personalWinrate,
      personalScoreDelta: scored?.personalScoreDelta,
      roleScoreDelta: scored?.roleScoreDelta,
      roleBestPosition: scored?.roleBestPosition,
      isGeneralTopTier: topTier?.isGeneralTopTier ?? false,
      isPersonallyDriven: topTier?.isPersonallyDriven ?? false,
      identificationConfidence: model.identificationConfidence,
      strongAbilitySynergies: synergies?.strong ?? [],
      weakAbilitySynergies: synergies?.weak ?? [],
    }
  })
}

function buildHeroesForMySpotUI(
  heroModels: IdentifiedHeroModel[],
): HeroSpotDisplay[] {
  return heroModels
    .filter((m) => m.dbHeroId !== null)
    .map((m) => ({
      heroOrder: m.heroOrder,
      heroName: m.heroDisplayName,
      dbHeroId: m.dbHeroId!,
    }))
}

// @DEV-GUIDE: Phase 8.5 — For each OP/Trap pair, looks up triplet data to suggest a "third ability"
// that completes the combo. Mutates the pair objects in-place by adding suggestedThird and inflatedSynergy.
// The overlay UI shows these as "+AbilityC" badges on pair entries.
function enrichPairsWithTriplets(
  opCombinations: import('@shared/types').SynergyPairDisplay[],
  trapCombinations: import('@shared/types').SynergyPairDisplay[],
  deps: ScanProcessorDeps,
): void {
  if (!deps.triplets) return

  const nameToIdMap = deps.abilities.getNameToIdMap()

  // Collect all unique pair keys from both OP and trap combinations
  // We need internal names, not display names — build a reverse lookup
  const idToName = new Map<number, string>()
  for (const [name, id] of nameToIdMap) {
    idToName.set(id, name)
  }

  // Build display→internal name mapping from the name→id map
  // We'll match display names against DB abilities
  const allDetails = deps.abilities.getDetails(Array.from(nameToIdMap.keys()))
  const displayToInternal = new Map<string, string>()
  for (const [internalName, detail] of allDetails) {
    displayToInternal.set(detail.displayName, internalName)
  }

  const allPairs = [...opCombinations, ...trapCombinations]
  const pairKeys: { a: number; b: number; display1: string; display2: string }[] = []

  for (const combo of allPairs) {
    const name1 = displayToInternal.get(combo.ability1DisplayName)
    const name2 = displayToInternal.get(combo.ability2DisplayName)
    if (!name1 || !name2) continue
    const id1 = nameToIdMap.get(name1)
    const id2 = nameToIdMap.get(name2)
    if (!id1 || !id2) continue
    pairKeys.push({ a: id1, b: id2, display1: combo.ability1DisplayName, display2: combo.ability2DisplayName })
  }

  if (pairKeys.length === 0) return

  const thirdAbilitiesMap = deps.triplets.getThirdAbilitiesForPairs(pairKeys)

  // Enrich each combination with the third ability suggestion
  for (const combo of allPairs) {
    const name1 = displayToInternal.get(combo.ability1DisplayName)
    const name2 = displayToInternal.get(combo.ability2DisplayName)
    if (!name1 || !name2) continue
    const id1 = nameToIdMap.get(name1)
    const id2 = nameToIdMap.get(name2)
    if (!id1 || !id2) continue

    const [a, b] = id1 < id2 ? [id1, id2] : [id2, id1]
    const key = `${a}-${b}`
    const thirds = thirdAbilitiesMap.get(key)
    if (!thirds || thirds.length === 0) continue

    // Pick the top third ability (highest triplet winrate)
    const top = thirds[0]
    combo.suggestedThird = {
      name: top.thirdAbilityName,
      displayName: top.thirdAbilityDisplayName,
      tripletWinrate: top.tripletWinrate,
      tripletPicks: top.tripletPicks,
    }
    combo.inflatedSynergy = true
  }
}
