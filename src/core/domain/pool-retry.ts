import type { ScanResult } from '@shared/types'

// @DEV-GUIDE: The ability pool is scanned exactly ONCE (the initial scan), so a
// slot that reads Unknown there stays Unknown for the whole draft — and because
// pick-slot matching is scoped to the recognised pool, that missing name also
// makes its PICK box unmatchable when someone drafts it (measured 2026-08-19:
// 3 of 528 pool slots missed, and each one that got drafted produced an
// unresolvable pick). Pool slots are static until picked, so the fix is simply
// to re-read the Unknown ones on later scans and merge whatever resolves.
// This module is the pure merge step; the worker re-classifies, scan-trigger
// drives it.

export interface PoolCache {
  ultimates: ScanResult[]
  standard: ScanResult[]
}

export interface PoolRetryMerge {
  cache: PoolCache
  /** Ability names newly resolved by this merge (for logging / candidates). */
  resolved: string[]
}

/** Slots identified by board position — coordinates are unique per slot. */
function slotKey(slot: { coord: { x: number; y: number } }): string {
  return `${slot.coord.x},${slot.coord.y}`
}

/**
 * Fills Unknown (name === null) pool entries with freshly recognised results.
 * Never overwrites an already-known entry: a slot that emptied because the
 * ability got drafted must keep the name it had, not a re-read of the hole.
 */
export function mergeRetriedPoolSlots(
  cache: PoolCache,
  retried: readonly ScanResult[],
): PoolRetryMerge {
  const byKey = new Map<string, ScanResult>()
  for (const r of retried) {
    if (r.name !== null) byKey.set(slotKey(r), r)
  }
  if (byKey.size === 0) return { cache, resolved: [] }

  const resolved: string[] = []
  const fill = (slots: ScanResult[]): ScanResult[] =>
    slots.map((slot) => {
      if (slot.name !== null) return slot
      const hit = byKey.get(slotKey(slot))
      if (!hit) return slot
      resolved.push(hit.name as string)
      return { ...slot, name: hit.name, confidence: hit.confidence }
    })

  return {
    cache: { ultimates: fill(cache.ultimates), standard: fill(cache.standard) },
    resolved,
  }
}

/** Pool entries still unresolved — the slots worth re-reading next scan. */
export function unresolvedPoolSlots(cache: PoolCache): ScanResult[] {
  return [...cache.ultimates, ...cache.standard].filter((s) => s.name === null)
}
