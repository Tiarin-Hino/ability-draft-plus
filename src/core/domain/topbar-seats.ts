// @DEV-GUIDE: In-game top-bar SEAT -> draft ROW mapping for PLAYING mode.
// The top bar is in lobby order, draft rows are in pick order, and a playing
// client's GSI reports only its own hero — so nothing in GSI maps the other
// nine. Seats are identified VISUALLY: each top-bar portrait is matched (NCC,
// core/ml/template-matcher.ts) against the portrait art of the heroes its team
// drafted, then solved as a one-to-one assignment per team.
//
// Why keyed by MODEL, not player: a drafted model keeps its drafted abilities
// through a hero swap (user-verified 2026-09-16: after swapping, the player
// controlled the Kunkka model with the abilities Kunkka's drafter picked), and
// the portrait shows the model. So portrait -> model -> drafting row puts the
// right abilities under every portrait, swaps included. (Player NAMES do move
// with a swap — a spectate-mode concern, see docs/TWITCH_EXTENSION.md TODO.)
//
// Validated offline 2026-09-16 on a 2560x1440 in-game frame: 10/10 with the
// closed per-team candidate set (9/10 against all 126 heroes). The weakest
// correct match (0.49, Slardar) was an in-game portrait drawn from different
// art than Valve's CDN image — cosmetics that change a portrait behave the
// same way, which is why matching is restricted to a team's own 5 models.
//
// FILL POLICY (user decision 2026-09-16, deliberately reversing the earlier
// "an unmapped seat shows nothing"): the released Twitch extension draws
// nothing at all for a seat without a row — no portrait region, no picks — so
// a seat is always filled: confident matches, then the local player's GSI seat,
// then elimination within the team (a forced pick, not a guess), and only then
// remaining rows into remaining seats of the SAME team in order. Never across
// teams.

/** Top-bar portrait geometry at 1920x1080. Mirrors the extension's measured
 * TOPBAR_1080P (twitch/frontend/src/geometry/topbar-1080p.ts) — keep in sync. */
export const TOPBAR_1080P = {
  portraitW: 62,
  portraitH: 35,
  portraitY: 4,
  radiantStartX: 544,
  direStartX: 1062,
  stepX: 63,
} as const

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The ten portrait rects (seat order: 0-4 radiant, 5-9 dire) in a captured
 * game frame. The 16:9 game area is fitted inside the frame (letterboxed or
 * pillarboxed) exactly as the extension projects it, so both agree on any
 * aspect ratio.
 */
export function topbarPortraitRects(frame: { width: number; height: number }): PxRect[] {
  const scale = Math.min(frame.width / 1920, frame.height / 1080)
  const offsetX = (frame.width - 1920 * scale) / 2
  const offsetY = (frame.height - 1080 * scale) / 2
  const g = TOPBAR_1080P
  return Array.from({ length: 10 }, (_, seat) => {
    const startX = seat < 5 ? g.radiantStartX : g.direStartX
    const x = startX + (seat % 5) * g.stepX
    return {
      x: Math.round(offsetX + x * scale),
      y: Math.round(offsetY + g.portraitY * scale),
      w: Math.round(g.portraitW * scale),
      h: Math.round(g.portraitH * scale),
    }
  })
}

export interface SeatMatchThresholds {
  /** Minimum NCC for an assigned portrait to count as identified. */
  minScore: number
  /**
   * Minimum ASSIGNMENT margin: how much the best total drops when this seat's
   * pairing is forbidden. A per-seat "lead over the next candidate" would be
   * wrong here — solving jointly legitimately gives a seat its second choice
   * when another seat needs the first, and that seat is still certain.
   */
  minMargin: number
}

/** Validated live: weakest correct portrait scored 0.54 (Slardar). */
export const DEFAULT_SEAT_THRESHOLDS: SeatMatchThresholds = { minScore: 0.3, minMargin: 0.1 }

