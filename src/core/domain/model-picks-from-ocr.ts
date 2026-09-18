import type { PickEvent } from '@shared/types/stream'
import { heroNameToken } from './own-row-detection'
import { isUnidentifiedModel } from './hero-identification'

// @DEV-GUIDE: Model picks from CARD OCR — the single source of "which player
// drafted which hero model" in playing mode. Replaced model-tile diffing plus
// turn-timing attribution (removed 2026-09-16) after a live lobby draft where,
// against the strategy screen as ground truth:
//   - card OCR read all 10 rows correctly, with zero reads before a pick and
//     zero revisions (the name is on the card within ~1s of the pick);
//   - tile diffing committed a model nobody picked (a flickering tile) and
//     missed the last pick of the draft;
//   - turn-timing attribution put 5 of 10 models on the wrong player first.
// The drafter's card prints the hero's name, so a pool hero read on row R IS
// "row R drafted that model" — no timing, no tile state, no inference.
//
// Rules (pure; the auto-rescan service applies the result to the store):
// - A read counts only when it names one of THIS draft's pool heroes (the OCR
//   roster is already pool-scoped; this is the belt to that brace).
// - The LOCAL player's model is anchored to their known row (GSI knows the
//   local hero exactly and own-row detection knows the row); a card read can
//   never move it — a single misread must not relocate the user's own pick.
// - Two rows claiming one model: the higher-similarity read wins.
// - A read of a hero that is NOT in the identified pool can only be the pool
//   hero the scan failed to identify (the W-slot identification misses one in
//   ~3 drafts). With exactly ONE unidentified pool row that is unambiguous and
//   the read takes it; with more, it is skipped rather than guessed. OCR only
//   hands over such reads at OCR_UNSCOPED_MIN_SIMILARITY, so this never runs on
//   a loose fuzzy match.
// - Timeline: exactly one modelSelectionMarker per row, carrying the model it
//   stands for. A later read that changes a row's model re-labels that row's
//   marker in place instead of appending a second one, so draft history and
//   the Twitch pick order never double-count or keep a stale owner.

/** A picked hero model attributed to the player who drafted it. */
export interface ModelAssignment {
  /** Pool hero row 0-11. */
  poolHeroOrder: number
  /** Player index 0-9 (scan convention). */
  playerIndex: number
}

export interface ResolveModelAssignmentsInput {
  /** The draft's pool heroes (identifiedHeroModelsCache). */
  poolModels: readonly { heroOrder: number; heroName: string | null }[]
  /** Card OCR per player row (ocrHeroNamesByRow). */
  ocrByRow: Readonly<Record<number, { name: string; similarity: number }>>
  /** Local player's hero (GSI npc/short name) and their row, when both are known. */
  local: { heroName: string; row: number } | null
}

/** Current model assignments implied by the card reads, sorted by pool order. */
export function resolveModelAssignments(
  input: ResolveModelAssignmentsInput,
): ModelAssignment[] {
  const orderByToken = new Map<string, number | null>()
  for (const model of input.poolModels) {
    if (model.heroName === null || isUnidentifiedModel(model.heroName)) continue
    const token = heroNameToken(model.heroName)
    // Two pool entries with one token would make every read ambiguous
    orderByToken.set(token, orderByToken.has(token) ? null : model.heroOrder)
  }
  const unidentified = input.poolModels.filter((m) => isUnidentifiedModel(m.heroName))
  const offPoolOrder = unidentified.length === 1 ? unidentified[0].heroOrder : null
  const orderOf = (heroName: string): number | null => {
    const token = heroNameToken(heroName)
    if (orderByToken.has(token)) return orderByToken.get(token) ?? null
    return offPoolOrder
  }

  const localOrder = input.local ? orderOf(input.local.heroName) : null
  const localRow = localOrder !== null ? input.local!.row : null

  const best = new Map<number, { row: number; similarity: number }>()
  for (const [rowKey, read] of Object.entries(input.ocrByRow)) {
    const row = Number(rowKey)
    const order = orderOf(read.name)
    if (order === null) continue
    // The local anchor owns both its model and its row
    if (order === localOrder || row === localRow) continue
    const current = best.get(order)
    if (current === undefined || read.similarity > current.similarity) {
      best.set(order, { row, similarity: read.similarity })
    }
  }
  if (localOrder !== null && localRow !== null) {
    best.set(localOrder, { row: localRow, similarity: Infinity })
  }

  return [...best.entries()]
    .map(([poolHeroOrder, { row }]) => ({ poolHeroOrder, playerIndex: row }))
    .sort((a, b) => a.poolHeroOrder - b.poolHeroOrder)
}

