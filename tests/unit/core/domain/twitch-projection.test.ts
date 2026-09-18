import { describe, it, expect } from 'vitest'
import { buildStreamBoardState } from '@core/domain/stream-board'
import type { StreamBoardBuildInput } from '@core/domain/stream-board'
import {
  buildPoolIndexMap,
  buildTwitchCompactState,
  buildTwitchRichState,
  encodeTwitchCompact,
  initialTwitchPhaseState,
  nextTwitchPhase,
  restampCompact,
  twitchCompactContentKey,
  twitchDraftId,
  twitchRichContentKey,
  type TwitchCompactInput,
  type TwitchRichInput,
  type TwitchRichLookups,
} from '@core/domain/twitch-projection'
import type {
  AbilityDetail,
  EnrichedScanSlot,
  HeroModelDisplay,
  OverlayDataPayload,
} from '@shared/types'
import type { PickEvent } from '@shared/types/stream'
import {
  TWITCH_MODEL_PICKED_BIT,
  TWITCH_PROTOCOL_VERSION,
  type TwitchCompactState,
  type TwitchPlayerRow,
  type TwitchPoolRow,
} from '@shared/types/twitch'
import { TWITCH_COMPACT_MAX_BYTES } from '@shared/constants/thresholds'

// ---------------------------------------------------------------------------
// Fixtures (same conventions as stream-board.test.ts, plus real-looking coords)
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
      x: 731 + abilityOrder * 77,
      y: 344 + heroOrder * 60,
      width: 47,
      height: 42,
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
    winrate: 0.5 + heroOrder / 100,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    identificationConfidence: 0.95,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
    ...overrides,
  }
}

/** Row 0 is Pudge (real names -> portrait derivation works); rows 1-11 synthetic. */
function makeInitialPayload(): OverlayDataPayload {
  const standard: EnrichedScanSlot[] = []
  const ultimates: EnrichedScanSlot[] = []

  standard.push(
    makeSlot('pudge_meat_hook', 0, 1, false, { winrate: 0.56, isGeneralTopTier: true }),
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
    selectedSpotHeroOrder: null,
    selectedModelHeroOrder: null,
    heroesCoords: Array.from({ length: 10 }, (_, p) => ({
      x: 140,
      y: 146 + p * 162,
      width: 0,
      height: 0,
      hero_order: p,
    })),
    heroesParams: { width: 320, height: 146 },
    modelsCoords: Array.from({ length: 12 }, (_, h) => ({
      x: 600,
      y: 100 + h * 70,
      width: 60,
      height: 60,
      hero_order: h,
    })),
    pickBoxCoords: Array.from({ length: 10 }, (_, p) => [
      { x: 211, y: 232 + p * 168, width: 0, height: 0, hero_order: p, is_ultimate: false },
      { x: 272, y: 232 + p * 168, width: 0, height: 0, hero_order: p, is_ultimate: false },
      { x: 333, y: 232 + p * 168, width: 0, height: 0, hero_order: p, is_ultimate: false },
      { x: 393, y: 232 + p * 168, width: 0, height: 0, hero_order: p, is_ultimate: true },
    ]).flat(),
    pickBoxParams: { width: 66, height: 66 },
    autoDraftTrackingEnabled: false,
  }
}

/** Latest payload: player 0 picked Meat Hook, player 7 picked hero3's ultimate. */
function makeLatestPayload(): OverlayDataPayload {
  const latest = makeInitialPayload()
  latest.scanData = {
    ultimates: latest.scanData!.ultimates.filter((s) => s.name !== 'hero3_ult'),
    standard: latest.scanData!.standard.filter((s) => s.name !== 'pudge_meat_hook'),
    selectedAbilities: [
      makeSlot('pudge_meat_hook', 0, 1, false, { winrate: 0.56 }),
      makeSlot('hero3_ult', 7, 0, true),
      // Recognized by template matching but never read in the grid
      makeSlot('lich_frost_nova', 7, 1, false),
    ],
  }
  latest.heroModels[5] = makeHeroModel(5, { isPicked: true })
  return latest
}

