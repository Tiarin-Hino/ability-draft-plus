// @DEV-GUIDE: Own draft-row derivation for PLAYING sessions.
// Problem: while playing, GSI reports the local player's team_name + team_slot
// (and player_slot), but NEITHER matches the draft screen's visual row order —
// verified empirically 2026-08-25 across live games (radiant game: visual row 3,
// team_slot 2, player_slot 3; dire game: visual row 5, team_slot 3, player_slot 8).
// Only the TEAM half (team_name) is trustworthy. This mirrors the spectate/replay
// finding that motivated slot-row-correlation.ts.
// Mechanism: the GSI hero block reports the local player's hero model from the
// moment they DRAFT it, and the same moment their player card renders the hero's
// name — which the OCR service reads into ocrHeroNamesByRow (names are always
// English; candidates are pool-scoped). Models are unique per player, so matching
// the GSI npc name against the OCR'd card names pins the local player's row.
// The team half, when known, acts as a veto against OCR misreads.
// (A green-highlight border detector was tried for pre-model-draft instant
// detection and REMOVED 2026-08-26: live data showed every ally card carries a
// green border, the own card is not reliably the brightest, and screen-state
// artifacts could pass any margin gate — it committed a wrong row in testing.
// Candidate replacement if instant detection is ever needed: the top pick-order
// strip marks the local player's turns with bright green outlines from second 0.)

/**
 * Npc-short-name -> DB-name aliases where the difference survives underscore
 * normalization. Full-DB audit 2026-08-26 (127 heroes): Zeus is the ONLY one.
 */
const NPC_DB_ALIASES: Readonly<Record<string, string>> = {
  zuus: 'zeus',
}

/**
 * Canonical comparison token for a hero name from ANY source — GSI npc short
 * name ("drow_ranger", "zuus"), DB hero name ("drowranger", "monkey_king" —
 * the DB is inconsistent about underscores), or model-reference name.
 * Lowercase, underscores stripped, npc aliases applied.
 */
export function heroNameToken(name: string): string {
  const normalized = name.toLowerCase().replace(/_/g, '')
  return NPC_DB_ALIASES[normalized] ?? normalized
}

export interface OwnRowResolutionInput {
  /** OCR results per player row 0-9 (DraftStore.ocrHeroNamesByRow). */
  ocrHeroNamesByRow: Record<number, { name: string }>
  /** GSI hero block npc short name, e.g. "drow_ranger". */
  localHeroNpcName: string
  /**
   * First row of the local player's team half (0 = radiant, 5 = dire), from
   * GSI team_name; null when unknown. Used only as a sanity veto.
   */
  teamHalfStart: 0 | 5 | null
}

/**
 * Resolve the local player's visual draft row from the OCR'd card names.
 * Returns null (caller retries on a later scan/snapshot) when the model has
 * not been OCR'd yet, the match is ambiguous, or it contradicts the team half.
 */
export function resolveOwnRowFromOcr(input: OwnRowResolutionInput): number | null {
  const token = heroNameToken(input.localHeroNpcName)

  const matches: number[] = []
  for (const [rowKey, ocr] of Object.entries(input.ocrHeroNamesByRow)) {
    if (heroNameToken(ocr.name) === token) matches.push(Number(rowKey))
  }
  // Models are unique per player; two matching rows means an OCR misread —
  // refuse rather than guess (the misread row never re-OCRs, but the pool
  // scoping makes duplicates rare in the first place).
  if (matches.length !== 1) return null

  const row = matches[0]
  if (row < 0 || row > 9) return null
  if (
    input.teamHalfStart !== null &&
    (row < input.teamHalfStart || row >= input.teamHalfStart + 5)
  ) {
    return null
  }
  return row
}
