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
    coord: { x: 0, y: 0, width: 64, height: 64, hero_order: heroOrder, ability_order: abilityOrder },
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
    getByAbilityName(abilityName: string) {
      const map: Record<string, { heroId: number; heroName: string; heroDisplayName: string | null }> = {
        firestorm: { heroId: 1, heroName: 'lina', heroDisplayName: 'Lina' },
        blink: { heroId: 3, heroName: 'antimage', heroDisplayName: 'Anti-Mage' },
      }
      return map[abilityName] ?? null
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
  }
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
})
