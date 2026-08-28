import {
  ROLE_GREED_WEIGHT,
  ROLE_SHIFT_ACCENT_WEIGHT,
  ROLE_TEAM_BALANCE_WEIGHT,
  ROLE_ADJUSTMENT_CAP,
  ROLE_ENABLING_ACCENT_FLOOR,
  DYNAMIC_ROLE_MIN_TEAMMATES,
  DYNAMIC_ROLE_MIN_PICKS,
} from '@shared/constants/thresholds'
import type { ScanResult, AppSettings, RoleContextDisplay } from '@shared/types'
import type { ShiftAxes } from './shift-axes'

// @DEV-GUIDE: Role-aware scoring layer (Position Templates spec). Two modes on
// one engine: the scoring side only ever sees an EFFECTIVE POSITION SET.
// - fixed: the user's multi-selected positions; teammates still get approximate
//   estimates (display + team-balance only, never changing the user's roles).
// - dynamic: teammates' build trajectories (mean greed of their picks) are
//   rank-matched onto the five positions; the UNMATCHED (vacant) positions
//   become the effective set. An evidence gate keeps scoring neutral until
//   >= DYNAMIC_ROLE_MIN_TEAMMATES teammates have >= DYNAMIC_ROLE_MIN_PICKS
//   picks — the inference only ever narrows as the draft progresses.
// Rank-matching = minimal-cost ORDER-PRESERVING assignment of builds (sorted by
// greed desc) onto positions (targets are already greed-desc) — optimal for a
// 1-D metric, no Hungarian machinery needed.
// With roleMode 'off' (or My Spot unknown) resolveRoleContext returns null and
// every scoring output is bit-identical to the role-less path.

export type DraftPosition = 1 | 2 | 3 | 4 | 5

interface PositionTemplate {
  /** Greed-axis anchor in [-1, +1] (pool percentile space, shift-axes.ts). */
  greedTarget: number
  /** Secondary shift accent: which axis this position values beyond greed. */
  accent: 'killtaking' | 'playmaking' | 'enabling' | null
}

// Business constants (Position Templates spec §03) — do not change casually.
// Adjacent positions overlap on purpose; that is truthful to Ability Draft.
export const POSITION_TEMPLATES: Readonly<Record<DraftPosition, PositionTemplate>> = {
  1: { greedTarget: 0.7, accent: null },
  2: { greedTarget: 0.4, accent: 'killtaking' },
  3: { greedTarget: 0.1, accent: null },
  4: { greedTarget: -0.35, accent: 'playmaking' },
  5: { greedTarget: -0.6, accent: 'enabling' },
}

const ALL_POSITIONS: readonly DraftPosition[] = [1, 2, 3, 4, 5]
const PLAYER_COUNT = 10
const TEAM_SIZE = PLAYER_COUNT / 2
const PICKS_PER_PLAYER = 4

export interface TeammateBuild {
  heroOrder: number
  /** Named picks scanned so far (0-4). */
  pickCount: number
  /** Mean greed of the named picks with shift data; null with no usable picks. */
  buildGreed: number | null
}

/** Resolved role state for one scan — consumed by the scoring path and the UI. */
export interface RoleContext {
  mode: 'fixed' | 'dynamic'
  /** Positions to score candidates against. Empty = neutral scoring (gate closed). */
  effectivePositions: DraftPosition[]
  /** Mean buildGreed across teammates with picks; null before any teammate picks. */
  teamGreed: number | null
  teammates: TeammateBuild[]
  /** heroOrder -> estimated position for teammates confidently assigned. */
  estimatedPositions: Map<number, DraftPosition>
  /** Dynamic only: whether the evidence gate is open. */
  dynamicGateOpen?: boolean
}

export interface RoleScore {
  /** Score adjustment (already capped) to ADD to the consolidated score. */
  delta: number
  /** The effective position that produced the best fit. */
  bestPosition: DraftPosition
}

/** Same-team hero orders: rows 0-4 are one team, 5-9 the other (stream-board). */
function teammateHeroOrders(myHeroOrder: number): number[] {
  const base = myHeroOrder < TEAM_SIZE ? 0 : TEAM_SIZE
  const orders: number[] = []
  for (let i = base; i < base + TEAM_SIZE; i++) {
    if (i !== myHeroOrder) orders.push(i)
  }
  return orders
}

