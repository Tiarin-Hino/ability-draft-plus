import type { IconTemplate } from './template-matcher'
import { computePixelStats } from './template-matcher'
import {
  MODEL_TILE_MATCH_MIN_NCC,
  MODEL_TILE_MATCH_MIN_MARGIN,
  PICK_TEMPLATE_EMPTY_STD,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Identifies the 12 draft-board hero MODEL tiles by NCC against a
// reference library of previously captured tiles (gathered by the
// ad_data_gather_script "models" mode — multiple sets per hero across board
// positions, since the board renders tiles with position-dependent skew).
// A hero can therefore have MANY templates; scoring is name-aware: the margin
// is best-hero vs best OTHER hero, never two variants of the same hero.
// This runs alongside (not instead of) the W-slot classifier identification —
// scan-processing logs both and prefers this one only where it is confident
// and the classifier row is Unknown; the diagnostic harness compares them.
// Pure TypeScript on raw RGB vectors — no Electron/sharp imports.

export interface ModelTileMatch {
  /** Hero internal name, or null when no acceptable match. */
  name: string | null
  /** Best NCC score for the winning hero (0 when the tile read as blank). */
  score: number
  /** Best hero even when rejected — diagnostic. */
  bestName: string | null
  /** Best OTHER hero — the margin's counterparty. */
  secondName: string | null
  /** bestHeroScore - secondHeroScore; null when only one hero has templates. */
  margin: number | null
}

function nccScore(
  vec: Uint8Array,
  stats: { mean: number; std: number },
  t: IconTemplate,
): number {
  let dot = 0
  for (let i = 0; i < vec.length; i++) {
    dot += (vec[i] - stats.mean) * (t.vec[i] - t.mean)
  }
  return dot / (vec.length * stats.std * t.std)
}

// Cost note: the full library (~3000 templates x 6912 elements) costs ~70ms
// per tile / ~0.8s per 12-tile scan in JS (measured 2026-08-19) — acceptable
// within the 10s scan budget. A strided-subsample prefilter was tried and
// REJECTED: it halved accuracy on real tiles (fixed sub-grid loses too much
// portrait detail). If this ever needs to be faster, downsample templates
// AND probes to a smaller compare size instead of subsampling.

/** Identifies one model tile (raw RGB, compare size) against the reference set. */
export function matchModelTile(
  vec: Uint8Array,
  templates: readonly IconTemplate[],
): ModelTileMatch {
  const stats = computePixelStats(vec)
  if (stats.std < PICK_TEMPLATE_EMPTY_STD) {
    return { name: null, score: 0, bestName: null, secondName: null, margin: null }
  }

  // Best score per hero name across that hero's template variants
  const byName = new Map<string, number>()
  for (const t of templates) {
    if (t.std === 0 || t.vec.length !== vec.length) continue
    const s = nccScore(vec, stats, t)
    const prev = byName.get(t.name)
    if (prev === undefined || s > prev) byName.set(t.name, s)
  }

  let best = -Infinity
  let bestName: string | null = null
  let second = -Infinity
  let secondName: string | null = null
  for (const [name, s] of byName) {
    if (s > best) {
      second = best
      secondName = bestName
      best = s
      bestName = name
    } else if (s > second) {
      second = s
      secondName = name
    }
  }

  if (bestName === null) {
    return { name: null, score: 0, bestName: null, secondName: null, margin: null }
  }

  const accepted =
    best >= MODEL_TILE_MATCH_MIN_NCC &&
    best - second >= MODEL_TILE_MATCH_MIN_MARGIN
  return {
    name: accepted ? bestName : null,
    score: best,
    bestName,
    secondName,
    margin: Number.isFinite(second) ? best - second : null,
  }
}
