import { describe, it, expect } from 'vitest'
import { processScanResults } from '@core/domain/scan-processor'
import type { ScanProcessorInput } from '@core/domain/scan-processor'
import type { ScanResult, AbilityDetail, SlotCoordinate } from '@shared/types'
import type { InitialScanResults } from '@shared/types/ml'
import type { DraftSessionState, ScanProcessorDeps } from '@core/domain/types'
import type {
  SynergyPartner,
  AbilitySynergyPair,
  HeroAbilitySynergyRow,
} from '@core/database/repositories/synergy-repository'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeScanResult(
  name: string | null,
  heroOrder: number,
  abilityOrder: number,
  isUltimate: boolean,
  confidence = 0.95,
): ScanResult {
  return {
    name,
    confidence,
    hero_order: heroOrder,
    ability_order: abilityOrder,
    is_ultimate: isUltimate,
    // Unique per slot, stable across scans — mirrors the real layout JSON, where
    // the coordinate is the only reliable slot identity (selected-abilities
    // slots share ability_order) and the rescan merge keys on it.
    coord: {
      x: heroOrder * 100 + abilityOrder * 10,
      y: isUltimate ? 0 : 50,
      width: 64,
      height: 64,
      hero_order: heroOrder,
      ability_order: abilityOrder,
    },
  }
}

function makeCoord(heroOrder: number): SlotCoordinate {
  return { x: 0, y: 0, width: 64, height: 64, hero_order: heroOrder }
}

const abilityDb: Record<string, AbilityDetail> = {
  fireball: {
    abilityId: 1, name: 'fireball', displayName: 'Fireball',
    heroId: 1, winrate: 0.55, highSkillWinrate: 0.57,
    pickRate: 10, hsPickRate: 8, isUltimate: false, abilityOrder: 0,
  },
  ice_blast: {
    abilityId: 2, name: 'ice_blast', displayName: 'Ice Blast',
    heroId: 2, winrate: 0.52, highSkillWinrate: 0.54,
    pickRate: 15, hsPickRate: 12, isUltimate: false, abilityOrder: 1,
  },
  laguna_blade: {
    abilityId: 3, name: 'laguna_blade', displayName: 'Laguna Blade',
    heroId: 1, winrate: 0.60, highSkillWinrate: 0.62,
    pickRate: 5, hsPickRate: 3, isUltimate: true, abilityOrder: 3,
  },
  firestorm: {
    abilityId: 4, name: 'firestorm', displayName: 'Firestorm',
    heroId: 1, winrate: 0.48, highSkillWinrate: 0.50,
    pickRate: 25, hsPickRate: 22, isUltimate: false, abilityOrder: 2,
  },
  blink: {
    abilityId: 5, name: 'blink', displayName: 'Blink',
    heroId: 3, winrate: 0.50, highSkillWinrate: 0.52,
    pickRate: 20, hsPickRate: 18, isUltimate: false, abilityOrder: 2,
  },
}

const mockDeps: ScanProcessorDeps = {
  heroes: {
    // Hero-model role fingerprints: lina reads (slightly) support-shifted,
    // antimage (slightly) greedy — magnitudes far below ability shifts, as live
    getAllShifts() {
      const base = { killsShift: 0, deathsShift: 0, kaShift: 0, dmgShift: 0 }
      return [
        { name: 'lina', ...base, gpmShift: -0.02, xpmShift: -0.01, healingShift: 0.1 },
        { name: 'antimage', ...base, gpmShift: 0.03, xpmShift: 0.02, healingShift: -0.01 },
      ]
    },
    getByAbilityName(abilityName: string) {
      const map: Record<string, { heroId: number; heroName: string; heroDisplayName: string | null }> = {
        firestorm: { heroId: 1, heroName: 'lina', heroDisplayName: 'Lina' },
        blink: { heroId: 3, heroName: 'antimage', heroDisplayName: 'Anti-Mage' },
      }
      return map[abilityName] ?? null
    },
    getByName(heroName: string) {
      const map: Record<string, { heroId: number; displayName: string }> = {
        lina: { heroId: 1, displayName: 'Lina' },
        antimage: { heroId: 3, displayName: 'Anti-Mage' },
      }
      return map[heroName] ?? null
    },
    getById(heroId: number) {
      const map: Record<number, {
        heroId: number; name: string; displayName: string;
        winrate: number | null; highSkillWinrate: number | null;
        pickRate: number | null; hsPickRate: number | null;
      }> = {
        1: { heroId: 1, name: 'lina', displayName: 'Lina', winrate: 0.52, highSkillWinrate: 0.54, pickRate: 15, hsPickRate: 12 },
        3: { heroId: 3, name: 'antimage', displayName: 'Anti-Mage', winrate: 0.48, highSkillWinrate: 0.50, pickRate: 20, hsPickRate: 18 },
      }
      return map[heroId] ?? null
    },
  },
  abilities: {
    getDetails(names: string[]) {
      const map = new Map<string, AbilityDetail>()
      for (const name of names) {
        if (abilityDb[name]) map.set(name, abilityDb[name])
      }
      return map
    },
    // Role fingerprint fixtures: fireball reads greedy, ice_blast support-shifted
    // with high healing, the rest in between (only queried with a role mode on).
    getAllShifts() {
      const base = { killsShift: 0, deathsShift: 0, kaShift: 0, dmgShift: 0 }
      return [
        { name: 'fireball', ...base, gpmShift: 0.5, xpmShift: 0.3, healingShift: -0.05 },
        { name: 'ice_blast', ...base, gpmShift: -0.4, xpmShift: -0.2, healingShift: 0.5 },
        { name: 'laguna_blade', ...base, gpmShift: 0.2, xpmShift: 0.1, healingShift: 0 },
        { name: 'firestorm', ...base, gpmShift: 0.1, xpmShift: 0, healingShift: -0.02 },
        { name: 'blink', ...base, gpmShift: -0.1, xpmShift: 0, healingShift: -0.01 },
      ]
    },
  },
  synergies: {
    getHighWinrateCombinations(): SynergyPartner[] {
      return [
        { partnerDisplayName: 'Ice Blast', partnerInternalName: 'ice_blast', synergyWinrate: 0.58 },
      ]
    },
    getAllOPCombinations(): AbilitySynergyPair[] {
      return [{
        ability1InternalName: 'fireball', ability1DisplayName: 'Fireball',
        ability2InternalName: 'ice_blast', ability2DisplayName: 'Ice Blast',
        synergyWinrate: 0.68,
      }]
    },
    getAllTrapCombinations(): AbilitySynergyPair[] {
      return []
    },
    getAllHeroSynergies(): HeroAbilitySynergyRow[] {
      return []
    },
    getAllHeroTrapSynergies(): HeroAbilitySynergyRow[] {
      return []
    },
    getAllHeroAbilitySynergiesUnfiltered(): HeroAbilitySynergyRow[] {
      return [
        { heroInternalName: 'lina', heroDisplayName: 'Lina', abilityInternalName: 'fireball', abilityDisplayName: 'Fireball', synergyWinrate: 0.62 },
      ]
    },
  },
  settings: {
    getSettings() {
      return { opThreshold: 0.13, trapThreshold: 0.05, language: 'en' }
    },
  },
}

