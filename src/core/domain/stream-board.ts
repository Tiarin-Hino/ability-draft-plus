import type {
  EnrichedScanSlot,
  OverlayDataPayload,
  SynergyPairDisplay,
} from '@shared/types'
import type {
  PickEvent,
  StreamAbilitySlot,
  StreamBoardState,
  StreamComboDisplay,
  StreamGsiInfo,
  StreamHeroRow,
  StreamPanels,
  StreamPlayerModel,
  StreamPlayerRow,
} from '@shared/types/stream'
import {
  STREAM_TOP_WINRATE_COUNT,
  STREAM_MAX_COMBO_PANEL_ENTRIES,
  STREAM_PICK_FEED_LENGTH,
} from '@shared/constants/thresholds'
import { abilityIconPath, heroIconPath } from '../stream/icon-urls'
import { deriveHeroCdnName } from '../stream/hero-cdn-names'
import {
  calculatePlayerDraftScore,
  type PairSynergyInput,
} from './player-draft-score'

// @DEV-GUIDE: Pure assembly of the streamer-view board state from overlay payloads.
// Two payloads on purpose:
// - initialPayload: the payload of the draft's INITIAL scan — its pool arrays hold the
//   full 48-tile grid. On rescans the scan-processor SUBTRACTS picked abilities from the
//   pool arrays, so only the initial payload can render a stable grid with grey-out.
// - latestPayload: the most recent payload — supplies picked abilities (selectedAbilities,
//   player-indexed 0-9), and pool-filtered OP/trap panels.
// hero_order is overloaded upstream: 0-11 = pool hero rows in ultimates/standard/heroModels,
// 0-9 = PLAYER index in selectedAbilities. This module is the only place both readings meet;
// keep them separate.
// The caller (stream-server-service) provides getPairSynergies so player scores can use
// DB synergy rows without this module importing repositories.

export const POOL_HERO_COUNT = 12
export const PLAYER_COUNT = 10

export interface StreamBoardBuildInput {
  /** Payload from the draft's initial scan; null until a draft has been scanned. */
  initialPayload: OverlayDataPayload | null
  /** Most recent payload (equals initialPayload until the first rescan). */
  latestPayload: OverlayDataPayload | null
  gsi: StreamGsiInfo | null
  meta: { language: string; appVersion: string; updatedAt: number }
  /** Synergy rows among the given ability names (SynergyRepository.getSynergiesAmong). */
  getPairSynergies?: (names: string[]) => PairSynergyInput[]
  /** Attributed pick timeline (experimental auto-rescan); last STREAM_PICK_FEED_LENGTH kept. */
  pickEvents?: PickEvent[]
  /** Model -> player attribution from turn timing (playing mode; GSI covers spectate). */
  modelAssignments?: Array<{ poolHeroOrder: number; playerIndex: number }>
}

const EMPTY_GSI: StreamGsiInfo = {
  connected: false,
  gamePhase: null,
  clockTime: null,
  playerNames: [],
  playerModels: [],
}

function toStreamSlot(
  slot: EnrichedScanSlot,
  pickedNames: ReadonlySet<string>,
): StreamAbilitySlot {
  return {
    name: slot.name,
    displayName: slot.displayName,
    iconPath: slot.name ? abilityIconPath(slot.name) : null,
    winrate: slot.winrate,
    pickPosition: slot.pickRate,
    consolidatedScore: slot.consolidatedScore,
    isTopTier: slot.isGeneralTopTier,
    isUnknown: slot.isUnknown === true,
    isPicked: slot.name !== null && pickedNames.has(slot.name),
  }
}