export interface ModelMarkerUpdate {
  /** The timeline with model markers re-labelled, moved or dropped in place. */
  timeline: PickEvent[]
  /** New markers to append (seq not yet assigned — the caller sequences them). */
  added: Omit<PickEvent, 'seq'>[]
  /** Existing markers whose model or owner changed, for the log. */
  corrected: { poolHeroOrder: number; fromRow: number; toRow: number; fromModel?: number }[]
  /** Markers no assignment accounts for any more (a corrected misread). */
  dropped: number
}

/**
 * Make the timeline's model markers mirror the assignments exactly: one marker
 * per drafting row, labelled with its model. A marker keeps its position in the
 * pick order when it is re-labelled (the row's read changed) or moved to the
 * model's new owner (a read moved the model); only genuinely new picks append.
 * Ability events are never touched.
 */
export function reconcileModelMarkers(
  timeline: readonly PickEvent[],
  assignments: readonly ModelAssignment[],
  clockTime: number | null,
  /** Seconds since the pick-phase anchor at capture start (orderByDraftTurns). */
  seenAtS?: number,
): ModelMarkerUpdate {
  const modelByRow = new Map(assignments.map((a) => [a.playerIndex, a.poolHeroOrder]))
  const rowByModel = new Map(assignments.map((a) => [a.poolHeroOrder, a.playerIndex]))

  // Rows whose existing marker stays put (the row still drafted a model)
  const claimedRows = new Set<number>()
  for (const event of timeline) {
    if (event.kind === 'modelSelectionMarker' && modelByRow.has(event.playerIndex)) {
      claimedRows.add(event.playerIndex)
    }
  }

  const corrected: ModelMarkerUpdate['corrected'] = []
  const keptRows = new Set<number>()
  let dropped = 0
  const next: PickEvent[] = []
  for (const event of timeline) {
    if (event.kind !== 'modelSelectionMarker') {
      next.push(event)
      continue
    }
    let row = event.playerIndex
    let model = modelByRow.get(row)
    if (model === undefined && event.poolHeroOrder !== undefined) {
      // The row lost its model: follow the model to its new owner if that row
      // has no marker of its own yet
      const newRow = rowByModel.get(event.poolHeroOrder)
      if (newRow !== undefined && !claimedRows.has(newRow) && !keptRows.has(newRow)) {
        row = newRow
        model = event.poolHeroOrder
      }
    }
    if (model === undefined || keptRows.has(row)) {
      dropped += 1 // unaccounted for, or a duplicate marker for one row
      continue
    }
    keptRows.add(row)
    if (row !== event.playerIndex || model !== event.poolHeroOrder) {
      corrected.push({
        poolHeroOrder: model,
        fromRow: event.playerIndex,
        toRow: row,
        ...(event.poolHeroOrder !== undefined ? { fromModel: event.poolHeroOrder } : {}),
      })
    }
    // A marker moved to another row is that row's pick, first seen NOW; the
    // original read's time belonged to the misread row
    const moved: PickEvent = { ...event, playerIndex: row, poolHeroOrder: model }
    if (row !== event.playerIndex) {
      delete moved.seenAtS
      if (seenAtS !== undefined) moved.seenAtS = seenAtS
    }
    next.push(moved)
  }

  const added: ModelMarkerUpdate['added'] = assignments
    .filter((a) => !keptRows.has(a.playerIndex))
    .map((a) => ({
      playerIndex: a.playerIndex,
      abilityName: null,
      kind: 'modelSelectionMarker' as const,
      poolHeroOrder: a.poolHeroOrder,
      clockTime,
      ...(seenAtS !== undefined ? { seenAtS } : {}),
    }))

  return { timeline: next, added, corrected, dropped }
}