function makeBoard(overrides: Partial<StreamBoardBuildInput> = {}) {
  return buildStreamBoardState({
    initialPayload: makeInitialPayload(),
    latestPayload: makeLatestPayload(),
    gsi: null,
    meta: { language: 'en', appVersion: '3.0.0', updatedAt: 1000 },
    getPairSynergies: () => [],
    modelAssignments: [{ poolHeroOrder: 5, playerIndex: 2 }],
    ...overrides,
  })
}

function makeCompactInput(overrides: Partial<TwitchCompactInput> = {}): TwitchCompactInput {
  return {
    board: makeBoard(),
    pickEvents: [],
    phase: 'drafting',
    draftId: 'abc',
    rev: 3,
    richRev: 1,
    ts: 1_725_273_600_000,
    matchId: '7654321012',
    myRow: 4,
    ...overrides,
  }
}

const detailsOf = (names: string[]): Map<string, AbilityDetail> =>
  new Map(
    names.map((name, i) => [
      name,
      {
        abilityId: i + 1,
        name,
        displayName: name,
        // Same hero for every pudge_* ability, unique otherwise
        heroId: name.startsWith('pudge_') ? 1 : 100 + i,
        winrate: 0.5,
        highSkillWinrate: 0.6,
        pickRate: 20,
        hsPickRate: 18,
        isUltimate: name.endsWith('_ult') || name === 'pudge_dismember',
        abilityOrder: 1,
      } as AbilityDetail,
    ]),
  )

const lookups: TwitchRichLookups = {
  getAbilityDetails: detailsOf,
  getHeroes: () => [
    {
      heroId: 1,
      name: 'hero0',
      displayName: 'Hero 0',
      winrate: 0.5,
      highSkillWinrate: 0.55,
      pickRate: 20,
      hsPickRate: 19,
      windrunId: 1,
    },
  ],
  getPairSynergies: () => [
    {
      ability1Name: 'pudge_meat_hook',
      ability2Name: 'hero1_slot1',
      synergyWinrate: 0.61,
      synergyIncrease: 0.08,
    },
    // Same-hero pair — must be dropped
    {
      ability1Name: 'pudge_rot',
      ability2Name: 'pudge_meat_hook',
      synergyWinrate: 0.7,
      synergyIncrease: 0.2,
    },
    // Partner outside the pool — must be dropped
    {
      ability1Name: 'hero1_slot1',
      ability2Name: 'not_in_pool',
      synergyWinrate: 0.7,
      synergyIncrease: 0.2,
    },
    {
      ability1Name: 'hero2_ult',
      ability2Name: 'hero1_slot2',
      synergyWinrate: 0.44,
      synergyIncrease: -0.05,
    },
  ],
  getHeroPairSynergies: () => [
    { heroName: 'hero3', abilityName: 'pudge_rot', synergyWinrate: 0.58, synergyIncrease: 0.05 },
    {
      heroName: 'unknown_hero',
      abilityName: 'pudge_rot',
      synergyWinrate: 0.58,
      synergyIncrease: 0.05,
    },
  ],
}