function makeInitialState(): DraftSessionState {
  return {
    initialPoolAbilitiesCache: { ultimates: [], standard: [] },
    identifiedHeroModelsCache: [],
    mySelectedSpotDbId: null,
    mySelectedSpotHeroOrder: null,
    mySelectedModelDbHeroId: null,
    mySelectedModelHeroOrder: null,
    selectedAbilitiesCache: [],
    rescanRejectionStreak: 0,
    modelTileBaselines: [],
    pendingModelChanges: [],
    pickedModelHeroOrders: [],
  }
}

function makeModelTile(heroOrder: number, fill: number) {
  return { heroOrder, tile: new Uint8Array(12).fill(fill) }
}

function makeInitialScanInput(): ScanProcessorInput {
  const rawResults: InitialScanResults = {
    ultimates: [makeScanResult('laguna_blade', 0, 3, true)],
    standard: [
      makeScanResult('fireball', 0, 0, false),
      makeScanResult('ice_blast', 1, 1, false),
      makeScanResult('firestorm', 0, 2, false),
      makeScanResult('blink', 1, 2, false),
    ],
    selectedAbilities: [],
    heroDefiningAbilities: [
      makeScanResult('firestorm', 0, 2, false),
      makeScanResult('blink', 1, 2, false),
    ],
  }

  return {
    rawResults,
    isInitialScan: true,
    state: makeInitialState(),
    deps: mockDeps,
    modelCoords: [makeCoord(0), makeCoord(1)],
    heroesCoords: [makeCoord(0), makeCoord(1)],
    heroesParams: { width: 358, height: 170 },
    targetResolution: '1920x1080',
    scaleFactor: 1.0,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processScanResults', () => {
  describe('initial scan', () => {
    it('returns a valid OverlayDataPayload', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      expect(overlayPayload).toBeDefined()
      expect(overlayPayload.scanData).not.toBeNull()
      expect(overlayPayload.targetResolution).toBe('1920x1080')
      expect(overlayPayload.scaleFactor).toBe(1.0)
      expect(overlayPayload.initialSetup).toBe(false)
    })

    it('enriches scan slots with ability details', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      const standard = overlayPayload.scanData!.standard
      const fireballSlot = standard.find((s) => s.name === 'fireball')
      expect(fireballSlot).toBeDefined()
      expect(fireballSlot!.displayName).toBe('Fireball')
      expect(fireballSlot!.winrate).toBe(0.55)
      expect(fireballSlot!.pickRate).toBe(10)
    })

    it('computes consolidated scores', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      const standard = overlayPayload.scanData!.standard
      for (const slot of standard) {
        if (slot.name) {
          expect(slot.consolidatedScore).toBeGreaterThan(0)
        }
      }
    })

    it('populates pool cache in updated state', () => {
      const { updatedState } = processScanResults(makeInitialScanInput())
      expect(updatedState.initialPoolAbilitiesCache.ultimates).toHaveLength(1)
      expect(updatedState.initialPoolAbilitiesCache.standard).toHaveLength(4)
    })

    it('identifies hero models', () => {
      const { updatedState, overlayPayload } = processScanResults(makeInitialScanInput())
      expect(updatedState.identifiedHeroModelsCache).toHaveLength(2)
      expect(updatedState.identifiedHeroModelsCache[0].heroDisplayName).toBe('Lina')
      expect(updatedState.identifiedHeroModelsCache[1].heroDisplayName).toBe('Anti-Mage')
      expect(overlayPayload.heroModels).toHaveLength(2)
    })

    it('resets user selections on initial scan', () => {
      const input = makeInitialScanInput()
      input.state.mySelectedSpotDbId = 5
      input.state.mySelectedSpotHeroOrder = 3
      const { updatedState } = processScanResults(input)
      expect(updatedState.mySelectedSpotDbId).toBeNull()
      expect(updatedState.mySelectedSpotHeroOrder).toBeNull()
      expect(updatedState.mySelectedModelDbHeroId).toBeNull()
    })

    it('populates heroesForMySpotUI', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      expect(overlayPayload.heroesForMySpotUI.length).toBeGreaterThan(0)
      expect(overlayPayload.heroesForMySpotUI[0].heroName).toBeDefined()
    })

    it('populates OP combinations', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      expect(overlayPayload.opCombinations.length).toBeGreaterThan(0)
      expect(overlayPayload.opCombinations[0].ability1DisplayName).toBe('Fireball')
    })

    it('handles unknown ability slots gracefully', () => {
      const input = makeInitialScanInput()
      const initial = input.rawResults as InitialScanResults
      initial.standard.push(makeScanResult(null, 2, 0, false, 0.3))
      const { overlayPayload } = processScanResults(input)
      const unknown = overlayPayload.scanData!.standard.find((s) => s.name === null)
      expect(unknown).toBeDefined()
      expect(unknown!.displayName).toBe('Unknown Ability')
      expect(unknown!.consolidatedScore).toBe(0)
    })
  })

  describe('rescan', () => {
    it('removes picked abilities from cached pool', () => {
      const initialResult = processScanResults(makeInitialScanInput())

      // Simulate rescan with fireball being picked
      const rescanInput: ScanProcessorInput = {
        rawResults: [makeScanResult('fireball', 0, 0, false)],
        isInitialScan: false,
        state: initialResult.updatedState,
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      }

      const { updatedState } = processScanResults(rescanInput)
      const poolNames = updatedState.initialPoolAbilitiesCache.standard.map((s) => s.name)
      expect(poolNames).not.toContain('fireball')
    })

    it('preserves hero models cache on rescan', () => {
      const initialResult = processScanResults(makeInitialScanInput())

      const rescanInput: ScanProcessorInput = {
        rawResults: [makeScanResult('fireball', 0, 0, false)],
        isInitialScan: false,
        state: initialResult.updatedState,
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      }

      const { updatedState } = processScanResults(rescanInput)
      expect(updatedState.identifiedHeroModelsCache).toHaveLength(2)
      expect(updatedState.identifiedHeroModelsCache[0].heroDisplayName).toBe('Lina')
    })

    it('excludes hero models already picked by any player from top-tier suggestions', () => {
      const initialResult = processScanResults(makeInitialScanInput())
      // Baseline: with this tiny pool every scored entity is top-tier,
      // including both hero models
      expect(
        initialResult.overlayPayload.heroModels.map((m) => m.isGeneralTopTier),
      ).toEqual([true, true])

      const rescan = processScanResults({
        rawResults: [makeScanResult('fireball', 0, 1, false)],
        isInitialScan: false,
        state: { ...initialResult.updatedState, pickedModelHeroOrders: [0] },
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      })

      const picked = rescan.overlayPayload.heroModels.find((m) => m.heroOrder === 0)
      const available = rescan.overlayPayload.heroModels.find((m) => m.heroOrder === 1)
      expect(picked?.isPicked).toBe(true)
      expect(picked?.isGeneralTopTier).toBe(false)
      // Score display survives the exclusion (enrichment falls back to computing it)
      expect(picked?.consolidatedScore).toBeGreaterThan(0)
      expect(available?.isGeneralTopTier).toBe(true)
    })

    it('caches accepted picks and reports rescanRejected=false', () => {
      const initialResult = processScanResults(makeInitialScanInput())
      const rescan = processScanResults({
        rawResults: [makeScanResult('fireball', 0, 1, false)],
        isInitialScan: false,
        state: initialResult.updatedState,
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      })
      expect(rescan.rescanRejected).toBe(false)
      expect(
        rescan.updatedState.selectedAbilitiesCache.map((s) => s.name),
      ).toEqual(['fireball'])
    })

    describe('contamination guard', () => {
      function acceptedFirstRescan() {
        const initialResult = processScanResults(makeInitialScanInput())
        return processScanResults({
          rawResults: [makeScanResult('fireball', 0, 1, false)],
          isInitialScan: false,
          state: initialResult.updatedState,
          deps: mockDeps,
          modelCoords: [makeCoord(0), makeCoord(1)],
          heroesCoords: [makeCoord(0), makeCoord(1)],
          heroesParams: { width: 358, height: 170 },
          targetResolution: '1920x1080',
          scaleFactor: 1.0,
        })
      }

      function rescanWith(state: DraftSessionState, results: ScanResult[]) {
        return processScanResults({
          rawResults: results,
          isInitialScan: false,
          state,
          deps: mockDeps,
          modelCoords: [makeCoord(0), makeCoord(1)],
          heroesCoords: [makeCoord(0), makeCoord(1)],
          heroesParams: { width: 358, height: 170 },
          targetResolution: '1920x1080',
          scaleFactor: 1.0,
        })
      }

      it('rejects a rescan where a confident pick slot reads unknown', () => {
        const first = acceptedFirstRescan()
        const poolBefore = first.updatedState.initialPoolAbilitiesCache

        // Same slot now unrecognized (tooltip covered it) + a new "departure"
        const contaminated = rescanWith(first.updatedState, [
          makeScanResult(null, 0, 1, false, 0.4),
          makeScanResult('ice_blast', 1, 1, false),
        ])

        expect(contaminated.rescanRejected).toBe(true)
        // State untouched: pool not further subtracted, picks cache unchanged
        expect(contaminated.updatedState.initialPoolAbilitiesCache).toEqual(poolBefore)
        expect(
          contaminated.updatedState.selectedAbilitiesCache.map((s) => s.name),
        ).toEqual(['fireball'])
        // Payload still renders the last accepted picks
        expect(
          contaminated.overlayPayload.scanData!.selectedAbilities.map((s) => s.name),
        ).toEqual(['fireball'])
      })

      it('accepts a PARTIAL rescan covering only one player row (targeted scan)', () => {
        // Targeted auto-rescan scans only player 1's slots; player 0's cached
        // pick is absent from the scan — that is valid coverage, not
        // contamination, and the results merge into the baseline.
        const first = acceptedFirstRescan()
        const partial = rescanWith(first.updatedState, [
          makeScanResult('ice_blast', 1, 1, false),
        ])
        expect(partial.rescanRejected).toBe(false)
        expect(partial.rescanHasty).toBe(false)
        expect(
          partial.updatedState.selectedAbilitiesCache.map((s) => s.name).sort(),
        ).toEqual(['fireball', 'ice_blast'])
        // Pool subtraction covers ALL known picks, not just this scan's subset
        const poolNames = partial.updatedState.initialPoolAbilitiesCache.standard.map(
          (s) => s.name,
        )
        expect(poolNames).not.toContain('ice_blast')
        expect(poolNames).not.toContain('fireball')
        // Enriched payload renders the full merged pick state
        expect(
          partial.overlayPayload.scanData!.selectedAbilities.map((s) => s.name).sort(),
        ).toEqual(['fireball', 'ice_blast'])
      })

      it('a partial rescan is judged for contamination only within its own slots', () => {
        // Player 0's cached pick reads unknown IN the scanned subset -> still guarded
        const first = acceptedFirstRescan()
        const contaminated = rescanWith(first.updatedState, [
          makeScanResult(null, 0, 1, false, 0.4),
          makeScanResult('ice_blast', 1, 1, false),
        ])
        expect(contaminated.rescanRejected).toBe(true)
      })

      it('accepts pick progression (new picks appear, old ones intact)', () => {
        const first = acceptedFirstRescan()
        const next = rescanWith(first.updatedState, [
          makeScanResult('fireball', 0, 1, false),
          makeScanResult('ice_blast', 1, 1, false),
        ])
        expect(next.rescanRejected).toBe(false)
        expect(
          next.updatedState.selectedAbilitiesCache.map((s) => s.name).sort(),
        ).toEqual(['fireball', 'ice_blast'])
        const poolNames = next.updatedState.initialPoolAbilitiesCache.standard.map(
          (s) => s.name,
        )
        expect(poolNames).not.toContain('ice_blast')
      })

      it('accepts a slot changing to a different confident name (misread correction)', () => {
        const first = acceptedFirstRescan()
        const corrected = rescanWith(first.updatedState, [
          makeScanResult('firestorm', 0, 1, false),
        ])
        expect(corrected.rescanRejected).toBe(false)
        expect(
          corrected.updatedState.selectedAbilitiesCache.map((s) => s.name),
        ).toEqual(['firestorm'])
      })

      it('treats a contaminated scan with NO new picks as a hasty no-op (no streak)', () => {
        const first = acceptedFirstRescan()
        const poolBefore = first.updatedState.initialPoolAbilitiesCache

        // Baseline pick reads unknown, and nothing new appeared — hasty capture
        const hasty = rescanWith(first.updatedState, [
          makeScanResult(null, 0, 1, false, 0.4),
        ])

        expect(hasty.rescanHasty).toBe(true)
        expect(hasty.rescanRejected).toBe(false)
        expect(hasty.updatedState.rescanRejectionStreak).toBe(0)
        expect(hasty.updatedState.initialPoolAbilitiesCache).toEqual(poolBefore)
        expect(
          hasty.updatedState.selectedAbilitiesCache.map((s) => s.name),
        ).toEqual(['fireball'])

        // The next clean scan works completely fresh
        const clean = rescanWith(hasty.updatedState, [
          makeScanResult('fireball', 0, 1, false),
          makeScanResult('ice_blast', 1, 1, false),
        ])
        expect(clean.rescanRejected).toBe(false)
        expect(clean.rescanHasty).toBe(false)
        expect(
          clean.updatedState.selectedAbilitiesCache.map((s) => s.name).sort(),
        ).toEqual(['fireball', 'ice_blast'])
      })

      it('accepts and re-baselines after the consecutive-rejection cap', () => {
        const first = acceptedFirstRescan()
        // Contaminated AND carrying a new pick — the genuinely ambiguous case
        const contaminatedResults = [
          makeScanResult(null, 0, 1, false, 0.4),
          makeScanResult('ice_blast', 1, 1, false),
        ]

        // Rejections up to the cap
        let state = first.updatedState
        for (let i = 1; i <= 3; i++) {
          const rejected = rescanWith(state, contaminatedResults)
          expect(rejected.rescanRejected).toBe(true)
          expect(rejected.updatedState.rescanRejectionStreak).toBe(i)
          state = rejected.updatedState
        }

        // Cap reached: the 4th contaminated scan is accepted as the new baseline
        const rebaselined = rescanWith(state, contaminatedResults)
        expect(rebaselined.rescanRejected).toBe(false)
        expect(rebaselined.rescanRebaselined).toBe(true)
        expect(rebaselined.updatedState.rescanRejectionStreak).toBe(0)
        expect(
          rebaselined.updatedState.selectedAbilitiesCache.map((s) => s.name),
        ).toEqual([null, 'ice_blast'])
      })

      it('a clean scan resets the rejection streak', () => {
        const first = acceptedFirstRescan()
        const rejected = rescanWith(first.updatedState, [
          makeScanResult(null, 0, 1, false, 0.4),
          makeScanResult('ice_blast', 1, 1, false),
        ])
        expect(rejected.updatedState.rescanRejectionStreak).toBe(1)

        const clean = rescanWith(rejected.updatedState, [
          makeScanResult('fireball', 0, 1, false),
        ])
        expect(clean.rescanRejected).toBe(false)
        expect(clean.rescanRebaselined).toBe(false)
        expect(clean.updatedState.rescanRejectionStreak).toBe(0)
      })

      it('never rejects when there are no prior confident picks', () => {
        const initialResult = processScanResults(makeInitialScanInput())
        const rescan = rescanWith(initialResult.updatedState, [
          makeScanResult(null, 2, 1, false, 0.3),
        ])
        expect(rescan.rescanRejected).toBe(false)
      })
    })

    describe('picked-model detection (tile diff)', () => {
      function initialWithTiles() {
        const input = makeInitialScanInput()
        input.modelTiles = [makeModelTile(0, 50), makeModelTile(1, 50)]
        return processScanResults(input)
      }

      function rescanWithTiles(
        state: DraftSessionState,
        tiles: ReturnType<typeof makeModelTile>[],
      ) {
        return processScanResults({
          rawResults: [makeScanResult('fireball', 0, 1, false)],
          isInitialScan: false,
          state,
          deps: mockDeps,
          modelCoords: [makeCoord(0), makeCoord(1)],
          heroesCoords: [makeCoord(0), makeCoord(1)],
          heroesParams: { width: 358, height: 170 },
          targetResolution: '1920x1080',
          scaleFactor: 1.0,
          modelTiles: tiles,
        })
      }

      it('stores baselines on initial scan and resets picked state', () => {
        const { updatedState } = initialWithTiles()
        expect(updatedState.modelTileBaselines).toHaveLength(2)
        expect(updatedState.pickedModelHeroOrders).toEqual([])
        expect(updatedState.pendingModelChanges).toEqual([])
      })

      it('commits a pick only after the change persists across two scans', () => {
        const initial = initialWithTiles()

        const first = rescanWithTiles(initial.updatedState, [
          makeModelTile(0, 50),
          makeModelTile(1, 200),
        ])
        expect(first.newlyPickedModels).toEqual([])
        expect(first.updatedState.pendingModelChanges).toEqual([1])

        const second = rescanWithTiles(first.updatedState, [
          makeModelTile(0, 50),
          makeModelTile(1, 200),
        ])
        expect(second.newlyPickedModels).toEqual([1])
        expect(second.updatedState.pickedModelHeroOrders).toEqual([1])
        // Picked state reaches the enriched hero models
        const model1 = second.overlayPayload.heroModels.find((m) => m.heroOrder === 1)
        expect(model1?.isPicked).toBe(true)
        const model0 = second.overlayPayload.heroModels.find((m) => m.heroOrder === 0)
        expect(model0?.isPicked).toBe(false)
      })

      it('a one-scan flicker (tooltip) never commits', () => {
        const initial = initialWithTiles()
        const flicker = rescanWithTiles(initial.updatedState, [
          makeModelTile(0, 50),
          makeModelTile(1, 200),
        ])
        const settled = rescanWithTiles(flicker.updatedState, [
          makeModelTile(0, 50),
          makeModelTile(1, 50),
        ])
        expect(settled.updatedState.pickedModelHeroOrders).toEqual([])
        expect(settled.updatedState.pendingModelChanges).toEqual([])
      })

      it('rescans without tiles leave model state untouched', () => {
        const initial = initialWithTiles()
        const noTiles = processScanResults({
          rawResults: [makeScanResult('fireball', 0, 1, false)],
          isInitialScan: false,
          state: initial.updatedState,
          deps: mockDeps,
          modelCoords: [makeCoord(0), makeCoord(1)],
          heroesCoords: [makeCoord(0), makeCoord(1)],
          heroesParams: { width: 358, height: 170 },
          targetResolution: '1920x1080',
          scaleFactor: 1.0,
        })
        expect(noTiles.updatedState.modelTileBaselines).toHaveLength(2)
        expect(noTiles.updatedState.pickedModelHeroOrders).toEqual([])
      })
    })

    it('includes selected abilities in enriched output', () => {
      const initialResult = processScanResults(makeInitialScanInput())

      const rescanInput: ScanProcessorInput = {
        rawResults: [makeScanResult('fireball', 0, 0, false)],
        isInitialScan: false,
        state: initialResult.updatedState,
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      }

      const { overlayPayload } = processScanResults(rescanInput)
      expect(overlayPayload.scanData!.selectedAbilities).toHaveLength(1)
      expect(overlayPayload.scanData!.selectedAbilities[0].displayName).toBe('Fireball')
    })

    it('does not mutate the original state', () => {
      const initialResult = processScanResults(makeInitialScanInput())
      const originalPoolCount = initialResult.updatedState.initialPoolAbilitiesCache.standard.length

      processScanResults({
        rawResults: [makeScanResult('fireball', 0, 0, false)],
        isInitialScan: false,
        state: initialResult.updatedState,
        deps: mockDeps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      })

      // Original state should be unchanged
      expect(initialResult.updatedState.initialPoolAbilitiesCache.standard).toHaveLength(originalPoolCount)
    })
  })

  describe('settings integration', () => {
    it('reads thresholds from settings', () => {
      const { overlayPayload } = processScanResults(makeInitialScanInput())
      // If thresholds are read correctly, OP combos will be filtered.
      // Our mock getAllOPCombinations returns 1 combo, which matches both pool abilities.
      expect(overlayPayload.opCombinations.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('selected state forwarding', () => {
    it('forwards mySelectedSpotDbId to overlay payload', () => {
      const input = makeInitialScanInput()
      // After initial scan resets selections, they should be null
      const { overlayPayload } = processScanResults(input)
      expect(overlayPayload.selectedHeroForDraftingDbId).toBeNull()
      expect(overlayPayload.selectedModelHeroOrder).toBeNull()
    })
  })

  describe('personalization (linked Windrun profile)', () => {
    function withPersonalStats(
      abilityStats: Map<string, import('@shared/types').PersonalAbilityStats>,
      heroStats: Map<string, import('@shared/types').PersonalHeroStats>,
    ): ScanProcessorDeps {
      return {
        ...mockDeps,
        playerStats: {
          getAbilityStatsByName: () => abilityStats,
          getHeroStatsByName: () => heroStats,
        },
      }
    }

    it('produces identical output with empty personal maps (personalization off)', () => {
      const base = processScanResults(makeInitialScanInput())
      const input = makeInitialScanInput()
      input.deps = withPersonalStats(new Map(), new Map())
      const personalized = processScanResults(input)
      expect(personalized.overlayPayload).toEqual(base.overlayPayload)
    })

    it('raises the score of an ability with a strong personal record', () => {
      const base = processScanResults(makeInitialScanInput())
      const baseFireball = base.overlayPayload.scanData!.standard.find(
        (s) => s.name === 'fireball',
      )!

      const input = makeInitialScanInput()
      input.deps = withPersonalStats(
        new Map([
          ['fireball', { games: 30, wins: 25, winrate: 25 / 30, avgPickPosition: 4 }],
        ]),
        new Map(),
      )
      const { overlayPayload } = processScanResults(input)
      const fireball = overlayPayload.scanData!.standard.find(
        (s) => s.name === 'fireball',
      )!

      expect(fireball.consolidatedScore).toBeGreaterThan(baseFireball.consolidatedScore)
      expect(fireball.personalGames).toBe(30)
      expect(fireball.personalWinrate).toBeCloseTo(25 / 30)
      expect(fireball.personalScoreDelta).toBeCloseTo(
        fireball.consolidatedScore - baseFireball.consolidatedScore,
      )
      // Global display values stay global
      expect(fireball.winrate).toBe(0.55)
      expect(fireball.pickRate).toBe(10)
    })

    it('leaves abilities without personal data untouched', () => {
      const base = processScanResults(makeInitialScanInput())
      const baseIceBlast = base.overlayPayload.scanData!.standard.find(
        (s) => s.name === 'ice_blast',
      )!

      const input = makeInitialScanInput()
      input.deps = withPersonalStats(
        new Map([
          ['fireball', { games: 30, wins: 25, winrate: 25 / 30, avgPickPosition: 4 }],
        ]),
        new Map(),
      )
      const { overlayPayload } = processScanResults(input)
      const iceBlast = overlayPayload.scanData!.standard.find(
        (s) => s.name === 'ice_blast',
      )!

      expect(iceBlast.consolidatedScore).toBe(baseIceBlast.consolidatedScore)
      expect(iceBlast.personalGames).toBeUndefined()
      expect(iceBlast.personalScoreDelta).toBeUndefined()
    })

    // 12-ability pool for top-tier cut tests: winrates 0.60 down to 0.49,
    // identical pick rates, so the global ranking is a01 > a02 > ... > a12 and
    // only a01..a10 make the 10-slot general top tier.
    function makeBigPoolInput(
      personalAbilityStats: Map<string, import('@shared/types').PersonalAbilityStats>,
    ): ScanProcessorInput {
      const names = Array.from({ length: 12 }, (_, i) =>
        `a${String(i + 1).padStart(2, '0')}`,
      )
      const details = new Map<string, AbilityDetail>(
        names.map((name, i) => [
          name,
          {
            abilityId: i + 1,
            name,
            displayName: name,
            heroId: i + 1,
            winrate: 0.6 - i * 0.01,
            highSkillWinrate: null,
            pickRate: 25,
            hsPickRate: null,
            isUltimate: false,
            abilityOrder: 1,
          },
        ]),
      )

      const deps: ScanProcessorDeps = {
        heroes: {
          getByAbilityName: () => null,
          getByName: () => null,
          getById: () => null,
        },
        abilities: {
          getDetails(requested: string[]) {
            const map = new Map<string, AbilityDetail>()
            for (const name of requested) {
              const d = details.get(name)
              if (d) map.set(name, d)
            }
            return map
          },
        },
        synergies: {
          getHighWinrateCombinations: () => [],
          getAllOPCombinations: () => [],
          getAllTrapCombinations: () => [],
          getAllHeroSynergies: () => [],
          getAllHeroTrapSynergies: () => [],
          getAllHeroAbilitySynergiesUnfiltered: () => [],
        },
        settings: mockDeps.settings,
        playerStats: {
          getAbilityStatsByName: () => personalAbilityStats,
          getHeroStatsByName: () => new Map(),
        },
      }

      const rawResults: InitialScanResults = {
        ultimates: [],
        standard: names.map((name, i) => makeScanResult(name, i, 1, false)),
        selectedAbilities: [],
        heroDefiningAbilities: [],
      }

      return {
        rawResults,
        isInitialScan: true,
        state: makeInitialState(),
        deps,
        modelCoords: [],
        heroesCoords: [],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      }
    }

    it('flags a pick that enters the top tier only because of personal stats', () => {
      // a12 is globally worst (0.49) but has a dominant personal record
      const { overlayPayload } = processScanResults(
        makeBigPoolInput(
          new Map([
            ['a12', { games: 50, wins: 45, winrate: 0.9, avgPickPosition: 25 }],
          ]),
        ),
      )
      const standard = overlayPayload.scanData!.standard
      const a12 = standard.find((s) => s.name === 'a12')!
      const a01 = standard.find((s) => s.name === 'a01')!
      const a10 = standard.find((s) => s.name === 'a10')!

      expect(a12.isGeneralTopTier).toBe(true)
      expect(a12.isPersonallyDriven).toBe(true)
      // a01 is top tier on global merit — not personally driven
      expect(a01.isGeneralTopTier).toBe(true)
      expect(a01.isPersonallyDriven).toBe(false)
      // a12's entry pushed the globally-weakest former member out
      expect(a10.isGeneralTopTier).toBe(false)
    })

    it('flags nothing when no personal stats exist', () => {
      const { overlayPayload } = processScanResults(makeBigPoolInput(new Map()))
      for (const slot of overlayPayload.scanData!.standard) {
        expect(slot.isPersonallyDriven).toBe(false)
      }
    })

    it('does not flag a top-tier pick whose personal boost was not needed', () => {
      // a01 is already #1 globally; a strong personal record must not flag it
      const { overlayPayload } = processScanResults(
        makeBigPoolInput(
          new Map([
            ['a01', { games: 50, wins: 45, winrate: 0.9, avgPickPosition: 25 }],
          ]),
        ),
      )
      const a01 = overlayPayload.scanData!.standard.find((s) => s.name === 'a01')!
      expect(a01.isGeneralTopTier).toBe(true)
      expect(a01.isPersonallyDriven).toBe(false)
    })

    it('personalizes hero model scores from personal hero stats', () => {
      const base = processScanResults(makeInitialScanInput())
      const baseLina = base.overlayPayload.heroModels.find(
        (m) => m.heroName === 'lina',
      )!

      const input = makeInitialScanInput()
      input.deps = withPersonalStats(
        new Map(),
        new Map([['lina', { games: 20, wins: 4, winrate: 0.2 }]]),
      )
      const { overlayPayload } = processScanResults(input)
      const lina = overlayPayload.heroModels.find((m) => m.heroName === 'lina')!

      // Weak personal record lowers the model's score
      expect(lina.consolidatedScore).toBeLessThan(baseLina.consolidatedScore)
      expect(lina.personalGames).toBe(20)
      expect(lina.personalWinrate).toBeCloseTo(0.2)
      // Global display winrate stays global
      expect(lina.winrate).toBe(baseLina.winrate)
    })
  })
})

describe('role-aware suggestions', () => {
  function depsWithRole(
    roleMode: string,
    roleFixedPositions: number[] = [],
  ): ScanProcessorDeps {
    return {
      ...mockDeps,
      settings: {
        getSettings() {
          return {
            opThreshold: 0.13,
            trapThreshold: 0.05,
            language: 'en',
            roleMode,
            roleFixedPositions,
          } as unknown as ReturnType<ScanProcessorDeps['settings']['getSettings']>
        },
      },
    }
  }

  /** Initial scan (spot resets), then set My Spot and run an empty rescan. */
  function runRescanWithRole(roleMode: string, roleFixedPositions: number[] = []) {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedSpotDbId = 1
    state.mySelectedSpotHeroOrder = 0
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps: depsWithRole(roleMode, roleFixedPositions),
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    return processScanResults(input)
  }

  it('mode off (and absent) leaves the payload bit-identical and without role context', () => {
    const withoutMode = processScanResults(makeInitialScanInput())
    const initialOff = makeInitialScanInput()
    initialOff.deps = depsWithRole('off')
    const withOff = processScanResults(initialOff)

    expect(withOff.overlayPayload.roleContext).toBeUndefined()
    expect(withOff.overlayPayload).toEqual(withoutMode.overlayPayload)
    const slots = withOff.overlayPayload.scanData!.standard
    for (const slot of slots) expect(slot.roleScoreDelta).toBeUndefined()
  })

  it('fixed mode tailors suggestions from the INITIAL scan, before any spot is known', () => {
    const input = makeInitialScanInput()
    input.deps = depsWithRole('fixed', [5])
    const { overlayPayload } = processScanResults(input)

    expect(overlayPayload.roleContext).toBeDefined()
    expect(overlayPayload.roleContext!.status).toBe('active')
    expect(overlayPayload.roleContext!.effectivePositions).toEqual([5])
    expect(overlayPayload.roleContext!.teammates).toEqual([])
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeDefined()
      expect(slot.roleBestPosition).toBe(5)
    }
  })

  it('hero models get a scaled role delta (support-shifted model beats greedy for pos 5)', () => {
    const input = makeInitialScanInput()
    input.deps = depsWithRole('fixed', [5])
    const { overlayPayload } = processScanResults(input)

    const lina = overlayPayload.heroModels.find((m) => m.heroName === 'lina')!
    const antimage = overlayPayload.heroModels.find((m) => m.heroName === 'antimage')!
    expect(lina.roleScoreDelta).toBeDefined()
    expect(antimage.roleScoreDelta).toBeDefined()
    expect(lina.roleScoreDelta!).toBeGreaterThan(antimage.roleScoreDelta!)
    expect(lina.roleBestPosition).toBe(5)
  })

  it('dynamic mode with My Spot unknown reports noSpot and stays inert', () => {
    const input = makeInitialScanInput()
    input.deps = depsWithRole('dynamic')
    const { overlayPayload } = processScanResults(input)

    expect(overlayPayload.roleContext).toBeDefined()
    expect(overlayPayload.roleContext!.status).toBe('noSpot')
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeUndefined()
    }
  })

  it('fixed mode without a selection stays inert', () => {
    const { overlayPayload } = runRescanWithRole('fixed', [])

    expect(overlayPayload.roleContext).toBeUndefined()
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeUndefined()
    }
  })

  it('fixed mode attaches the role context and per-slot role deltas', () => {
    const { overlayPayload } = runRescanWithRole('fixed', [5])

    expect(overlayPayload.roleContext).toBeDefined()
    expect(overlayPayload.roleContext!.mode).toBe('fixed')
    expect(overlayPayload.roleContext!.effectivePositions).toEqual([5])
    expect(overlayPayload.roleContext!.teammates.map((t) => t.heroOrder)).toEqual([
      1, 2, 3, 4,
    ])
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeDefined()
      expect(slot.roleBestPosition).toBe(5)
    }
  })

  it('pos-5 fixed mode moves the support-shifted ability above the greedy one', () => {
    const { overlayPayload } = runRescanWithRole('fixed', [5])
    const standard = overlayPayload.scanData!.standard
    const iceBlast = standard.find((s) => s.name === 'ice_blast')!
    const fireball = standard.find((s) => s.name === 'fireball')!

    expect(iceBlast.roleScoreDelta!).toBeGreaterThan(fireball.roleScoreDelta!)
    expect(fireball.roleScoreDelta!).toBeLessThan(0)
    expect(iceBlast.roleScoreDelta!).toBeGreaterThan(0)
  })

  const mockTags: NonNullable<ScanProcessorDeps['tags']> = {
    getTags(name: string) {
      const table: Record<string, string[]> = {
        fireball: ['farm_tool', 'steroid', 'melee_only'],
        ice_blast: ['hard_cc', 'aoe', 'nuke'],
        firestorm: ['waveclear', 'aoe'],
        blink: ['mobility'],
        laguna_blade: ['nuke'],
      }
      const tags = table[name]
      return tags ? (new Set(tags) as ReturnType<NonNullable<ScanProcessorDeps['tags']>['getTags']>) : undefined
    },
    getRoleMust() {
      return undefined
    },
    getRequires() {
      return undefined
    },
    getRoleAvoid() {
      return undefined
    },
    getHeroAttackType(heroName: string) {
      return heroName === 'lina' ? 'Ranged' : 'Melee'
    },
    getHeroMeta(heroName: string) {
      const table: Record<string, import('@core/domain/ability-tags').HeroMeta> = {
        lina: {
          attackType: 'Ranged', primaryAttr: 'int',
          baseStr: 18, baseAgi: 23, baseInt: 25,
          strGain: 2.2, agiGain: 2.3, intGain: 3.7,
        },
        antimage: {
          attackType: 'Melee', primaryAttr: 'agi',
          baseStr: 21, baseAgi: 24, baseInt: 12,
          strGain: 1.6, agiGain: 2.8, intGain: 1.8,
        },
      }
      return table[heroName]
    },
  }

  it('excludes melee-only abilities from top-tier on a ranged model and marks the slot', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedModelDbHeroId = 1 // Lina model -> Ranged
    state.mySelectedModelHeroOrder = 0
    const deps = { ...depsWithRole('off'), tags: mockTags }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const fireball = overlayPayload.scanData!.standard.find((s) => s.name === 'fireball')!
    expect(fireball.inertOnModel).toBe(true)
    expect(fireball.isGeneralTopTier).toBe(false)
    expect(fireball.isSynergySuggestionForMySpot).toBe(false)
    const iceBlast = overlayPayload.scanData!.standard.find((s) => s.name === 'ice_blast')!
    expect(iceBlast.inertOnModel).toBeUndefined()
  })

  it('a candidate native to the selected model is never inert (Wukong-on-MK ruling)', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedModelDbHeroId = 1 // Lina model -> Ranged
    state.mySelectedModelHeroOrder = 0
    const base = depsWithRole('off')
    // Same melee_only fireball as above, but now OWNED by the selected model's hero
    const deps: ScanProcessorDeps = {
      ...base,
      tags: mockTags,
      heroes: {
        ...base.heroes,
        getByAbilityName: (name: string) =>
          name === 'fireball'
            ? { heroId: 1, heroName: 'lina', heroDisplayName: 'Lina' }
            : base.heroes.getByAbilityName(name),
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const fireball = overlayPayload.scanData!.standard.find((s) => s.name === 'fireball')!
    expect(fireball.inertOnModel).toBeUndefined()
  })

  it('an unmet requires gate excludes the ability from suggestions and marks it', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    const base = depsWithRole('off')
    const deps: ScanProcessorDeps = {
      ...base,
      tags: {
        ...mockTags,
        // ice_blast only works with blink; the user has drafted nothing
        getRequires: (name: string) => (name === 'ice_blast' ? ['blink'] : undefined),
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const iceBlast = overlayPayload.scanData!.standard.find((s) => s.name === 'ice_blast')!
    expect(iceBlast.unmetRequirement?.kind).toBe('ability')
    expect(iceBlast.unmetRequirement?.displayName).toBeTruthy()
    expect(iceBlast.isGeneralTopTier).toBe(false)
    expect(iceBlast.isSynergySuggestionForMySpot).toBe(false)
  })

  it('a model: requirement is satisfied by the picked model (Requiem-on-SF ruling)', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedModelDbHeroId = 1 // Lina model
    state.mySelectedModelHeroOrder = 0
    const base = depsWithRole('off')
    const deps: ScanProcessorDeps = {
      ...base,
      tags: {
        ...mockTags,
        getRequires: (name: string) => (name === 'ice_blast' ? ['model:lina'] : undefined),
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const iceBlast = overlayPayload.scanData!.standard.find((s) => s.name === 'ice_blast')!
    expect(iceBlast.unmetRequirement).toBeUndefined()
  })

  it('an all-five roleMust is guaranteed a slot even with role mode OFF', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    const base = depsWithRole('off')
    const deps: ScanProcessorDeps = {
      ...base,
      tags: {
        ...mockTags,
        getRoleMust: (name: string) =>
          name === 'firestorm'
            ? (new Set([1, 2, 3, 4, 5]) as ReadonlySet<1 | 2 | 3 | 4 | 5>)
            : undefined,
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const firestorm = overlayPayload.scanData!.standard.find((s) => s.name === 'firestorm')!
    expect(firestorm.isCuratedForRole).toBe(true)
    expect(firestorm.isGeneralTopTier).toBe(true)
    // No role mode -> no role delta, the guarantee is pure selection
    expect(firestorm.roleScoreDelta).toBeUndefined()
  })

  it('an all-five roleAvoid excludes from suggestions role mode or not', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    const base = depsWithRole('off')
    const deps: ScanProcessorDeps = {
      ...base,
      tags: {
        ...mockTags,
        getRoleAvoid: (name: string) =>
          name === 'laguna_blade'
            ? (new Set([1, 2, 3, 4, 5]) as ReadonlySet<1 | 2 | 3 | 4 | 5>)
            : undefined,
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    // laguna_blade has the best mock stats (wr .60, pick 5) — avoid still wins
    const laguna = overlayPayload.scanData!.ultimates.find((s) => s.name === 'laguna_blade')!
    expect(laguna.roleAvoided).toBe(true)
    expect(laguna.isGeneralTopTier).toBe(false)
    expect(laguna.isSynergySuggestionForMySpot).toBe(false)
  })

  it('a partial roleAvoid gates only when it covers ALL effective positions', () => {
    const avoidTags = {
      ...mockTags,
      getRoleAvoid: (name: string) =>
        name === 'ice_blast' ? (new Set([5]) as ReadonlySet<1 | 2 | 3 | 4 | 5>) : undefined,
    }
    const run = (positions: number[]) => {
      const initial = processScanResults(makeInitialScanInput())
      const state = initial.updatedState
      state.mySelectedSpotDbId = 1
      state.mySelectedSpotHeroOrder = 0
      const deps = { ...depsWithRole('fixed', positions), tags: avoidTags }
      const input: ScanProcessorInput = {
        rawResults: [] as ScanResult[],
        isInitialScan: false,
        state,
        deps,
        modelCoords: [makeCoord(0), makeCoord(1)],
        heroesCoords: [makeCoord(0), makeCoord(1)],
        heroesParams: { width: 358, height: 170 },
        targetResolution: '1920x1080',
        scaleFactor: 1.0,
      }
      return processScanResults(input).overlayPayload.scanData!.standard.find(
        (s) => s.name === 'ice_blast',
      )!
    }

    expect(run([5]).roleAvoided).toBe(true)
    expect(run([3]).roleAvoided).toBeUndefined()
    // Mixed selection where one position is NOT avoided -> allowed
    expect(run([4, 5]).roleAvoided).toBeUndefined()
  })

  it('overrated abilities (early pick, low winrate) get damped and marked', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    const base = depsWithRole('off')
    const overratedDb: typeof abilityDb = {
      ...abilityDb,
      ice_blast: { ...abilityDb.ice_blast, winrate: 0.45, pickRate: 9 },
    }
    const deps: ScanProcessorDeps = {
      ...base,
      abilities: {
        ...base.abilities,
        getDetails(names: string[]) {
          const map = new Map<string, AbilityDetail>()
          for (const name of names) {
            if (overratedDb[name]) map.set(name, overratedDb[name])
          }
          return map
        },
      },
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    const iceBlast = overlayPayload.scanData!.standard.find((s) => s.name === 'ice_blast')!
    expect(iceBlast.overrated).toBe(true)
    // damped: 0.4*0.45 + 0.6*(50-9)/49 = 0.682 -> minus OVERRATED_DAMP
    expect(iceBlast.consolidatedScore).toBeCloseTo(0.682 - 0.12, 2)
    const fireball = overlayPayload.scanData!.standard.find((s) => s.name === 'fireball')!
    expect(fireball.overrated).toBeUndefined()
  })

  it('needs-engine chips reach the enriched slots in a role mode', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedSpotDbId = 1
    state.mySelectedSpotHeroOrder = 0
    const deps = { ...depsWithRole('fixed', [5]), tags: mockTags }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    // No picks yet: ice_blast (hard_cc) covers the unmet pos-5 disable need
    const iceBlast = overlayPayload.scanData!.standard.find((s) => s.name === 'ice_blast')!
    expect(iceBlast.roleReasons).toContain('covers:hard_cc')
    // firestorm (waveclear) covers the unmet waveclear|nuke need
    const firestorm = overlayPayload.scanData!.standard.find((s) => s.name === 'firestorm')!
    expect(firestorm.roleReasons).toContain('covers:waveclear')
  })

  it('flags contested-soon abilities on suggestions (global pick timing)', () => {
    // fireball pickRate 10 <= 0 named picks + window(10) -> contested;
    // firestorm pickRate 25 -> not
    const { overlayPayload } = processScanResults(makeInitialScanInput())
    const fireball = overlayPayload.scanData!.standard.find((s) => s.name === 'fireball')!
    const firestorm = overlayPayload.scanData!.standard.find((s) => s.name === 'firestorm')!

    expect(fireball.contestedSoon).toBe(true)
    expect(firestorm.contestedSoon).toBeUndefined()
  })

  it('ult security boosts ultimates when supply is tight and I lack one', () => {
    // Pool has 1 ult (laguna) and 10 ult-less drafters -> 1 <= 10 + slack: active
    const withRole = runRescanWithRole('fixed', [2])
    const laguna = withRole.overlayPayload.scanData!.ultimates.find(
      (s) => s.name === 'laguna_blade',
    )!
    // Compare against a slot-identical run with role off (no role layer at all)
    const withoutRole = runRescanWithRole('off')
    const lagunaOff = withoutRole.overlayPayload.scanData!.ultimates.find(
      (s) => s.name === 'laguna_blade',
    )!

    expect(laguna.roleScoreDelta).toBeDefined()
    expect(lagunaOff.roleScoreDelta).toBeUndefined()
    // The nudge is part of the role delta; a standard ability with similar greed
    // does not receive it
    const iceBlast = withRole.overlayPayload.scanData!.standard.find(
      (s) => s.name === 'ice_blast',
    )!
    expect(laguna.roleScoreDelta! - iceBlast.roleScoreDelta!).toBeGreaterThan(0.03)
  })

  it('a database with no shift data suppresses role scoring entirely', () => {
    const initial = processScanResults(makeInitialScanInput())
    const state = initial.updatedState
    state.mySelectedSpotDbId = 1
    state.mySelectedSpotHeroOrder = 0
    const noShiftDeps = depsWithRole('fixed', [5])
    noShiftDeps.abilities = {
      ...mockDeps.abilities,
      getAllShifts: () =>
        mockDeps.abilities.getAllShifts().map((row) => ({
          ...row,
          gpmShift: null,
          xpmShift: null,
          healingShift: null,
        })),
    }
    const input: ScanProcessorInput = {
      rawResults: [] as ScanResult[],
      isInitialScan: false,
      state,
      deps: noShiftDeps,
      modelCoords: [makeCoord(0), makeCoord(1)],
      heroesCoords: [makeCoord(0), makeCoord(1)],
      heroesParams: { width: 358, height: 170 },
      targetResolution: '1920x1080',
      scaleFactor: 1.0,
    }
    const { overlayPayload } = processScanResults(input)

    expect(overlayPayload.roleContext).toBeDefined()
    expect(overlayPayload.roleContext!.status).toBe('noData')
    expect(overlayPayload.roleContext!.effectivePositions).toEqual([])
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeUndefined()
    }
  })

  it('dynamic mode with no teammate picks keeps the gate closed and scoring neutral', () => {
    const { overlayPayload } = runRescanWithRole('dynamic')

    expect(overlayPayload.roleContext).toBeDefined()
    expect(overlayPayload.roleContext!.mode).toBe('dynamic')
    expect(overlayPayload.roleContext!.dynamicGateOpen).toBe(false)
    expect(overlayPayload.roleContext!.effectivePositions).toEqual([])
    for (const slot of overlayPayload.scanData!.standard) {
      expect(slot.roleScoreDelta).toBeUndefined()
    }
  })
})
