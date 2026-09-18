import type { EnrichedScanSlot, OverlayDataPayload } from '@shared/types'
import type { PickEvent, StreamBoardState } from '@shared/types/stream'
import type {
  TwitchCompactState,
  TwitchLiveState,
  TwitchPhase,
  TwitchPlayerRow,
  TwitchPoolRow,
  TwitchRichState,
} from '@shared/types/twitch'
import { buildDemoState } from '../../../../src/renderer/stream/src/demo'
import {
  buildTwitchCompactState,
  buildTwitchRichState,
  twitchDraftId,
} from '@core/domain/twitch-projection'
import { FALLBACK_1080P } from '../geometry/fallback-1080p'

// Demo data for ?demo=… — reuses the stream SPA's demo board (real internal names) and
// runs it through the SAME projection code the app uses, so the fixtures cannot drift
// from the wire format. Synergy rows are synthetic but plausible.

const DRAFT_TS = Date.UTC(2026, 8, 2, 12, 0, 0)

function slotFromBoard(
  name: string | null,
  heroOrder: number,
  abilityOrder: number,
  winrate: number | null,
): EnrichedScanSlot {
  const rect = FALLBACK_1080P.pool[heroOrder * 4 + abilityOrder]
  return {
    name,
    confidence: 0.99,
    hero_order: heroOrder,
    ability_order: abilityOrder,
    is_ultimate: abilityOrder === 0,
    coord: {
      x: (rect?.[0] ?? 0) * 1920,
      y: (rect?.[1] ?? 0) * 1080,
      width: (rect?.[2] ?? 0) * 1920,
      height: (rect?.[3] ?? 0) * 1080,
      hero_order: heroOrder,
      ability_order: abilityOrder,
    },
    displayName: name ?? 'Unknown',
    winrate,
    pickRate: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: abilityOrder === 0,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
  }
}

/** A synthetic initial payload carrying the demo board's grid + 1080p geometry. */
function payloadFromBoard(board: StreamBoardState): OverlayDataPayload {
  const standard: EnrichedScanSlot[] = []
  const ultimates: EnrichedScanSlot[] = []
  for (const row of board.heroes) {
    row.standard.forEach((s, k) => standard.push(slotFromBoard(s.name, row.heroOrder, k + 1, s.winrate)))
    if (row.ultimate) ultimates.push(slotFromBoard(row.ultimate.name, row.heroOrder, 0, row.ultimate.winrate))
  }
  const rect = (r: readonly number[] | null) => ({
    x: (r?.[0] ?? 0) * 1920,
    y: (r?.[1] ?? 0) * 1080,
    width: (r?.[2] ?? 0) * 1920,
    height: (r?.[3] ?? 0) * 1080,
  })
  return {
    initialSetup: false,
    scanData: { ultimates, standard, selectedAbilities: [] },
    targetResolution: '1920x1080',
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels: board.heroes.map((row) => ({
      heroOrder: row.heroOrder,
      heroName: (row.cdnName ?? `hero${row.heroOrder}`).replace(/_/g, ''),
      heroDisplayName: row.heroDisplayName ?? `Hero ${row.heroOrder}`,
      dbHeroId: row.heroOrder + 1,
      winrate: 0.47 + (row.heroOrder % 7) / 100,
      pickRate: 10 + row.heroOrder,
      consolidatedScore: 0.5,
      isGeneralTopTier: false,
      identificationConfidence: 0.99,
      strongAbilitySynergies: [],
      weakAbilitySynergies: [],
      isPicked: row.modelPicked,
    })),
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedSpotHeroOrder: null,
    selectedModelHeroOrder: null,
    heroesCoords: FALLBACK_1080P.cards.map((r, i) => ({ ...rect(r), hero_order: i })),
    heroesParams: { width: 320, height: 146 },
    modelsCoords: FALLBACK_1080P.models.map((r, i) => ({ ...rect(r), hero_order: i })),
    pickBoxCoords: FALLBACK_1080P.picks.map((r, i) => ({
      ...rect(r),
      hero_order: Math.floor(i / 4),
      is_ultimate: i % 4 === 3,
    })),
    pickBoxParams: { width: 66, height: 66 },
    autoDraftTrackingEnabled: true,
  }
}

function demoPickEvents(board: StreamBoardState): PickEvent[] {
  const events: PickEvent[] = []
  let seq = 0
  for (const player of board.players) {
    for (const pick of player.picks) {
      if (pick?.name) {
        events.push({ seq: seq++, playerIndex: player.playerIndex, abilityName: pick.name, kind: 'ability', clockTime: null })
      }
    }
    if (player.model) {
      events.push({ seq: seq++, playerIndex: player.playerIndex, abilityName: null, kind: 'modelSelectionMarker', clockTime: null })
    }
  }
  return events
}

function synthPairs(names: string[]) {
  // Deterministic pseudo-random pairs across different heroes
  const rows: Array<{ ability1Name: string; ability2Name: string; synergyWinrate: number; synergyIncrease: number | null }> = []
  for (let a = 0; a < names.length; a++) {
    for (let step = 5; step < 48; step += 11) {
      const b = (a + step) % names.length
      if (b <= a) continue
      const seed = (a * 31 + b * 17) % 100
      const inc = (seed - 50) / 250
      rows.push({ ability1Name: names[a], ability2Name: names[b], synergyWinrate: 0.5 + inc, synergyIncrease: inc })
    }
  }
  return rows
}

