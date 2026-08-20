// @DEV-GUIDE: Pure fuzzy matching of OCR'd hero-name text against the known
// hero roster. Draft-board hero names are ALWAYS rendered in English regardless
// of the client's system language (verified 2026-08-14), in spaced capitals
// ("W I N T E R  W Y V E R N"), so recognition reduces to: normalize to A-Z,
// then Levenshtein against a closed set of ~126 display names. The closed set
// makes this robust to poor per-character OCR accuracy — a read only has to be
// closer to the true name than to every other name. "NO HERO" (the pre-pick
// card text) deliberately matches nothing.

export interface HeroNameCandidate {
  /** Internal name, e.g. "winter_wyvern" — returned to the caller on match. */
  name: string
  /** Display name as rendered on the board, e.g. "Winter Wyvern". */
  displayName: string
}

export interface HeroNameMatch {
  name: string
  displayName: string
  /** Levenshtein distance between the normalized read and the matched name. */
  distance: number
  /** 1 - distance/len(matched): 1.0 = exact, values near 0 = barely related. */
  similarity: number
}

/** Uppercases and strips everything but A-Z (spacing, punctuation, digits). */
export function normalizeHeroText(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

/**
 * Max acceptable distance scales with name length: short names ("ZEUS", "AXE")
 * tolerate 1 error, long ones up to ~1/3 of their letters. Measured OCR reads
 * of the draft font are far better than this bound — it exists to reject
 * garbage (player names, "NO HERO", partial reads) rather than to rescue them.
 */
function maxDistanceFor(len: number): number {
  return Math.max(1, Math.floor(len / 3))
}

/**
 * Matches raw OCR text to the closest known hero. Returns null when nothing is
 * acceptably close OR when the best and second-best are equally close (an
 * ambiguous read must not guess).
 */
export function matchHeroName(
  raw: string,
  candidates: readonly HeroNameCandidate[],
): HeroNameMatch | null {
  const text = normalizeHeroText(raw)
  if (text.length < 3) return null

  let best: { c: HeroNameCandidate; norm: string; d: number } | null = null
  let secondDistance = Infinity
  for (const c of candidates) {
    const norm = normalizeHeroText(c.displayName)
    if (norm.length === 0) continue
    const d = levenshtein(text, norm)
    if (best === null || d < best.d) {
      secondDistance = best?.d ?? Infinity
      best = { c, norm, d }
    } else if (d < secondDistance) {
      secondDistance = d
    }
  }
  if (best === null) return null
  if (best.d > maxDistanceFor(best.norm.length)) return null
  if (best.d === secondDistance) return null

  return {
    name: best.c.name,
    displayName: best.c.displayName,
    distance: best.d,
    similarity: 1 - best.d / Math.max(best.norm.length, 1),
  }
}
