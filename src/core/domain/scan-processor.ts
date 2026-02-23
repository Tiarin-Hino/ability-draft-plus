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
import { calculateConsolidatedScore } from './scoring'
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

// @DEV-GUIDE: Central business logic — transforms raw ML scan results into a fully-enriched
// OverlayDataPayload for the overlay UI. This is pure TypeScript with ZERO Electron imports.
//
// processScanResults() pipeline (14 phases):
// 1. Branch initial scan vs rescan (rescan diffs against cached pool)
// 2. Collect unique ability names from pool and picked abilities
// 3. Batch DB lookup for ability details (winrate, pick rate, display name)
// 4. Build heroes-in-pool set (from identified hero models)
// 5. Per-ability synergy enrichment (high/low winrate partner pairs)
// 6. Per-ability hero synergies (which heroes synergize with each ability)
// 7. Per-hero-model ability synergies (which abilities synergize with each hero)
// 8. Global OP/Trap combination filtering (above/below threshold)
// 8.5. Enrich pairs with triplet context (suggested third ability badge)
// 9. My Spot synergistic partners (abilities synergizing with user's picked abilities)
// 10. Score all entities (consolidated score = 0.4 * winrate + 0.6 * pickOrder)
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
}

export interface ScanProcessorOutput {
  overlayPayload: OverlayDataPayload
  updatedState: DraftSessionState
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

  if (isInitialScan) {
    const initial = rawResults as InitialScanResults
    ultimates = initial.ultimates
    standard = initial.standard
    selectedAbilities = initial.selectedAbilities

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
    // Rescan: rawResults = newly identified selected/picked abilities
    const pickedAbilities = rawResults as ScanResult[]
    const pickedNames = new Set(
      pickedAbilities.map((a) => a.name).filter(Boolean) as string[],
    )

    // Remove picked abilities from cached pool
    state.initialPoolAbilitiesCache = {
      ultimates: state.initialPoolAbilitiesCache.ultimates.filter(
        (a) => !pickedNames.has(a.name ?? ''),
      ),
      standard: state.initialPoolAbilitiesCache.standard.filter(
        (a) => !pickedNames.has(a.name ?? ''),
      ),
    }

    ultimates = state.initialPoolAbilitiesCache.ultimates
    standard = state.initialPoolAbilitiesCache.standard
    selectedAbilities = pickedAbilities
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
  )

  // --- Phase 11: Check if My Spot has picked an ultimate ---
  const mySpotHasUlt = checkMySpotPickedUltimate(
    selectedAbilities,
    state.mySelectedSpotHeroOrder,
    abilityDetailsMap,
  )

  // --- Phase 12: Determine top-tier entities ---
  const topTierEntities = determineTopTierEntities(
    allScoredEntities,
    state.mySelectedModelDbHeroId,
    mySpotHasUlt,
    synergisticPartnersInPool,
  )

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
    selectedModelHeroOrder: state.mySelectedModelHeroOrder,
    heroesCoords,
    heroesParams,
    modelsCoords: modelCoords,
  }

  return { overlayPayload, updatedState: state }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  }
}

// @DEV-GUIDE: Converts all pool abilities + hero models into ScoredEntity objects.
// Each entity gets a consolidatedScore (0.4 * winrate + 0.6 * pickOrder) for ranking.
// Deduplicates by name (an ability can appear in both ultimates and standard arrays).
function buildScoredEntities(
  ultimates: ScanResult[],
  standard: ScanResult[],
  abilityDetailsMap: Map<string, import('@shared/types').AbilityDetail>,
  heroModels: IdentifiedHeroModel[],
): ScoredEntity[] {
  const entities: ScoredEntity[] = []
  const seen = new Set<string>()

  for (const slot of [...ultimates, ...standard]) {
    if (!slot.name || seen.has(slot.name)) continue
    seen.add(slot.name)

    const details = abilityDetailsMap.get(slot.name)
    entities.push({
      entityType: 'ability',
      internalName: slot.name,
      displayName: details?.displayName ?? slot.name,
      winrate: details?.winrate ?? null,
      pickRate: details?.pickRate ?? null,
      consolidatedScore: calculateConsolidatedScore(
        details?.winrate ?? null,
        details?.pickRate ?? null,
      ),
      isUltimateFromCoordSource: slot.is_ultimate,
      isUltimateFromDb: details?.isUltimate,
      heroOrder: slot.hero_order,
    })
  }

  for (const model of heroModels) {
    if (model.dbHeroId === null) continue
    entities.push({
      entityType: 'hero',
      internalName: model.heroName,
      displayName: model.heroDisplayName,
      winrate: model.winrate,
      pickRate: model.pickRate,
      consolidatedScore: calculateConsolidatedScore(
        model.winrate,
        model.pickRate,
      ),
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
// Unknown abilities (name === null) get a safe fallback via makeUnknownSlot().
function enrichSlots(
  slots: ScanResult[],
  abilityDetailsMap: Map<string, import('@shared/types').AbilityDetail>,
  abilitySynergyMap: SynergyMap,
  abilityHeroSynergyMap: HeroSynergyMap,
  topTierLookup: Map<string, import('./types').TopTierEntity>,
  allScoredEntities: ScoredEntity[],
): EnrichedScanSlot[] {
  return slots.map((slot) => {
    if (!slot.name) {
      return makeUnknownSlot(slot)
    }

    const details = abilityDetailsMap.get(slot.name)
    const synergies = abilitySynergyMap.get(slot.name)
    const heroSyn = abilityHeroSynergyMap.get(slot.name)
    const topTier = topTierLookup.get(slot.name)
    const scored = allScoredEntities.find((e) => e.internalName === slot.name)

    return {
      ...slot,
      displayName: details?.displayName ?? slot.name,
      winrate: details?.winrate ?? null,
      pickRate: details?.pickRate ?? null,
      consolidatedScore: scored?.consolidatedScore ?? calculateConsolidatedScore(
        details?.winrate ?? null,
        details?.pickRate ?? null,
      ),
      isGeneralTopTier: topTier?.isGeneralTopTier ?? false,
      isSynergySuggestionForMySpot:
        topTier?.isSynergySuggestionForMySpot ?? false,
      isUltimateFromDb: details?.isUltimate ?? false,
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
    displayName: 'Unknown Ability',
    winrate: null,
    pickRate: null,
    consolidatedScore: 0,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
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
): HeroModelDisplay[] {
  return heroModels.map((model) => {
    const scored = allScoredEntities.find(
      (e) => e.entityType === 'hero' && e.internalName === model.heroName,
    )
    const topTier = topTierLookup.get(model.heroName)
    const synergies = heroModelSynergyMap.get(model.heroName)

    return {
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
      isGeneralTopTier: topTier?.isGeneralTopTier ?? false,
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