function buildHeroRows(
  initialPayload: OverlayDataPayload,
  latestPayload: OverlayDataPayload | null,
  pickedNames: ReadonlySet<string>,
): StreamHeroRow[] {
  const scanData = initialPayload.scanData
  const ultimates = scanData?.ultimates ?? []
  const standard = scanData?.standard ?? []

  const rows: StreamHeroRow[] = []
  for (let heroOrder = 0; heroOrder < POOL_HERO_COUNT; heroOrder++) {
    const rowStandard = standard
      .filter((s) => s.hero_order === heroOrder)
      .sort((a, b) => a.ability_order - b.ability_order)
    const rowUltimate = ultimates.find((s) => s.hero_order === heroOrder) ?? null

    const model = initialPayload.heroModels.find(
      (m) => m.heroOrder === heroOrder,
    )
    const heroDisplayName =
      model && model.dbHeroId !== null ? model.heroDisplayName : null

    // Picked-model state updates on RESCANS (tile-diff detection), so it must
    // come from the latest payload, not the frozen initial one
    const latestModel = latestPayload?.heroModels.find(
      (m) => m.heroOrder === heroOrder,
    )

    const cdnName = deriveHeroCdnName([
      ...rowStandard.map((s) => s.name),
      rowUltimate?.name ?? null,
    ])

    rows.push({
      heroOrder,
      heroDisplayName,
      portraitPath: cdnName ? heroIconPath(cdnName) : null,
      standard: rowStandard.map((s) => toStreamSlot(s, pickedNames)),
      ultimate: rowUltimate ? toStreamSlot(rowUltimate, pickedNames) : null,
      modelPicked: latestModel?.isPicked ?? model?.isPicked ?? false,
    })
  }
  return rows
}

function buildPlayerRows(
  latestPayload: OverlayDataPayload | null,
  gsi: StreamGsiInfo,
  getPairSynergies: (names: string[]) => PairSynergyInput[],
  heroRows: StreamHeroRow[],
  initialPayload: OverlayDataPayload,
  modelAssignments: Array<{ poolHeroOrder: number; playerIndex: number }>,
): StreamPlayerRow[] {
  const selected = latestPayload?.scanData?.selectedAbilities ?? []

  // Scan-attributed model per player (playing mode fallback — GSI wins below)
  const assignedByPlayer = new Map<number, StreamPlayerModel>()
  for (const assignment of modelAssignments) {
    const heroRow = heroRows.find((h) => h.heroOrder === assignment.poolHeroOrder)
    const model = initialPayload.heroModels.find(
      (m) => m.heroOrder === assignment.poolHeroOrder,
    )
    if (!heroRow || !model || model.dbHeroId === null) continue
    // Portrait: the row's ability-prefix derivation when available; otherwise a
    // display-name slug ("Crystal Maiden" -> crystal_maiden), which matches the
    // CDN for most heroes — the DB's concatenated name ("crystalmaiden") never does
    const displaySlug = model.heroDisplayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    assignedByPlayer.set(assignment.playerIndex, {
      npcName: model.heroName,
      displayName: model.heroDisplayName,
      portraitPath: heroRow.portraitPath ?? heroIconPath(displaySlug),
    })
  }

  const rows: StreamPlayerRow[] = []
  for (let playerIndex = 0; playerIndex < PLAYER_COUNT; playerIndex++) {
    const pickSlots = selected
      .filter(
        (s) =>
          s.hero_order === playerIndex && s.name !== null && s.isUnknown !== true,
      )
      .sort((a, b) => a.ability_order - b.ability_order)

    // Picked-slot tiles are never "picked from the pool" themselves; render them plainly.
    const picks = pickSlots.map((s) => toStreamSlot(s, new Set()))

    const pickNames = pickSlots.map((s) => s.name as string)
    const draftScore =
      picks.length > 0
        ? calculatePlayerDraftScore(
            pickSlots.map((s) => ({
              name: s.name as string,
              winrate: s.winrate,
            })),
            getPairSynergies(pickNames),
          )
        : null

    const gsiModel = gsi.playerModels[playerIndex] ?? null

    rows.push({
      playerIndex,
      team: playerIndex < PLAYER_COUNT / 2 ? 'radiant' : 'dire',
      playerName: gsi.playerNames[playerIndex] ?? null,
      model: gsiModel
        ? { ...gsiModel, portraitPath: heroIconPath(gsiModel.npcName) }
        : (assignedByPlayer.get(playerIndex) ?? null),
      picks,
      draftScore,
    })
  }
  return rows
}