/** Mean greed of the named picks a player row holds (null when none have data). */
function buildGreedOf(
  picks: ScanResult[],
  axesByName: ReadonlyMap<string, ShiftAxes>,
): number | null {
  let sum = 0
  let n = 0
  for (const p of picks) {
    if (!p.name) continue
    const axes = axesByName.get(p.name)
    if (!axes) continue
    sum += axes.greed
    n += 1
  }
  return n > 0 ? sum / n : null
}

export function summarizeTeammateBuilds(
  selectedAbilities: ScanResult[],
  myHeroOrder: number,
  axesByName: ReadonlyMap<string, ShiftAxes>,
): TeammateBuild[] {
  const byOrder = new Map<number, ScanResult[]>()
  for (const slot of selectedAbilities) {
    if (!byOrder.has(slot.hero_order)) byOrder.set(slot.hero_order, [])
    byOrder.get(slot.hero_order)!.push(slot)
  }
  return teammateHeroOrders(myHeroOrder).map((heroOrder) => {
    const picks = byOrder.get(heroOrder) ?? []
    return {
      heroOrder,
      pickCount: picks.filter((p) => p.name !== null).length,
      buildGreed: buildGreedOf(picks, axesByName),
    }
  })
}

/**
 * Minimal-cost order-preserving assignment of builds onto candidate positions.
 * Builds MUST be sorted by greed desc and positions by greedTarget desc; the
 * DP picks which |builds| of the positions to use. Returns build-index ->
 * position. Optimal for a 1-D metric (matching never benefits from crossing).
 */
function rankMatch(
  greeds: number[],
  positions: readonly DraftPosition[],
): DraftPosition[] {
  const n = greeds.length
  const m = positions.length
  // cost[i][j]: first i builds matched within first j positions
  const INF = Number.POSITIVE_INFINITY
  const cost: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(INF))
  for (let j = 0; j <= m; j++) cost[0][j] = 0
  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      const matched =
        cost[i - 1][j - 1] +
        Math.abs(greeds[i - 1] - POSITION_TEMPLATES[positions[j - 1]].greedTarget)
      cost[i][j] = Math.min(cost[i][j - 1], matched)
    }
  }
  // Backtrack
  const assignment: DraftPosition[] = new Array<DraftPosition>(n)
  let j = m
  for (let i = n; i >= 1; i--) {
    while (cost[i][j] === cost[i][j - 1] && j > i) j--
    assignment[i - 1] = positions[j - 1]
    j--
  }
  return assignment
}

/**
 * Assign confident teammate builds to positions. `candidates` are the positions
 * available to teammates (all five, minus any position reserved for the user).
 */
function estimateTeammatePositions(
  builds: TeammateBuild[],
  candidates: readonly DraftPosition[],
  minPicks: number,
): Map<number, DraftPosition> {
  const confident = builds
    .filter((b) => b.pickCount >= minPicks && b.buildGreed !== null)
    .sort((a, b) => b.buildGreed! - a.buildGreed!)
    .slice(0, candidates.length)
  const estimates = new Map<number, DraftPosition>()
  if (confident.length === 0) return estimates
  const assigned = rankMatch(
    confident.map((b) => b.buildGreed!),
    candidates,
  )
  confident.forEach((b, i) => estimates.set(b.heroOrder, assigned[i]))
  return estimates
}

function meanTeamGreed(builds: TeammateBuild[]): number | null {
  const withGreed = builds.filter((b) => b.buildGreed !== null)
  if (withGreed.length === 0) return null
  return withGreed.reduce((s, b) => s + b.buildGreed!, 0) / withGreed.length
}

/**
 * Fixed mode: which of the user's selected positions to reserve (excluded from
 * teammate candidates). Single selection reserves itself; a multi-selection
 * reserves the one closest to the user's own build greed, or nothing before the
 * user has picks (teammates then compete over all five — an approximation, and
 * these estimates are display/balance hints only).
 */
function reservedPosition(
  fixedPositions: DraftPosition[],
  myBuildGreed: number | null,
): DraftPosition | null {
  if (fixedPositions.length === 1) return fixedPositions[0]
  if (fixedPositions.length === 0 || myBuildGreed === null) return null
  let best: DraftPosition = fixedPositions[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const pos of fixedPositions) {
    const dist = Math.abs(myBuildGreed - POSITION_TEMPLATES[pos].greedTarget)
    if (dist < bestDist) {
      bestDist = dist
      best = pos
    }
  }
  return best
}

/**
 * Resolve the role context for one scan. Returns null when the role layer must
 * be a complete no-op: mode off, My Spot unknown, or fixed mode with nothing
 * selected. Callers treat null as "score exactly as before".
 */
