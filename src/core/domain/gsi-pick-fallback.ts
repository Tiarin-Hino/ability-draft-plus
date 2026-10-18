import type { AbilityDetail, EnrichedScanSlot, OverlayDataPayload } from '@shared/types'

// @DEV-GUIDE: Spectate-only recovery of drafted abilities from GSI, for when the
// scan pipeline tracked NO picks for the current draft (2026-10-17 cast: Dota
// re-entered hero selection, the session ran one initial scan and no turn
// rescans, so the stream board and Twitch extension showed empty picks all game).
//
// GSI's spectator `abilities` block lists every player's hero abilities in game.
// Only names present in the DB ability table are kept — that is Windrun's
// draftable list, so it drops model innates (hoodwink_mistwoods_wayfarer) and
// sub-abilities (spectre_reality). The DB's isUltimate decides the box.
//
// Picks are keyed by DRAFT ROW through `slotToRow`. The caller passes the learned
// slot->row mapping when it covers every slot, otherwise identity — and then uses
// the same identity mapping for names/models/seats, so the board is consistent
// with itself (only the draft-screen row order is unknown, and that screen is gone).
//
// The ability bar is LIVE (casts swap abilities in and out), the draft is not:
// reads are merged add-only per match (mergeLatchedPicks) — a shown pick is never
// replaced or removed.
//
// The fallback never mixes with scan picks: it is used only while the scan has
// zero named picks. A synthetic payload stands in when there was no initial scan
// at all (app restarted mid-game — the draft session is memory-only).

/** Max standard boxes per player in Ability Draft (plus one ultimate box). */
const STANDARD_BOXES = 3

export function hasScannedPicks(payload: OverlayDataPayload | null): boolean {
  return (payload?.scanData?.selectedAbilities ?? []).some(
    (s) => s.name !== null && s.isUnknown !== true,
  )
}

function toPickSlot(detail: AbilityDetail, row: number, abilityOrder: number): EnrichedScanSlot {
  return {
    name: detail.name,
    confidence: 1,
    hero_order: row,
    ability_order: abilityOrder,
    is_ultimate: detail.isUltimate,
    coord: { x: 0, y: 0, width: 0, height: 0, hero_order: row },
    displayName: detail.displayName,
    winrate: detail.winrate,
    pickRate: detail.pickRate,
    consolidatedScore: 0,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: detail.isUltimate,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
  }
}

/**
 * Build selected-ability slots (hero_order = draft row) from GSI ability lists.
 * `abilitiesBySlot[slot]` is that GSI slot's ability names in slot order.
 */
export function buildGsiFallbackPicks(
  abilitiesBySlot: ReadonlyArray<readonly string[] | null | undefined>,
  details: ReadonlyMap<string, AbilityDetail>,
  slotToRow: (slot: number) => number | null,
): EnrichedScanSlot[] {
  const slots: EnrichedScanSlot[] = []
  abilitiesBySlot.forEach((names, slot) => {
    if (!names) return
    const row = slotToRow(slot)
    if (row === null || row < 0 || row > 9) return
    const seen = new Set<string>()
    let standard = 0
    let ultimate = false
    for (const name of names) {
      const detail = details.get(name)
      if (!detail || seen.has(name)) continue
      seen.add(name)
      if (detail.isUltimate) {
        if (ultimate) continue
        ultimate = true
        slots.push(toPickSlot(detail, row, 0))
      } else if (standard < STANDARD_BOXES) {
        standard += 1
        slots.push(toPickSlot(detail, row, standard))
      }
    }
  })
  return slots
}

/**
 * Merge a fresh GSI read into the picks already shown for this match. The draft
 * is over, so what a player drafted never changes — but GSI reports the hero's
 * CURRENT ability bar, and casts swap entries in and out (2026-10-17 cast: a
 * swapped-in sub-ability is not DB-known, so its box went empty; three boxes of
 * one player vanished at once). So picks are ADD-ONLY: every latched pick keeps
 * its box, and a fresh name only fills a box that is still empty (a hero read
 * before its bar was complete). Once a row holds 3 standard + 1 ultimate it is
 * frozen.
 */
export function mergeLatchedPicks(
  latched: readonly EnrichedScanSlot[],
  fresh: readonly EnrichedScanSlot[],
): EnrichedScanSlot[] {
  const merged = [...latched]
  for (const slot of fresh) {
    const row = merged.filter((s) => s.hero_order === slot.hero_order)
    if (row.some((s) => s.name === slot.name)) continue
    if (slot.is_ultimate) {
      if (row.some((s) => s.is_ultimate)) continue
      merged.push({ ...slot, ability_order: 0 })
    } else {
      const standard = row.filter((s) => !s.is_ultimate).length
      if (standard >= STANDARD_BOXES) continue
      merged.push({ ...slot, ability_order: standard + 1 })
    }
  }
  return merged
}

/** Payload with an empty pool, standing in when no initial scan exists. */
export function emptyFallbackPayload(): OverlayDataPayload {
  return {
    initialSetup: true,
    scanData: { ultimates: [], standard: [], selectedAbilities: [] },
    targetResolution: '',
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels: [],
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedSpotHeroOrder: null,
    selectedModelHeroOrder: null,
    heroesCoords: [],
    heroesParams: { width: 0, height: 0 },
    modelsCoords: [],
    autoDraftTrackingEnabled: true,
  }
}

/** Copy of `payload` whose selected abilities are replaced by `picks`. */
export function withFallbackPicks(
  payload: OverlayDataPayload,
  picks: EnrichedScanSlot[],
): OverlayDataPayload {
  const scanData = payload.scanData ?? { ultimates: [], standard: [], selectedAbilities: [] }
  return { ...payload, scanData: { ...scanData, selectedAbilities: picks } }
}