/** Best partial one-to-one assignment (seat -> candidate | null) and its total. */
function bestAssignment(
  scores: readonly (readonly number[])[],
  candCount: number,
  forbidden: { seat: number; cand: number } | null,
): { total: number; choice: (number | null)[] } {
  const seatCount = scores.length
  let bestTotal = -Infinity
  let best: (number | null)[] = Array.from({ length: seatCount }, () => null)
  const choice: (number | null)[] = Array.from({ length: seatCount }, () => null)
  const used = new Set<number>()

  const search = (seat: number, total: number, assigned: number): void => {
    if (seat === seatCount) {
      if (total > bestTotal) {
        bestTotal = total
        best = [...choice]
      }
      return
    }
    for (let c = 0; c < candCount; c++) {
      if (used.has(c)) continue
      if (forbidden !== null && forbidden.seat === seat && forbidden.cand === c) continue
      used.add(c)
      choice[seat] = c
      search(seat + 1, total + scores[seat][c], assigned + 1)
      used.delete(c)
    }
    // A seat may stay empty only while seats outnumber candidates, or when the
    // forbidden pairing leaves it nothing else
    const seatsLeft = seatCount - seat
    const candsLeft = candCount - assigned
    if (seatsLeft > candsLeft || forbidden?.seat === seat) {
      choice[seat] = null
      search(seat + 1, total, assigned)
    }
  }
  search(0, 0, 0)
  return { total: bestTotal, choice: best }
}

/**
 * Best one-to-one assignment of one team's seats to its candidates.
 * scores[seat][candidate]; candidateRows[candidate] = the draft row that
 * drafted that model. Seats may stay unassigned when the team has fewer
 * candidates than seats (a model whose art is unavailable). Returns, per seat,
 * the assigned row when it passes the thresholds, else null.
 */
export function assignTeamSeats(
  scores: readonly (readonly number[])[],
  candidateRows: readonly number[],
  thresholds: SeatMatchThresholds = DEFAULT_SEAT_THRESHOLDS,
): (number | null)[] {
  const candCount = candidateRows.length
  const { total, choice } = bestAssignment(scores, candCount, null)
  return choice.map((cand, seat) => {
    if (cand === null) return null
    if (scores[seat][cand] < thresholds.minScore) return null
    const alternative = bestAssignment(scores, candCount, { seat, cand }).total
    return total - alternative >= thresholds.minMargin ? candidateRows[cand] : null
  })
}

/**
 * Accumulate identifications across capture attempts: a seat keeps its
 * confident row until a later attempt confidently reads it differently, and a
 * row sits in one seat only (the newer reading wins). A hero that is dead — and
 * greyed out — in one capture must not erase what an earlier capture proved.
 */
export function mergeIdentifiedSeats(
  previous: readonly (number | null)[],
  next: readonly (number | null)[],
): (number | null)[] {
  const merged = Array.from({ length: 10 }, (_, seat) => previous[seat] ?? null)
  next.forEach((row, seat) => {
    if (row === null) return
    const holder = merged.indexOf(row)
    if (holder !== -1 && holder !== seat) merged[holder] = null
    merged[seat] = row
  })
  return merged
}

export interface CompleteSeatsInput {
  /** Per seat 0-9: confidently identified row, or null. */
  identified: readonly (number | null)[]
  /** The local player's top-bar seat (GSI lobby slot) and draft row, when known. */
  local: { seat: number; row: number } | null
}

export interface CompletedSeats {
  /** Row per seat; -1 only if a team had no row left (not reachable with a full draft). */
  seats: number[]
  /** Seats filled by the in-order fallback — genuinely guessed (logging). */
  guessed: number[]
}

/** Apply the fill policy (see DEV-GUIDE): every seat gets a row of its own team. */
export function completeSeats(input: CompleteSeatsInput): CompletedSeats {
  const seats: (number | null)[] = [...input.identified]
  const guessed: number[] = []

  const rowTaken = (row: number): boolean => seats.includes(row)
  // Local anchor: only where matching was not confident, and only when it
  // cannot contradict a confident match elsewhere
  if (
    input.local !== null &&
    seats[input.local.seat] === null &&
    !rowTaken(input.local.row) &&
    (input.local.seat < 5) === (input.local.row < 5)
  ) {
    seats[input.local.seat] = input.local.row
  }

  for (const [first, last] of [
    [0, 4],
    [5, 9],
  ] as const) {
    const openSeats: number[] = []
    for (let seat = first; seat <= last; seat++) if (seats[seat] === null) openSeats.push(seat)
    const openRows: number[] = []
    for (let row = first; row <= last; row++) if (!rowTaken(row)) openRows.push(row)
    // One open seat is elimination (forced); more are filled in order (guessed)
    openSeats.forEach((seat, i) => {
      const row = openRows[i]
      if (row === undefined) return
      seats[seat] = row
      if (openSeats.length > 1) guessed.push(seat)
    })
  }
  return { seats: seats.map((row) => row ?? -1), guessed }
}
