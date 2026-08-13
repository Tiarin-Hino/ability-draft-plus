import { MODEL_PICK_DIFF_THRESHOLD } from '@shared/constants/thresholds'

// @DEV-GUIDE: Picked-model detection by TILE DIFFING — zero image recognition.
// The 12 model portrait tiles on the AD draft stage are pixel-static while
// unpicked (empirically mean abs diff 0.0 between scans minutes apart) and
// change drastically when picked (measured 35-120). Because each tile position
// was mapped to a pool hero at initial scan (W-slot hero identification), "the
// tile at spot H changed" IS "hero H was picked" — the new tile content never
// needs to be identified.
//
// Guards:
// - A change must PERSIST across two consecutive scans before it commits (a
//   hover tooltip over the stage fakes a change for one capture; it moves away
//   by the next scan and the pending entry clears).
// - Picked never un-picks.
// Detection runs on every rescan regardless of the ability contamination
// guard's verdict — the model arcs are spatially separate from the pick rows,
// and the persistence rule absorbs any capture glitch either way.

/** One normalized model tile: raw RGB bytes at MODEL_TILE_COMPARE_SIZE². */
export interface ModelTileCapture {
  heroOrder: number
  tile: Uint8Array
}

export interface ModelPickDetectionInput {
  /** Tiles captured at initial scan (the unpicked reference state). */
  baselines: ModelTileCapture[]
  /** Tiles captured by the current rescan. */
  current: ModelTileCapture[]
  /** Hero orders that read changed in the PREVIOUS scan, awaiting confirmation. */
  pending: number[]
  /** Hero orders already committed as picked (never revert). */
  picked: number[]
  threshold?: number
}

export interface ModelPickDetectionResult {
  picked: number[]
  pending: number[]
  /** Hero orders committed by THIS scan (subset of picked). */
  newlyPicked: number[]
}

/** Mean absolute per-byte difference; Infinity on length mismatch (treat as changed). */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / a.length
}

export function detectModelPicks(
  input: ModelPickDetectionInput,
): ModelPickDetectionResult {
  const threshold = input.threshold ?? MODEL_PICK_DIFF_THRESHOLD
  const baselineByOrder = new Map(
    input.baselines.map((b) => [b.heroOrder, b.tile]),
  )
  const alreadyPicked = new Set(input.picked)
  const wasPending = new Set(input.pending)

  const changed: number[] = []
  for (const tile of input.current) {
    if (alreadyPicked.has(tile.heroOrder)) continue
    const baseline = baselineByOrder.get(tile.heroOrder)
    if (!baseline) continue
    if (meanAbsDiff(baseline, tile.tile) > threshold) {
      changed.push(tile.heroOrder)
    }
  }

  // Changed twice in a row -> picked; changed once -> pending confirmation.
  // A pending entry whose tile reads unchanged now was a transient (tooltip).
  const newlyPicked = changed.filter((order) => wasPending.has(order))
  const pending = changed.filter((order) => !wasPending.has(order))

  return {
    picked: [...input.picked, ...newlyPicked],
    pending,
    newlyPicked,
  }
}