function toComboDisplay(pair: SynergyPairDisplay): StreamComboDisplay {
  return {
    ability1: {
      name: pair.ability1Name ?? null,
      displayName: pair.ability1DisplayName,
      iconPath: pair.ability1Name ? abilityIconPath(pair.ability1Name) : null,
    },
    ability2: {
      name: pair.ability2Name ?? null,
      displayName: pair.ability2DisplayName,
      iconPath: pair.ability2Name ? abilityIconPath(pair.ability2Name) : null,
    },
    synergyWinrate: pair.synergyWinrate,
  }
}

function buildPanels(
  latestPayload: OverlayDataPayload | null,
  pickedNames: ReadonlySet<string>,
): StreamPanels {
  const scanData = latestPayload?.scanData
  const poolSlots = [...(scanData?.ultimates ?? []), ...(scanData?.standard ?? [])]

  // Latest payload's pool arrays already exclude picked abilities (scan-processor
  // subtracts them on rescan), so these panels are naturally "still available".
  const knownSlots = poolSlots.filter(
    (s) => s.name !== null && s.isUnknown !== true,
  )

  const topWinrateInPool = [...knownSlots]
    .filter((s) => s.winrate !== null)
    .sort((a, b) => (b.winrate as number) - (a.winrate as number))
    .slice(0, STREAM_TOP_WINRATE_COUNT)
    .map((s) => toStreamSlot(s, pickedNames))

  const topTier = knownSlots
    .filter((s) => s.isGeneralTopTier)
    .sort((a, b) => b.consolidatedScore - a.consolidatedScore)
    .map((s) => toStreamSlot(s, pickedNames))

  const opCombos = [...(latestPayload?.opCombinations ?? [])]
    .sort((a, b) => b.synergyWinrate - a.synergyWinrate)
    .slice(0, STREAM_MAX_COMBO_PANEL_ENTRIES)
    .map(toComboDisplay)

  const trapCombos = [...(latestPayload?.trapCombinations ?? [])]
    .sort((a, b) => a.synergyWinrate - b.synergyWinrate)
    .slice(0, STREAM_MAX_COMBO_PANEL_ENTRIES)
    .map(toComboDisplay)

  return { topWinrateInPool, opCombos, trapCombos, topTier }
}

/**
 * Assemble the full stream board snapshot. Pure and deterministic — safe to call on
 * every scan/GSI update.
 */
export function buildStreamBoardState(
  input: StreamBoardBuildInput,
): StreamBoardState {
  const gsi = input.gsi ?? EMPTY_GSI
  const initialPayload = input.initialPayload
  const latestPayload = input.latestPayload ?? initialPayload
  const getPairSynergies = input.getPairSynergies ?? (() => [])

  if (!initialPayload || !initialPayload.scanData) {
    return {
      phase: 'waiting',
      heroes: [],
      players: [],
      panels: { topWinrateInPool: [], opCombos: [], trapCombos: [], topTier: [] },
      gsi,
      meta: input.meta,
    }
  }

  const pickedNames = new Set<string>()
  for (const slot of latestPayload?.scanData?.selectedAbilities ?? []) {
    if (slot.name && slot.isUnknown !== true) pickedNames.add(slot.name)
  }

  const heroes = buildHeroRows(initialPayload, latestPayload, pickedNames)

  return {
    phase: 'drafting',
    heroes,
    players: buildPlayerRows(
      latestPayload,
      gsi,
      getPairSynergies,
      heroes,
      initialPayload,
      input.modelAssignments ?? [],
    ),
    panels: buildPanels(latestPayload, pickedNames),
    gsi,
    ...(input.pickEvents && input.pickEvents.length > 0
      ? { pickFeed: input.pickEvents.slice(-STREAM_PICK_FEED_LENGTH) }
      : {}),
    meta: input.meta,
  }
}