export interface DemoFixture {
  compact: TwitchCompactState
  rich: TwitchRichState
  live: TwitchLiveState
}

/**
 * Finish the demo draft. The shared demo board is a MID-draft snapshot, which is
 * right for `?demo=1` and wrong for the in-game phases: by then every player has
 * four abilities. Fills each player's empty slots from the still-unpicked pool
 * and marks those slots picked, deterministically so the demo never shuffles.
 */
function completeDraft(compact: TwitchCompactState): TwitchCompactState {
  if (!compact.pool || !compact.players) return compact
  const pool = compact.pool.map((row) => [row[0], [...row[1]], row[2]] as TwitchPoolRow)
  const players = compact.players.map((row) => [...row] as TwitchPlayerRow)

  const taken = new Set<number>()
  for (const player of players) {
    for (const pick of player[1]) if (typeof pick === 'number') taken.add(pick)
  }
  const available: number[] = []
  for (let i = 0; i < 48; i++) {
    const row = pool[Math.floor(i / 4)]
    if (row && row[1][i % 4] && !taken.has(i)) available.push(i)
  }

  let next = 0
  for (const player of players) {
    const picks = [...player[1]] as TwitchPlayerRow[1]
    for (let box = 0; box < 4; box++) {
      if (picks[box] !== null || next >= available.length) continue
      const index = available[next++]
      picks[box] = index
      const row = pool[Math.floor(index / 4)]
      row[2] |= 1 << index % 4
    }
    player[1] = picks
  }
  return { ...compact, pool, players }
}

/** Plausible caster telemetry for ?demo=ingame — deterministic, not random. */
function buildDemoLive(draftId: string): TwitchLiveState {
  const ITEMS = [
    ['blink', 'black_king_bar', 'power_treads', 'magic_wand', null, null],
    ['aether_lens', 'arcane_boots', 'glimmer_cape', 'magic_wand', 'wind_waker', null],
    ['radiance', 'manta', 'power_treads', 'diffusal_blade', null, null],
    ['force_staff', 'tranquil_boots', 'magic_wand', null, null, null],
    ['desolator', 'phase_boots', 'blink', 'black_king_bar', 'crystalys', null],
  ]
  return {
    v: 1,
    kind: 'live',
    d: draftId,
    r: 1,
    t: Date.now(),
    clock: 1435,
    players: Array.from({ length: 10 }, (_, row) => {
      const base = 12_000 + row * 1370
      const dead = row === 6
      return [
        base,
        420 + row * 23,
        520 + row * 17,
        16 + (row % 5),
        4 + (row % 6),
        2 + (row % 4),
        7 + (row % 9),
        120 + row * 21,
        6 + (row % 5),
        11_000 + row * 900,
        row % 3 === 0 ? 2400 : 300,
        row % 4 === 0 ? 3800 : 0,
        9000 + row * 600,
        // alive | scepter | shard | buyback-held — the last no longer implies dead
        (dead ? 0 : 1) |
          (row % 3 === 0 ? 2 : 0) |
          (row % 4 === 0 ? 4 : 0) |
          (row % 5 !== 2 && row !== 8 ? 8 : 0),
        dead ? 42 : 0,
        1200 + row * 90,
        row === 8 ? 214 : 0, // one player on buyback cooldown
        [...ITEMS[row % 5], null, null, null, row % 2 === 0 ? 'pirate_hat' : null, 'tpscroll'],
      ] as TwitchLiveState['players'][number]
    }),
  }
}

export function buildDemoFixture(phase: TwitchPhase = 'drafting'): DemoFixture {
  const board = buildDemoState()
  const initialPayload = payloadFromBoard(board)
  const draftId = twitchDraftId(DRAFT_TS)
  const pickEvents = demoPickEvents(board)
  const poolNames = board.heroes.flatMap((row) => [
    ...row.standard.map((s) => s.name),
    row.ultimate?.name ?? null,
  ]).filter((n): n is string => n !== null)
  const heroNames = initialPayload.heroModels.map((m) => m.heroName)

  const rich = buildTwitchRichState({
    board,
    initialPayload,
    pickEvents,
    draftId,
    richRev: 1,
    ts: DRAFT_TS,
    thresholds: { op: 0.13, trap: 0.05 },
    meta: { appVersion: 'demo', language: 'en' },
    lookups: {
      getAbilityDetails: () => new Map(),
      getHeroes: () => [],
      getPairSynergies: () => synthPairs(poolNames),
      getHeroPairSynergies: () =>
        heroNames.slice(0, 6).map((heroName, i) => ({
          heroName,
          abilityName: poolNames[(i * 9 + 3) % poolNames.length],
          synergyWinrate: 0.56 + i / 100,
          synergyIncrease: 0.06 + i / 100,
        })),
    },
  })

  const compact = buildTwitchCompactState({
    board,
    pickEvents,
    phase,
    draftId,
    rev: 3,
    richRev: 1,
    ts: Date.now(),
    matchId: '7654321012',
    myRow: 0,
  })
  const forPhase = phase === 'ingame' || phase === 'ended' ? completeDraft(compact) : compact
  return { compact: forPhase, rich, live: buildDemoLive(draftId) }
}
