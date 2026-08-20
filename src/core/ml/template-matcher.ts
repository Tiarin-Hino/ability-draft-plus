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
// matching. Candidate scoping: a pick must come from the scanned draft pool,
// and pick boxes are typed — so callers pass the pool names for the slot's box
// type (36 standard / 12 ultimates), shrinking 500+ icons to a handful of
// candidates (bigger winner margins, zero cross-type confusions); scoping that
// would empty the template set falls back to all templates, mirroring the
// classifier's class-mask fallback.
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
  /** Top-scoring candidate even when rejected; null for empty slots. */
  bestName: string | null
  /** Runner-up candidate — identifies the confusable on margin failures. */
  secondName: string | null
  /** Winner's NCC lead over the runner-up; null when there is no runner-up. */
  margin: number | null
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

export interface TemplateScores {
  best: number
  bestName: string | null
  second: number
  secondName: string | null
}

/**
 * Nearest-neighbor NCC scoring of one crop against a template set — the shared
 * core of pick-slot AND model-tile identification. Templates with zero
 * variance or a mismatched vector length are skipped. Acceptance policy
 * (thresholds, margins, empty detection) belongs to the callers.
 */
export function scoreTemplates(
  vec: Uint8Array,
  stats: PixelStats,
  templates: readonly IconTemplate[],
): TemplateScores {
  let best = -Infinity
  let bestName: string | null = null
  let second = -Infinity
  let secondName: string | null = null
  for (const t of templates) {
    if (t.std === 0 || t.vec.length !== vec.length) continue
    const score = ncc(vec, stats, t.vec, t)
    if (score > best) {
      second = best
      secondName = bestName
      best = score
      bestName = t.name
    } else if (score > second) {
      second = score
      secondName = t.name
    }
  }
  return { best, bestName, second, secondName }
}

/**
 * Scoped pick-slot match with an unrestricted fallback: try the caller's
 * candidate set first (wide margins), and if that is rejected, retry against
 * EVERY template and accept only a very high-confidence winner. Recovers picks
 * whose ability never made it into the candidate set — normally because the
 * initial pool scan failed to read it (see PICK_TEMPLATE_FALLBACK_MIN_NCC).
 */
export function matchPickSlotScoped(
  vec: Uint8Array,
  templates: readonly IconTemplate[],
  candidateNames: ReadonlySet<string> | undefined,
  fallbackMinNcc: number,
): PickMatchResult {
  const scoped = matchPickSlot(vec, templates, candidateNames)
  if (scoped.name !== null || scoped.isEmpty) return scoped
  if (candidateNames === undefined || candidateNames.size === 0) return scoped

  const wide = matchPickSlot(vec, templates)
  if (wide.name !== null && wide.score >= fallbackMinNcc) return wide
  return scoped
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
    return {
      name: null,
      score: 0,
      isEmpty: true,
      bestName: null,
      secondName: null,
      margin: null,
    }
  }

  let scoped = templates
  if (candidateNames && candidateNames.size > 0) {
    const filtered = templates.filter((t) => candidateNames.has(t.name))
    if (filtered.length > 0) scoped = filtered
  }

  const { best, bestName, second, secondName } = scoreTemplates(
    vec,
    stats,
    scoped,
  )

  if (bestName === null) {
    return {
      name: null,
      score: 0,
      isEmpty: false,
      bestName: null,
      secondName: null,
      margin: null,
    }
  }

  // A single-template scope has no runner-up; -Infinity second passes margin
  const accepted =
    best >= PICK_TEMPLATE_MIN_NCC && best - second >= PICK_TEMPLATE_MIN_MARGIN
  return {
    name: accepted ? bestName : null,
    score: best,
    isEmpty: false,
    bestName,
    secondName,
    margin: Number.isFinite(second) ? best - second : null,
  }
}
