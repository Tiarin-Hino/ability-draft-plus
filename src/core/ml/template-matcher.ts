import {
  PICK_TEMPLATE_EMPTY_STD,
  PICK_TEMPLATE_MIN_MARGIN,
  PICK_TEMPLATE_MIN_NCC,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Template matching for PICKED-ability slots. Pick boxes render the
// icon flat and unscaled — pixel-identical to the official CDN art already cached
// for the streamer view — so a picked slot is identified by nearest-neighbor
// normalized cross-correlation (NCC) against those icons instead of the ML
// classifier. NCC is invariant to the game's brightness/contrast shifts. The
// classifier stays in charge of the POOL slots (skewed rendering) and serves as
// the pick-slot fallback when no icon templates are available (ml-worker.ts).
// Empty boxes are near-uniform dark pixels, detected by pixel std before
// matching. Candidate scoping: a pick must come from the scanned draft pool, so
// callers pass the pool's ability names to shrink 500+ icons to ~48 candidates
// (bigger winner margins); scoping that would empty the template set falls back
// to all templates, mirroring the classifier's class-mask fallback.
// Pure TypeScript on raw RGB vectors — zero Electron/sharp imports; decoding
// and cropping happen in the ML worker.

/** A candidate icon, preprocessed to the compare size (raw RGB). */
export interface IconTemplate {
  name: string
  vec: Uint8Array
  mean: number
  std: number
}

export interface PixelStats {
  mean: number
  std: number
}

export interface PickMatchResult {
  /** Matched ability name, or null (empty slot / no acceptable match). */
  name: string | null
  /** Best NCC score in [-1, 1]; 0 for empty slots. */
  score: number
  /** True when the slot read as empty (uniform pixels) — matching was skipped. */
  isEmpty: boolean
}

export function computePixelStats(vec: Uint8Array): PixelStats {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i]
  const mean = sum / vec.length
  let varSum = 0
  for (let i = 0; i < vec.length; i++) varSum += (vec[i] - mean) ** 2
  return { mean, std: Math.sqrt(varSum / vec.length) }
}

/** Builds a template from a decoded icon vector (raw RGB at the compare size). */
export function makeIconTemplate(name: string, vec: Uint8Array): IconTemplate {
  const { mean, std } = computePixelStats(vec)
  return { name, vec, mean, std }
}

function ncc(
  a: Uint8Array,
  aStats: PixelStats,
  b: Uint8Array,
  bStats: PixelStats,
): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] - aStats.mean) * (b[i] - bStats.mean)
  }
  return dot / (a.length * aStats.std * bStats.std)
}

/**
 * Identifies one pick-slot crop (raw RGB at the compare size, border already
 * inset away) against the icon templates.
 */
export function matchPickSlot(
  vec: Uint8Array,
  templates: readonly IconTemplate[],
  candidateNames?: ReadonlySet<string>,
): PickMatchResult {
  const stats = computePixelStats(vec)
  if (stats.std < PICK_TEMPLATE_EMPTY_STD) {
    return { name: null, score: 0, isEmpty: true }
  }

  let scoped = templates
  if (candidateNames && candidateNames.size > 0) {
    const filtered = templates.filter((t) => candidateNames.has(t.name))
    if (filtered.length > 0) scoped = filtered
  }

  let best = -Infinity
  let bestName: string | null = null
  let second = -Infinity
  for (const t of scoped) {
    if (t.std === 0 || t.vec.length !== vec.length) continue
    const score = ncc(vec, stats, t.vec, t)
    if (score > best) {
      second = best
      best = score
      bestName = t.name
    } else if (score > second) {
      second = score
    }
  }

  if (bestName === null) return { name: null, score: 0, isEmpty: false }

  // A single-template scope has no runner-up; -Infinity second passes margin
  const accepted =
    best >= PICK_TEMPLATE_MIN_NCC && best - second >= PICK_TEMPLATE_MIN_MARGIN
  return { name: accepted ? bestName : null, score: best, isEmpty: false }
}