function makeRichInput(overrides: Partial<TwitchRichInput> = {}): TwitchRichInput {
  return {
    board: makeBoard(),
    initialPayload: makeInitialPayload(),
    pickEvents: [],
    draftId: 'abc',
    richRev: 2,
    ts: 5000,
    thresholds: { op: 0.13, trap: 0.05 },
    meta: { appVersion: '3.0.0', language: 'en' },
    lookups,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Pool index map
// ---------------------------------------------------------------------------

describe('buildPoolIndexMap', () => {
  it('indexes heroOrder*4 + k with the ultimate at k=0', () => {
    const index = buildPoolIndexMap(makeBoard())
    expect(index.get('pudge_dismember')).toBe(0)
    expect(index.get('pudge_meat_hook')).toBe(1)
    expect(index.get('pudge_flesh_heap')).toBe(3)
    expect(index.get('hero3_ult')).toBe(12)
    expect(index.get('hero11_slot3')).toBe(47)
    expect(index.size).toBe(48)
  })
})

// ---------------------------------------------------------------------------
// Compact
// ---------------------------------------------------------------------------

describe('buildTwitchCompactState', () => {
  it('projects pool rows with names, picked masks and the model-picked bit', () => {
    const compact = buildTwitchCompactState(makeCompactInput())
    expect(compact.v).toBe(TWITCH_PROTOCOL_VERSION)
    expect(compact.d).toBe('abc')
    expect(compact.p).toBe('drafting')
    expect(compact.r).toBe(3)
    expect(compact.rr).toBe(1)
    expect(compact.mid).toBe('7654321012')
    expect(compact.me).toBe(4)

    expect(compact.pool).toHaveLength(12)
    const row0 = compact.pool![0] as TwitchPoolRow
    expect(row0[0]).toBe('pudge')
    expect(row0[1]).toEqual(['pudge_dismember', 'pudge_meat_hook', 'pudge_rot', 'pudge_flesh_heap'])
    // Meat Hook (k=1) picked -> bit 1
    expect(row0[2]).toBe(0b10)

    const row3 = compact.pool![3] as TwitchPoolRow
    expect(row3[2] & 1).toBe(1) // ultimate picked
    const row5 = compact.pool![5] as TwitchPoolRow
    expect(row5[2] & TWITCH_MODEL_PICKED_BIT).toBe(TWITCH_MODEL_PICKED_BIT)
  })

  it('projects player rows with pick refs, models and scores', () => {
    const compact = buildTwitchCompactState(makeCompactInput())
    expect(compact.players).toHaveLength(10)

    const p0 = compact.players![0] as TwitchPlayerRow
    expect(p0[1]).toEqual([1, null, null, null])
    expect(typeof p0[2]).toBe('number')
    expect(p0.length).toBe(3) // no GSI name -> omitted, not null

    const p7 = compact.players![7] as TwitchPlayerRow
    // Unindexed pick falls back to the raw name; ultimate sits in box 3
    expect(p7[1]).toEqual(['lich_frost_nova', null, null, 12])

    // Scan-attributed model -> pool row index
    const p2 = compact.players![2] as TwitchPlayerRow
    expect(p2[0]).toBe(5)
  })

  it('uses the CDN name for GSI-sourced models and truncates long player names', () => {
    const board = makeBoard({
      gsi: {
        connected: true,
        gamePhase: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
        clockTime: 0,
        spectating: false,
        playerNames: Object.assign(
          Array.from({ length: 10 }, () => null),
          {
            1: 'A'.repeat(40),
          },
        ),
        playerModels: Object.assign(
          Array.from({ length: 10 }, () => null),
          {
            1: { npcName: 'sand_king', displayName: 'Sand King' },
          },
        ),
      },
    })
    const compact = buildTwitchCompactState(makeCompactInput({ board }))
    const p1 = compact.players![1] as TwitchPlayerRow
    expect(p1[0]).toBe('sand_king')
    expect(p1[3]).toBe('A'.repeat(24))
  })

  it('maps the full feed with model markers and unknown names', () => {
    const pickEvents: PickEvent[] = [
      { seq: 0, playerIndex: 0, abilityName: 'pudge_meat_hook', kind: 'ability', clockTime: -3 },
      { seq: 1, playerIndex: 5, abilityName: null, kind: 'modelSelectionMarker', clockTime: null },
      { seq: 2, playerIndex: 7, abilityName: 'lich_frost_nova', kind: 'ability', clockTime: null },
      { seq: 3, playerIndex: 8, abilityName: null, kind: 'ability', clockTime: null },
    ]
    const compact = buildTwitchCompactState(makeCompactInput({ pickEvents }))
    expect(compact.f).toEqual([
      [0, 1],
      [5, -1],
      [7, 'lich_frost_nova'],
      [8, ''],
    ])
  })

  it('emits only the header in waiting phase or for a non-drafting board', () => {
    const waiting = buildTwitchCompactState(makeCompactInput({ phase: 'waiting' }))
    expect(waiting.pool).toBeUndefined()
    expect(waiting.players).toBeUndefined()

    const blankBoard = buildStreamBoardState({
      initialPayload: null,
      latestPayload: null,
      gsi: null,
      meta: { language: 'en', appVersion: '3.0.0', updatedAt: 1 },
    })
    const fromBlank = buildTwitchCompactState(makeCompactInput({ board: blankBoard }))
    expect(fromBlank.pool).toBeUndefined()
  })
})

describe('restampCompact', () => {
  it('re-stamps phase/rev/ts and strips draft content for waiting', () => {
    const compact = buildTwitchCompactState(makeCompactInput())
    const ingame = restampCompact(compact, { phase: 'ingame', rev: 9, ts: 42 })
    expect(ingame.p).toBe('ingame')
    expect(ingame.r).toBe(9)
    expect(ingame.t).toBe(42)
    expect(ingame.pool).toHaveLength(12)

    const waiting = restampCompact(compact, { phase: 'waiting', rev: 10, ts: 43 })
    expect(waiting.pool).toBeUndefined()
    expect(waiting.players).toBeUndefined()
    expect(waiting.me).toBeUndefined()
  })
})

describe('twitchCompactContentKey', () => {
  it('ignores the send stamp and revision', () => {
    const a = buildTwitchCompactState(makeCompactInput({ rev: 1, ts: 1 }))
    const b = buildTwitchCompactState(makeCompactInput({ rev: 2, ts: 2 }))
    expect(twitchCompactContentKey(a)).toBe(twitchCompactContentKey(b))
    const c = buildTwitchCompactState(makeCompactInput({ phase: 'ingame' }))
    expect(twitchCompactContentKey(a)).not.toBe(twitchCompactContentKey(c))
  })
})

// ---------------------------------------------------------------------------
// Size budget
// ---------------------------------------------------------------------------

function worstCaseCompact(pickRefs: 'index' | 'name'): TwitchCompactState {
  // 31-character internal names (longest real one: shadow_shaman_mass_serpent_ward)
  const longName = (i: number) => `${'x'.repeat(28)}_${String(i).padStart(2, '0')}`
  const pool: TwitchPoolRow[] = Array.from({ length: 12 }, (_, h) => [
    'obsidian_destroyer',
    [longName(h * 4), longName(h * 4 + 1), longName(h * 4 + 2), longName(h * 4 + 3)],
    15 | TWITCH_MODEL_PICKED_BIT,
  ])
  const ref = (i: number) => (pickRefs === 'index' ? i : longName(i))
  const players: TwitchPlayerRow[] = Array.from({ length: 10 }, (_, p) => [
    11,
    [ref(p * 4), ref(p * 4 + 1), ref(p * 4 + 2), ref(p * 4 + 3)],
    62,
    '€'.repeat(24), // 3-byte code points
  ])
  return {
    v: TWITCH_PROTOCOL_VERSION,
    d: 'm1x2y3z4',
    p: 'drafting',
    r: 999,
    t: 1_725_273_600_000,
    rr: 2,
    mid: '7654321012',
    me: 4,
    pool,
    players,
    // 40 ability events + 10 model markers
    f: Array.from({ length: 50 }, (_, i) => [i % 10, i < 40 ? ref(i) : -1]),
    // Fully resolved spectate seat map (worst case: every seat mapped)
    seats: [4, 2, 3, 0, 1, 5, 6, 8, 7, 9],
  }
}

describe('encodeTwitchCompact', () => {
  it('fits the worst realistic draft under the PubSub budget without truncation', () => {
    const encoded = encodeTwitchCompact(worstCaseCompact('index'))
    expect(encoded.fits).toBe(true)
    expect(encoded.bytes).toBeLessThan(TWITCH_COMPACT_MAX_BYTES)
    expect(encoded.state.trunc).toBeUndefined()
    expect(JSON.parse(encoded.json)).toEqual(encoded.state)
  })

  it('degrades names first, then the feed, for a pathological all-raw-name draft', () => {
    const encoded = encodeTwitchCompact(worstCaseCompact('name'))
    expect(encoded.fits).toBe(true)
    expect(encoded.bytes).toBeLessThanOrEqual(TWITCH_COMPACT_MAX_BYTES)
    expect(encoded.state.trunc).toBe(1)
    expect(encoded.state.players!.every((row) => row.length === 3)).toBe(true)
  })

  it('reports fits=false when even the fully degraded message is too large', () => {
    const encoded = encodeTwitchCompact(worstCaseCompact('name'), 500)
    expect(encoded.fits).toBe(false)
    expect(encoded.state.f).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Rich
// ---------------------------------------------------------------------------

describe('buildTwitchRichState', () => {
  it('normalizes geometry to fractions of the game frame', () => {
    const rich = buildTwitchRichState(makeRichInput())
    expect(rich.frame).toEqual({ w: 1920, h: 1080, res: '1920x1080' })
    // pudge_meat_hook: x=731+77 -> 808/1920, y=344/1080, w 47/1920, h 42/1080
    expect(rich.geometry.pool[1]).toEqual([0.4208, 0.3185, 0.0245, 0.0389])
    // ultimate slot of row 0 at index 0
    expect(rich.geometry.pool[0]).toEqual([0.3807, 0.3185, 0.0245, 0.0389])
    expect(rich.geometry.models[11]).toEqual([0.3125, 0.8056, 0.0313, 0.0556])
    // Cards take their size from heroesParams
    expect(rich.geometry.cards[0]).toEqual([0.0729, 0.1352, 0.1667, 0.1352])
    // Pick boxes: per player, 3 standard then the ultimate, size from pickBoxParams
    expect(rich.geometry.picks[3]).toEqual([0.2047, 0.2148, 0.0344, 0.0611])
    expect(rich.geometry.picks[4]).toEqual([0.1099, 0.3704, 0.0344, 0.0611])
  })

  it('yields null geometry when the resolution is unparsable', () => {
    const initialPayload = makeInitialPayload()
    initialPayload.targetResolution = 'auto'
    const rich = buildTwitchRichState(makeRichInput({ initialPayload }))
    expect(rich.frame.w).toBe(0)
    expect(rich.geometry.pool.every((r) => r === null)).toBe(true)
  })

  it('lists abilities and heroes with Windrun numbers', () => {
    const rich = buildTwitchRichState(makeRichInput())
    expect(rich.abilities).toHaveLength(48)
    const hook = rich.abilities.find((a) => a.n === 'pudge_meat_hook')!
    expect(hook.i).toBe(1)
    expect(hook.wr).toBe(0.56)
    expect(hook.hs).toBe(0.6)
    expect(hook.pp).toBe(20)
    expect(hook.tt).toBe(true)

    expect(rich.heroes).toHaveLength(12)
    expect(rich.heroes[0]).toEqual({
      i: 0,
      cdn: 'pudge',
      dn: 'Hero 0',
      wr: 0.5,
      hs: 0.55,
      pr: 20,
    })
    expect(rich.heroes[3].hs).toBeNull()
  })

  it('keeps only pool-internal, cross-hero synergy pairs as index pairs', () => {
    const rich = buildTwitchRichState(makeRichInput())
    expect(rich.pairs).toEqual([
      [1, 5, 0.61, 0.08],
      [6, 8, 0.44, -0.05],
    ])
    expect(rich.heroPairs).toEqual([[3, 2, 0.58, 0.05]])
    expect(rich.thresholds).toEqual({ op: 0.13, trap: 0.05 })
  })

  it('carries player names, the feed mirror and meta', () => {
    const pickEvents: PickEvent[] = [
      { seq: 0, playerIndex: 0, abilityName: 'pudge_meat_hook', kind: 'ability', clockTime: null },
    ]
    const rich = buildTwitchRichState(makeRichInput({ pickEvents }))
    expect(rich.playerNames).toHaveLength(10)
    expect(rich.f).toEqual([[0, 1]])
    expect(rich.spectating).toBe(false)
    expect(rich.meta).toEqual({ appVersion: '3.0.0', language: 'en' })
  })

  it('content key ignores the stamp and revision', () => {
    const a = buildTwitchRichState(makeRichInput({ richRev: 1, ts: 1 }))
    const b = buildTwitchRichState(makeRichInput({ richRev: 2, ts: 2 }))
    expect(twitchRichContentKey(a)).toBe(twitchRichContentKey(b))
  })
})

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

describe('nextTwitchPhase', () => {
  const HERO_SELECTION = 'DOTA_GAMERULES_STATE_HERO_SELECTION'

  it('starts a draft on the initial scan with a fresh draft id', () => {
    const t = nextTwitchPhase(initialTwitchPhaseState(), { type: 'initialScan', ts: 1000 })
    expect(t.state.phase).toBe('drafting')
    expect(t.state.draftId).toBe(twitchDraftId(1000))
    expect(t.newDraft).toBe(true)
    expect(t.changed).toBe(true)
  })

  it('walks drafting -> ingame -> ended on GSI phases', () => {
    let s = nextTwitchPhase(initialTwitchPhaseState(), { type: 'initialScan', ts: 1 }).state
    s = nextTwitchPhase(s, { type: 'gsi', gamePhase: HERO_SELECTION, matchId: 'm1' }).state
    expect(s.phase).toBe('drafting')
    expect(s.matchId).toBe('m1')
    s = nextTwitchPhase(s, {
      type: 'gsi',
      gamePhase: 'DOTA_GAMERULES_STATE_STRATEGY_TIME',
      matchId: 'm1',
    }).state
    expect(s.phase).toBe('ingame')
    s = nextTwitchPhase(s, {
      type: 'gsi',
      gamePhase: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
      matchId: 'm1',
    }).state
    expect(s.phase).toBe('ingame')
    s = nextTwitchPhase(s, {
      type: 'gsi',
      gamePhase: 'DOTA_GAMERULES_STATE_POST_GAME',
      matchId: 'm1',
    }).state
    expect(s.phase).toBe('ended')
  })

  it('treats a session reset while drafting as draft over, never as forget', () => {
    let s = nextTwitchPhase(initialTwitchPhaseState(), { type: 'initialScan', ts: 1 }).state
    const t = nextTwitchPhase(s, { type: 'sessionReset' })
    expect(t.state.phase).toBe('ingame')
    expect(t.state.draftId).toBe(s.draftId)
    s = t.state
    // A second reset (overlay reopened + closed) changes nothing
    expect(nextTwitchPhase(s, { type: 'sessionReset' }).changed).toBe(false)
  })

  it('hides the old draft when a NEW match reaches hero selection', () => {
    let s = nextTwitchPhase(initialTwitchPhaseState(), { type: 'initialScan', ts: 1 }).state
    s = nextTwitchPhase(s, { type: 'gsi', gamePhase: HERO_SELECTION, matchId: 'm1' }).state
    s = nextTwitchPhase(s, { type: 'sessionReset' }).state
    // Same match flapping back into hero selection (replay) keeps the snapshot
    expect(
      nextTwitchPhase(s, { type: 'gsi', gamePhase: HERO_SELECTION, matchId: 'm1' }).state.phase,
    ).toBe('ingame')
    // A different match hides it
    const next = nextTwitchPhase(s, { type: 'gsi', gamePhase: HERO_SELECTION, matchId: 'm2' })
    expect(next.state.phase).toBe('waiting')
    expect(next.state.matchId).toBe('m2')
    // Unknown ids while in-game: also a new draft (cannot prove it is the same one)
    const unknown = nextTwitchPhase(s, { type: 'gsi', gamePhase: HERO_SELECTION, matchId: null })
    expect(unknown.state.phase).toBe('waiting')
  })

  it('stale ends only in-game snapshots; quit ends drafting and in-game', () => {
    const drafting = nextTwitchPhase(initialTwitchPhaseState(), {
      type: 'initialScan',
      ts: 1,
    }).state
    expect(nextTwitchPhase(drafting, { type: 'stale' }).state.phase).toBe('drafting')
    const ingame = nextTwitchPhase(drafting, { type: 'sessionReset' }).state
    expect(nextTwitchPhase(ingame, { type: 'stale' }).state.phase).toBe('ended')
    expect(nextTwitchPhase(drafting, { type: 'quit' }).state.phase).toBe('ended')
    expect(nextTwitchPhase(initialTwitchPhaseState(), { type: 'quit' }).state.phase).toBe('waiting')
    expect(nextTwitchPhase(drafting, { type: 'rescan' }).changed).toBe(false)
  })
})
