import { describe, it, expect } from 'vitest'
import { buildStreamBoardState } from '@core/domain/stream-board'
import type { StreamBoardBuildInput } from '@core/domain/stream-board'
import type {
  EnrichedScanSlot,
  HeroModelDisplay,
  OverlayDataPayload,
  SynergyPairDisplay,
} from '@shared/types'
import type { PairSynergyInput } from '@core/domain/player-draft-score'
import {
  STREAM_MAX_COMBO_PANEL_ENTRIES,
  STREAM_TOP_WINRATE_COUNT,
} from '@shared/constants/thresholds'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSlot(
  name: string | null,
  heroOrder: number,
  abilityOrder: number,
  isUltimate: boolean,
  overrides: Partial<EnrichedScanSlot> = {},
): EnrichedScanSlot {
  return {
    name,
    confidence: 0.95,
    hero_order: heroOrder,
    ability_order: abilityOrder,
    is_ultimate: isUltimate,
    coord: {
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      hero_order: heroOrder,
      ability_order: abilityOrder,
    },
    displayName: name ?? 'Unknown',
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: isUltimate,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
    ...overrides,
  }
}

function makeHeroModel(
  heroOrder: number,
  overrides: Partial<HeroModelDisplay> = {},
): HeroModelDisplay {
  return {
    heroOrder,
    heroName: `hero${heroOrder}`,
    heroDisplayName: `Hero ${heroOrder}`,
    dbHeroId: heroOrder + 1,
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    identificationConfidence: 0.95,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
    ...overrides,
  }
}

/**
 * Full 12-row pool: hero row 0 uses realistic Pudge names (so portrait derivation
 * works), the rest use synthetic hero<N>_slot<M> names which also share a prefix.
 */
function makeInitialPayload(): OverlayDataPayload {
  const standard: EnrichedScanSlot[] = []
  const ultimates: EnrichedScanSlot[] = []

  standard.push(
    makeSlot('pudge_meat_hook', 0, 1, false, { winrate: 0.56 }),
    makeSlot('pudge_rot', 0, 2, false, { winrate: 0.53 }),
    makeSlot('pudge_flesh_heap', 0, 3, false, { winrate: 0.49 }),
  )
  ultimates.push(makeSlot('pudge_dismember', 0, 0, true, { winrate: 0.58 }))

  for (let h = 1; h < 12; h++) {
    for (let a = 1; a <= 3; a++) {
      standard.push(makeSlot(`hero${h}_slot${a}`, h, a, false))
    }
    ultimates.push(makeSlot(`hero${h}_ult`, h, 0, true))
  }

  return {
    initialSetup: false,
    scanData: { ultimates, standard, selectedAbilities: [] },
    targetResolution: '1920x1080',
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels: Array.from({ length: 12 }, (_, i) => makeHeroModel(i)),
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedModelHeroOrder: null,
    heroesCoords: [],
    heroesParams: { width: 0, height: 0 },
    modelsCoords: [],
    autoDraftTrackingEnabled: false,
  }
}

