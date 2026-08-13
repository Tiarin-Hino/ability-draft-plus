import type { ScanResult } from '@shared/types'
import type { PickEvent } from '@shared/types/stream'

// @DEV-GUIDE: Attributes picks by ROW DIFF: the selected-abilities scan reads each
// player's own picked-ability slots (hero_order = player index 0-9), so a name that
// appears in row X's slots and wasn't there before IS a pick by player X — no turn
// clock guessing involved. Pure and recomputable. The turn clock (draft-clock.ts)
// now only decides WHEN to scan and WHICH rows to scan, never who picked what.
//
// Notes:
// - Model picks produce no new ability in any row → no event (models are observed
//   directly via GSI hero blocks, not attributed here).
// - A slot correcting an earlier misread (name A → name B) emits a spurious event
//   for B; accepted — same limitation as the pool subtraction it feeds.

export interface RowDiffAttributionInput {
  /** Selected-abilities baseline BEFORE the accepted scan (previous cache). */
  prevSelected: ScanResult[]
  /** Merged selected-abilities state AFTER the accepted scan. */
  nextSelected: ScanResult[]
  /** Sequence number for the first emitted event. */
  nextSeq: number
  clockTime: number | null
}

/** Per-row name sets: hero_order -> Set of picked ability names. */
function namesByRow(slots: ScanResult[]): Map<number, Set<string>> {
  const rows = new Map<number, Set<string>>()
  for (const slot of slots) {
    if (slot.name === null) continue
    let set = rows.get(slot.hero_order)
    if (!set) {
      set = new Set()
      rows.set(slot.hero_order, set)
    }
    set.add(slot.name)
  }
  return rows
}

export function attributePicksByRow(
  input: RowDiffAttributionInput,
): PickEvent[] {
  const prevRows = namesByRow(input.prevSelected)
  const events: PickEvent[] = []
  let seq = input.nextSeq

  // Iterate nextSelected in slot order so event order is deterministic
  const emitted = new Set<string>()
  for (const slot of input.nextSelected) {
    if (slot.name === null) continue
    const rowKey = `${slot.hero_order}:${slot.name}`
    if (emitted.has(rowKey)) continue
    if (prevRows.get(slot.hero_order)?.has(slot.name)) continue
    emitted.add(rowKey)
    events.push({
      seq,
      playerIndex: slot.hero_order,
      abilityName: slot.name,
      kind: 'ability',
      clockTime: input.clockTime,
    })
    seq++
  }

  return events
}