export function resolveRoleContext(
  settings: Pick<AppSettings, 'roleMode' | 'roleFixedPositions'>,
  selectedAbilities: ScanResult[],
  myHeroOrder: number | null,
  axesByName: ReadonlyMap<string, ShiftAxes>,
): RoleContext | null {
  if (settings.roleMode !== 'fixed' && settings.roleMode !== 'dynamic') return null
  if (myHeroOrder === null) return null

  const fixedPositions = (settings.roleFixedPositions ?? []).filter(
    (p): p is DraftPosition => Number.isInteger(p) && p >= 1 && p <= 5,
  )
  if (settings.roleMode === 'fixed' && fixedPositions.length === 0) return null

  const teammates = summarizeTeammateBuilds(selectedAbilities, myHeroOrder, axesByName)
  const teamGreed = meanTeamGreed(teammates)

  if (settings.roleMode === 'fixed') {
    const myPicks = selectedAbilities.filter((s) => s.hero_order === myHeroOrder)
    const reserved = reservedPosition(fixedPositions, buildGreedOf(myPicks, axesByName))
    const candidates = ALL_POSITIONS.filter((p) => p !== reserved)
    return {
      mode: 'fixed',
      effectivePositions: fixedPositions,
      teamGreed,
      teammates,
      estimatedPositions: estimateTeammatePositions(teammates, candidates, 1),
    }
  }

  // Dynamic: vacancy = positions not taken by confident teammate trajectories
  const confidentCount = teammates.filter(
    (b) => b.pickCount >= DYNAMIC_ROLE_MIN_PICKS && b.buildGreed !== null,
  ).length
  const gateOpen = confidentCount >= DYNAMIC_ROLE_MIN_TEAMMATES
  const estimated = estimateTeammatePositions(
    teammates,
    ALL_POSITIONS,
    DYNAMIC_ROLE_MIN_PICKS,
  )
  const taken = new Set(estimated.values())
  return {
    mode: 'dynamic',
    effectivePositions: gateOpen ? ALL_POSITIONS.filter((p) => !taken.has(p)) : [],
    teamGreed,
    teammates,
    estimatedPositions: estimated,
    dynamicGateOpen: gateOpen,
  }
}

/**
 * Role adjustment for one candidate ability. Returns null when the context is
 * null or its effective set is empty (dynamic gate closed) — no delta, no badge.
 * `axes` may be undefined (ability without shift data): it scores as neutral
 * (greed 0), which shifts all such abilities equally and reorders nothing
 * among them.
 */
export function computeRoleScore(
  axes: ShiftAxes | undefined,
  context: RoleContext | null,
): RoleScore | null {
  if (context === null || context.effectivePositions.length === 0) return null

  const greed = axes?.greed ?? 0
  let best = Number.NEGATIVE_INFINITY
  let bestPosition: DraftPosition = context.effectivePositions[0]
  for (const pos of context.effectivePositions) {
    const template = POSITION_TEMPLATES[pos]
    const fit = 1 - Math.abs(greed - template.greedTarget)
    let accentValue = 0
    if (template.accent !== null && axes !== undefined) {
      const raw = axes[template.accent]
      // Healing is zero-inflated: only the top band of the enabling axis counts
      accentValue =
        template.accent === 'enabling'
          ? raw >= ROLE_ENABLING_ACCENT_FLOOR
            ? raw
            : 0
          : raw
    }
    const score = ROLE_GREED_WEIGHT * fit + ROLE_SHIFT_ACCENT_WEIGHT * accentValue
    if (score > best) {
      best = score
      bestPosition = pos
    }
  }

  // Team balance: a farm-heavy team devalues greedy candidates and vice versa
  const teamAdjustment =
    context.teamGreed !== null
      ? -ROLE_TEAM_BALANCE_WEIGHT * context.teamGreed * greed
      : 0

  const delta = Math.max(
    -ROLE_ADJUSTMENT_CAP,
    Math.min(ROLE_ADJUSTMENT_CAP, best + teamAdjustment),
  )
  return { delta, bestPosition }
}

/** Shape the context for the overlay payload (Maps don't survive IPC). */
export function toRoleContextDisplay(context: RoleContext): RoleContextDisplay {
  return {
    mode: context.mode,
    effectivePositions: [...context.effectivePositions],
    teamGreed: context.teamGreed,
    teammates: context.teammates.map((b) => ({
      heroOrder: b.heroOrder,
      estimatedPosition: context.estimatedPositions.get(b.heroOrder) ?? null,
      confidence: b.pickCount / PICKS_PER_PLAYER,
    })),
    dynamicGateOpen: context.dynamicGateOpen,
  }
}
