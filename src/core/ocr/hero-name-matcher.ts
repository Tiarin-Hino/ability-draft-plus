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

/** Glyphs thin enough (a single vertical stroke) for tesseract to drop. */
const THIN_GLYPHS = /[IL]/g

/**
 * Last resort for a name too thin to OCR whole: a two-letter hero name read
 * with its hairline letters dropped. Io ("IO") is the only such hero, and its
 * "I" is a single stroke tesseract drops — every pass of a live Io card read
 * "O" (2026-09-17). Evidence: across 550 strips cut from 55 finished diagnostic
 * boards and 96 live strips, a lone "O" appeared as the strip's FIRST text line
 * only on real Io cards, on a "NO HERO" card (the caller stops on those before
 * reaching here) and on a post-draft screen that holds no card at all. Ten
 * other heroes produced a lone "O" somewhere in the strip — never on the first
 * line, which is why this only ever looks at the hero-name line.
 *
 * Only the THIN letters may be missing: a lone "I" is NOT Io. The 2026-09-18
 * overnight sweep read a stray "I" off a post-draft screen as Io when any
 * fragment of the name was accepted.
 *
 * Similarity reports how much of the name was actually read, so any real read
 * of another hero outranks it.
 */
export function matchThinTwoLetterHero(
  raw: string,
  candidates: readonly HeroNameCandidate[],
): HeroNameMatch | null {
  const text = normalizeHeroText(raw)
  if (text.length === 0 || text.length > 2) return null
  const matches = candidates.filter((c) => {
    const norm = normalizeHeroText(c.displayName)
    if (norm.length !== 2 || norm === text) return false
    // What is left of the name once its hairline glyphs are dropped
    return norm.replace(THIN_GLYPHS, '') === text
  })
  if (matches.length !== 1) return null
  return {
    name: matches[0].name,
    displayName: matches[0].displayName,
    distance: 2 - text.length,
    similarity: text.length / 2,
  }
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
  if (text.length < 2) return null
  if (text.length === 2) {
    // Fuzzy matching a two-letter read is meaningless (one error is half the
    // word), so short reads used to be rejected outright — which made Io, the
    // only two-letter hero ("IO"), permanently unreadable: its model pick was
    // lost on a live lobby draft (2026-09-16). Accept a two-letter read only as
    // an EXACT match of a two-letter name; every other fragment still fails.
    const exact = candidates.filter((c) => normalizeHeroText(c.displayName) === text)
    if (exact.length !== 1) return null
    return { name: exact[0].name, displayName: exact[0].displayName, distance: 0, similarity: 1 }
  }

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