function makeInput(overrides: Partial<StreamBoardBuildInput> = {}): StreamBoardBuildInput {
  return {
    initialPayload: makeInitialPayload(),
    latestPayload: null,
    gsi: null,
    meta: { language: 'en', appVersion: '2.1.0', updatedAt: 1000 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildStreamBoardState', () => {
  it('marks pool hero rows whose model was drafted, from the LATEST payload', () => {
    // isPicked flips on rescans (tile-diff detection), so it must be read from
    // the latest payload, not the frozen initial one
    const latest = makeInitialPayload()
    latest.heroModels[3] = makeHeroModel(3, { isPicked: true })
    const state = buildStreamBoardState(makeInput({ latestPayload: latest }))
    expect(state.heroes[3].modelPicked).toBe(true)
    expect(state.heroes[0].modelPicked).toBe(false)
  })

  it('fills player-row models from scan attribution when GSI has none', () => {
    const state = buildStreamBoardState(
      makeInput({
        modelAssignments: [{ poolHeroOrder: 3, playerIndex: 1 }],
      }),
    )
    const player1 = state.players[1]
    expect(player1.model).not.toBeNull()
    expect(player1.model?.displayName).toBe('Hero 3')
    // Other players untouched
    expect(state.players[0].model).toBeNull()
  })

  it('GSI player models win over scan attribution', () => {
    const state = buildStreamBoardState(
      makeInput({
        modelAssignments: [{ poolHeroOrder: 3, playerIndex: 1 }],
        gsi: {
          connected: true,
          gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
          clockTime: 0,
          playerNames: [],
          playerModels: Object.assign(Array.from({ length: 10 }, () => null), {
            1: { npcName: 'sand_king', displayName: 'Sand King' },
          }),
        },
      }),
    )
    expect(state.players[1].model?.displayName).toBe('Sand King')
  })

  it('returns waiting phase with empty board when no scan has happened', () => {
    const state = buildStreamBoardState(makeInput({ initialPayload: null }))
    expect(state.phase).toBe('waiting')
    expect(state.heroes).toEqual([])
    expect(state.players).toEqual([])
    expect(state.gsi.connected).toBe(false)
    expect(state.meta.language).toBe('en')
  })

  it('builds 12 hero rows with sorted standard slots and an ultimate', () => {
    const state = buildStreamBoardState(makeInput())
    expect(state.phase).toBe('drafting')
    expect(state.heroes).toHaveLength(12)
    const row0 = state.heroes[0]
    expect(row0.standard.map((s) => s.name)).toEqual([
      'pudge_meat_hook',
      'pudge_rot',
      'pudge_flesh_heap',
    ])
    expect(row0.ultimate?.name).toBe('pudge_dismember')
    expect(row0.heroDisplayName).toBe('Hero 0')
  })

  it('derives the hero portrait path from the row ability names', () => {
    const state = buildStreamBoardState(makeInput())
    expect(state.heroes[0].portraitPath).toBe('/icons/heroes/pudge.png')
    expect(state.heroes[3].portraitPath).toBe('/icons/heroes/hero3.png')
  })

  it('maps ability icon paths and leaves unknown slots without one', () => {
    const initial = makeInitialPayload()
    const scanData = initial.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.standard[0] = makeSlot(null, 0, 1, false, { isUnknown: true })
    const state = buildStreamBoardState(makeInput({ initialPayload: initial }))
    const row0 = state.heroes[0]
    expect(row0.standard[0].iconPath).toBeNull()
    expect(row0.standard[0].isUnknown).toBe(true)
    expect(row0.standard[1].iconPath).toBe('/icons/abilities/pudge_rot.png')
  })

  it('nulls heroDisplayName when the model was not identified', () => {
    const initial = makeInitialPayload()
    initial.heroModels[2] = makeHeroModel(2, { dbHeroId: null })
    const state = buildStreamBoardState(makeInput({ initialPayload: initial }))
    expect(state.heroes[2].heroDisplayName).toBeNull()
  })

  it('marks pool tiles picked when they appear in the latest selected abilities', () => {
    const latest = makeInitialPayload()
    const scanData = latest.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.selectedAbilities = [makeSlot('pudge_rot', 3, 1, false)]

    const state = buildStreamBoardState(makeInput({ latestPayload: latest }))
    const row0 = state.heroes[0]
    expect(row0.standard.find((s) => s.name === 'pudge_rot')?.isPicked).toBe(true)
    expect(row0.standard.find((s) => s.name === 'pudge_meat_hook')?.isPicked).toBe(false)
  })

  it('builds 10 player rows with team split and GSI names', () => {
    const latest = makeInitialPayload()
    const scanData = latest.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.selectedAbilities = [
      makeSlot('pudge_rot', 0, 1, false, { winrate: 0.53 }),
      makeSlot('hero1_slot1', 7, 1, false),
    ]

    const state = buildStreamBoardState(
      makeInput({
        latestPayload: latest,
        gsi: {
          connected: true,
          gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
          clockTime: 42,
          playerNames: ['Alice', null, null, null, null, null, null, 'Bob', null, null],
          playerModels: [
            { npcName: 'sand_king', displayName: 'Sand King' },
            null, null, null, null, null, null, null, null, null,
          ],
        },
      }),
    )

    expect(state.players).toHaveLength(10)
    expect(state.players[0].team).toBe('radiant')
    expect(state.players[7].team).toBe('dire')
    expect(state.players[0].playerName).toBe('Alice')
    expect(state.players[7].playerName).toBe('Bob')
    expect(state.players[0].model).toEqual({
      npcName: 'sand_king',
      displayName: 'Sand King',
      portraitPath: '/icons/heroes/sand_king.png',
    })
    expect(state.players[1].model).toBeNull()
    expect(state.players[0].picks.map((p) => p.name)).toEqual(['pudge_rot'])
    expect(state.players[7].picks.map((p) => p.name)).toEqual(['hero1_slot1'])
    expect(state.players[1].picks).toEqual([])
    expect(state.players[1].draftScore).toBeNull()
  })

  it('computes draft scores through the provided synergy lookup', () => {
    const latest = makeInitialPayload()
    const scanData = latest.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.selectedAbilities = [
      makeSlot('pudge_rot', 4, 1, false, { winrate: 0.6 }),
      makeSlot('hero2_slot2', 4, 2, false, { winrate: 0.6 }),
    ]

    const lookups: string[][] = []
    const getPairSynergies = (names: string[]): PairSynergyInput[] => {
      lookups.push(names)
      return [
        {
          ability1Name: 'pudge_rot',
          ability2Name: 'hero2_slot2',
          synergyWinrate: 0.62,
          synergyIncrease: 0.04,
        },
      ]
    }

    const state = buildStreamBoardState(
      makeInput({ latestPayload: latest, getPairSynergies }),
    )
    const score = state.players[4].draftScore
    expect(score).not.toBeNull()
    expect(score?.confidence).toBe('medium')
    expect(score?.base).toBeCloseTo(0.6)
    expect(score?.synergyAdjustment).toBeCloseTo(0.04)
    expect(lookups).toContainEqual(['pudge_rot', 'hero2_slot2'])
  })

  it('excludes unknown selected slots from picks and picked-marking', () => {
    const latest = makeInitialPayload()
    const scanData = latest.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.selectedAbilities = [
      makeSlot(null, 2, 1, false, { isUnknown: true }),
    ]
    const state = buildStreamBoardState(makeInput({ latestPayload: latest }))
    expect(state.players[2].picks).toEqual([])
    expect(state.players[2].draftScore).toBeNull()
  })

  it('builds top-winrate panel sorted and capped', () => {
    const state = buildStreamBoardState(makeInput())
    const panel = state.panels.topWinrateInPool
    expect(panel.length).toBeLessThanOrEqual(STREAM_TOP_WINRATE_COUNT)
    expect(panel[0].name).toBe('pudge_dismember')
    for (let i = 1; i < panel.length; i++) {
      expect(panel[i - 1].winrate ?? 0).toBeGreaterThanOrEqual(panel[i].winrate ?? 0)
    }
  })

  it('builds top-tier panel from isGeneralTopTier flags', () => {
    const initial = makeInitialPayload()
    const scanData = initial.scanData
    if (!scanData) throw new Error('fixture has scanData')
    scanData.standard[0] = makeSlot('pudge_meat_hook', 0, 1, false, {
      isGeneralTopTier: true,
      consolidatedScore: 0.9,
    })
    const state = buildStreamBoardState(makeInput({ initialPayload: initial }))
    expect(state.panels.topTier.map((s) => s.name)).toEqual(['pudge_meat_hook'])
    expect(state.panels.topTier[0].isTopTier).toBe(true)
  })

  it('maps OP/trap combos with icons, sorted and capped', () => {
    const initial = makeInitialPayload()
    const combos: SynergyPairDisplay[] = Array.from({ length: 12 }, (_, i) => ({
      ability1DisplayName: `A${i}`,
      ability2DisplayName: `B${i}`,
      ability1Name: `a_${i}`,
      ability2Name: `b_${i}`,
      synergyWinrate: 0.5 + i * 0.01,
    }))
    initial.opCombinations = combos
    initial.trapCombinations = combos

    const state = buildStreamBoardState(makeInput({ initialPayload: initial }))
    expect(state.panels.opCombos).toHaveLength(STREAM_MAX_COMBO_PANEL_ENTRIES)
    expect(state.panels.opCombos[0].synergyWinrate).toBeCloseTo(0.61)
    expect(state.panels.opCombos[0].ability1.iconPath).toBe('/icons/abilities/a_11.png')
    expect(state.panels.trapCombos[0].synergyWinrate).toBeCloseTo(0.5)
  })

  it('handles combos without internal names (no icon)', () => {
    const initial = makeInitialPayload()
    initial.opCombinations = [
      {
        ability1DisplayName: 'Legacy A',
        ability2DisplayName: 'Legacy B',
        synergyWinrate: 0.66,
      },
    ]
    const state = buildStreamBoardState(makeInput({ initialPayload: initial }))
    expect(state.panels.opCombos[0].ability1.name).toBeNull()
    expect(state.panels.opCombos[0].ability1.iconPath).toBeNull()
    expect(state.panels.opCombos[0].ability1.displayName).toBe('Legacy A')
  })

  it('uses initial payload for panels when no rescan has happened yet', () => {
    const state = buildStreamBoardState(makeInput({ latestPayload: null }))
    expect(state.phase).toBe('drafting')
    expect(state.panels.topWinrateInPool.length).toBeGreaterThan(0)
  })
})
