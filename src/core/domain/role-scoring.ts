import {
  ROLE_GREED_WEIGHT,
  ROLE_GREED_TAPER,
  ROLE_SHIFT_ACCENT_WEIGHT,
  ROLE_TEAM_BALANCE_WEIGHT,
  ROLE_ADJUSTMENT_CAP,
  ROLE_ENABLING_ACCENT_FLOOR,
  ROLE_NEED_WEIGHT,
  ROLE_DUPLICATE_WEIGHT,
  ROLE_TAG_ACCENT_WEIGHT,
  ROLE_MODEL_WEIGHT_SCALE,
  MODEL_ATTR_FIT_WEIGHT,
  DYNAMIC_ROLE_MIN_TEAMMATES,
  DYNAMIC_ROLE_MIN_PICKS,
} from '@shared/constants/thresholds'
import type { ScanResult, AppSettings, RoleContextDisplay } from '@shared/types'
import type { ShiftAxes } from './shift-axes'
import type { AbilityTag } from './ability-tags'

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
// TAGS LAYER (ability-tags.ts dataset): the build-needs engine evaluates each
// position's needs checklist against the USER'S OWN drafted abilities — a
// candidate covering an unmet capability is boosted (reason chip 'covers:X'),
// one that only duplicates a twice-covered capability is damped ('duplicate:X').
// Small static per-position tag accents ride along. All of it is a no-op when
// no tag input is supplied (dataset absent).
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

/** A role need: satisfied by any requirement; a requirement is an AND of tags. */
export interface RoleNeed {
  /** i18n suffix for reason chips (overlay: tooltip.roleNeeds.<key>). */
  key: string
  anyOf: AbilityTag[][]
  /** Multiplier on ROLE_NEED_WEIGHT — what DEFINES the role and cannot be
   * bought from the shop ranks highest; what items patch ranks lowest. */
  priority: number
}

// Business constants (Position Templates matrix §03) — the needs checklists the
// dynamic engine evaluates against the user's own drafted abilities, ordered by
// hardness-to-itemize (user-tuned 2026-08-29).
export const POSITION_NEEDS: Readonly<Record<DraftPosition, RoleNeed[]>> = {
  // Survival raised from 0.5 (sim finding: experts pay real opportunity cost
  // for durability — Kraken Shell-class picks deep-ranked by us 4x — so
  // survivability is less itemizable-away than the original theory assumed).
  1: [
    { key: 'steroid', anyOf: [['steroid']], priority: 1.0 },
    { key: 'farm', anyOf: [['farm_tool'], ['waveclear']], priority: 0.75 },
    { key: 'survival', anyOf: [['mobility'], ['sustain_self']], priority: 0.7 },
  ],
  2: [
    { key: 'nuke', anyOf: [['nuke']], priority: 1.0 },
    { key: 'kill_ult', anyOf: [['teamfight_ult'], ['hard_cc']], priority: 0.75 },
    { key: 'mobility', anyOf: [['mobility']], priority: 0.5 },
  ],
  // Pos-3 priorities softened (corpus: ~half of real rank-3 players finish
  // without AoE-CC or initiation — the checklist is aspirational, not law).
  3: [
    { key: 'aoe_cc', anyOf: [['hard_cc', 'aoe']], priority: 0.75 },
    { key: 'initiation', anyOf: [['initiation']], priority: 0.6 },
    { key: 'durability', anyOf: [['sustain_self'], ['passive_value']], priority: 0.4 },
  ],
  4: [
    { key: 'hard_cc', anyOf: [['hard_cc']], priority: 1.0 },
    { key: 'waveclear', anyOf: [['waveclear'], ['nuke']], priority: 0.75 },
    { key: 'mobility', anyOf: [['mobility']], priority: 0.5 },
  ],
  // Pos-5 reordered per corpus: waveclear|nuke coverage is near-universal
  // (~90%) among expert supports while a save appears in only ~36-40% of
  // their builds — saves are a luxury, wave-pushing is close to mandatory.
  5: [
    { key: 'hard_cc', anyOf: [['hard_cc']], priority: 1.0 },
    { key: 'waveclear', anyOf: [['waveclear'], ['nuke']], priority: 0.75 },
    { key: 'save', anyOf: [['save_ally']], priority: 0.5 },
  ],
}

/** Every distinct need key (for pool-supply/scarcity computation). */
export function allRoleNeeds(): RoleNeed[] {
  const seen = new Set<string>()
  const needs: RoleNeed[] = []
  for (const pos of ALL_POSITIONS) {
    for (const need of POSITION_NEEDS[pos]) {
      if (!seen.has(need.key)) {
        seen.add(need.key)
        needs.push(need)
      }
    }
  }
  return needs
}

/** Static per-position tag accents (±ROLE_TAG_ACCENT_WEIGHT each). */
// sustain_self added to the core rows per the sim's durable-passives finding
const POSITION_TAG_ACCENTS: Readonly<
  Record<DraftPosition, { plus: AbilityTag[]; minus: AbilityTag[] }>
> = {
  1: { plus: ['passive_value', 'sustain_self'], minus: ['save_ally'] },
  2: { plus: ['waveclear', 'sustain_self'], minus: ['passive_value'] },
  3: { plus: ['team_aura', 'teamfight_ult'], minus: [] },
  4: { plus: ['setup_cc', 'initiation'], minus: ['steroid', 'farm_tool'] },
  5: { plus: ['team_aura', 'passive_value'], minus: ['steroid', 'farm_tool'] },
}

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
  /** The user's named ability picks so far (spot unknown → board-round estimate).
   * Drives the greed taper and the core model-urgency ramp. */
  myPickCount: number
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
  /** Reason chips for the best position: 'covers:<needKey>' | 'duplicate:<needKey>'. */
  reasons: string[]
}

/** Tag context for the needs engine (absent = tags feature off, no-op). */
export interface RoleTagInput {
  /** Tags of the candidate ability (undefined = untagged: needs/accents skip it). */
  candidateTags: ReadonlySet<AbilityTag> | undefined
  /** Tag sets of the user's own drafted abilities (picks without tags excluded). */
  myPickTags: ReadonlyArray<ReadonlySet<AbilityTag>>
  /** Pool-scarcity multiplier per need key (clamped; absent key = 1). */
  needScarcity?: ReadonlyMap<string, number>
}

function satisfies(tags: ReadonlySet<AbilityTag>, need: RoleNeed): boolean {
  return need.anyOf.some((req) => req.every((tag) => tags.has(tag)))
}

/**
 * Needs engine for one (candidate, position) pair: boost for covering an unmet
 * capability, one damp when the candidate ONLY duplicates a capability the user
 * already covers twice (the third single-target stun). Returns the adjustment
 * and its reason chips.
 */
function needsAdjustment(
  position: DraftPosition,
  tagInput: RoleTagInput,
): { adj: number; reasons: string[] } {
  const candidate = tagInput.candidateTags
  if (candidate === undefined) return { adj: 0, reasons: [] }

  let adj = 0
  const reasons: string[] = []
  let duplicateKey: string | null = null
  for (const need of POSITION_NEEDS[position]) {
    if (!satisfies(candidate, need)) continue
    const covered = tagInput.myPickTags.filter((tags) => satisfies(tags, need)).length
    if (covered === 0) {
      const scarcity = tagInput.needScarcity?.get(need.key) ?? 1
      adj += ROLE_NEED_WEIGHT * need.priority * scarcity
      reasons.push(`covers:${need.key}`)
    } else if (covered >= 2 && duplicateKey === null) {
      duplicateKey = need.key
    }
  }
  if (reasons.length === 0 && duplicateKey !== null) {
    adj -= ROLE_DUPLICATE_WEIGHT
    reasons.push(`duplicate:${duplicateKey}`)
  }
  return { adj, reasons }
}

function tagAccentAdjustment(
  position: DraftPosition,
  candidate: ReadonlySet<AbilityTag> | undefined,
): number {
  if (candidate === undefined) return 0
  const accents = POSITION_TAG_ACCENTS[position]
  let adj = 0
  for (const tag of accents.plus) if (candidate.has(tag)) adj += ROLE_TAG_ACCENT_WEIGHT
  for (const tag of accents.minus) if (candidate.has(tag)) adj -= ROLE_TAG_ACCENT_WEIGHT
  return adj
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
 * be a complete no-op: mode off, fixed mode with nothing selected, or dynamic
 * mode with My Spot unknown. FIXED mode works WITHOUT a spot — the selected
 * positions are the essentials and tailor suggestions from the initial scan
 * on; the spot only unlocks the auxiliary parts (teammate estimates, the
 * team-balance term, and pick-aware needs). Dynamic inherently needs the spot:
 * its whole job is reading MY team's builds. Callers treat null as "score
 * exactly as before".
 */
export function resolveRoleContext(
  settings: Pick<AppSettings, 'roleMode' | 'roleFixedPositions'>,
  selectedAbilities: ScanResult[],
  myHeroOrder: number | null,
  axesByName: ReadonlyMap<string, ShiftAxes>,
): RoleContext | null {
  if (settings.roleMode !== 'fixed' && settings.roleMode !== 'dynamic') return null

  const fixedPositions = (settings.roleFixedPositions ?? []).filter(
    (p): p is DraftPosition => Number.isInteger(p) && p >= 1 && p <= 5,
  )
  if (settings.roleMode === 'fixed' && fixedPositions.length === 0) return null
  if (settings.roleMode === 'dynamic' && myHeroOrder === null) return null

  const teammates =
    myHeroOrder !== null
      ? summarizeTeammateBuilds(selectedAbilities, myHeroOrder, axesByName)
      : []
  const teamGreed = meanTeamGreed(teammates)
  const namedPicks = selectedAbilities.filter((s) => s.name !== null)
  const myPickCount =
    myHeroOrder !== null
      ? namedPicks.filter((s) => s.hero_order === myHeroOrder).length
      : Math.floor(namedPicks.length / PLAYER_COUNT)

  if (settings.roleMode === 'fixed') {
    const myPicks =
      myHeroOrder !== null
        ? selectedAbilities.filter((s) => s.hero_order === myHeroOrder)
        : []
    const reserved = reservedPosition(fixedPositions, buildGreedOf(myPicks, axesByName))
    const candidates = ALL_POSITIONS.filter((p) => p !== reserved)
    return {
      mode: 'fixed',
      effectivePositions: fixedPositions,
      myPickCount,
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
    myPickCount,
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
  tagInput?: RoleTagInput,
): RoleScore | null {
  if (context === null || context.effectivePositions.length === 0) return null

  const greed = axes?.greed ?? 0
  // Greed taper: the pick the user is ABOUT to make is pick #(myPickCount+1) —
  // full greed weight on the first picks, needs/coverage take over late.
  const taper =
    ROLE_GREED_TAPER[
      Math.min(context.myPickCount, ROLE_GREED_TAPER.length - 1)
    ]
  let best = Number.NEGATIVE_INFINITY
  let bestPosition: DraftPosition = context.effectivePositions[0]
  let bestReasons: string[] = []
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
    // Tags layer (needs + static accents) — a no-op without a tag input
    const needs = tagInput
      ? needsAdjustment(pos, tagInput)
      : { adj: 0, reasons: [] as string[] }
    const accentAdj = tagInput
      ? tagAccentAdjustment(pos, tagInput.candidateTags)
      : 0
    const score =
      ROLE_GREED_WEIGHT * taper * fit +
      ROLE_SHIFT_ACCENT_WEIGHT * accentValue +
      needs.adj +
      accentAdj
    if (score > best) {
      best = score
      bestPosition = pos
      bestReasons = needs.reasons
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
  return { delta, bestPosition, reasons: bestReasons }
}

// ---------------------------------------------------------------------------
// Hero-model role scoring (attribute-based fit + shift greed + core urgency)
// ---------------------------------------------------------------------------

/** Stat percentiles of one model among the REMAINING unpicked models, [0,1]. */
export interface ModelStatPercentiles {
  strGain: number
  agiGain: number
  intGain: number
  totalGain: number
  /** Mana-pool proxy: base int + int gain, percentiled. */
  intPool: number
}

/** Primary-attribute credit: exact match 1, universal half, else 0. */
function attrCredit(
  primaryAttr: string | undefined,
  wanted: 'str' | 'agi' | 'int',
): number {
  if (primaryAttr === wanted) return 1
  if (primaryAttr === 'all') return 0.5
  return 0
}

/**
 * Per-position attribute fit in [0,1] (user-defined profiles, 2026-08-29):
 * pos 1 right-click scaling, pos 2 overall stats leaning caster+durability,
 * pos 3 durable STR, pos 4/5 INT/mana + best remaining stat gain.
 */
export function modelAttrFit(
  position: DraftPosition,
  pct: ModelStatPercentiles,
  primaryAttr: string | undefined,
): number {
  switch (position) {
    case 1:
      return 0.6 * pct.agiGain + 0.4 * pct.totalGain
    case 2:
      return 0.5 * pct.totalGain + 0.3 * pct.intGain + 0.2 * pct.strGain
    case 3:
      return 0.6 * pct.strGain + 0.4 * attrCredit(primaryAttr, 'str')
    case 4:
    case 5:
      return (
        0.4 * pct.intPool +
        0.3 * pct.totalGain +
        0.3 * attrCredit(primaryAttr, 'int')
      )
  }
}

/**
 * Role score for a hero MODEL: attribute fit (primary signal) + shift greed
 * fit (small secondary, ROLE_MODEL_WEIGHT_SCALE applied by the caller is
 * folded in here instead) + a flat core-urgency boost. Missing stat data
 * scores fit as neutral (0.5). Returns null when the layer is inactive.
 */
export function computeModelRoleScore(
  context: RoleContext | null,
  axes: ShiftAxes | undefined,
  pct: ModelStatPercentiles | undefined,
  primaryAttr: string | undefined,
  urgency: number,
): RoleScore | null {
  if (context === null || context.effectivePositions.length === 0) return null

  const greed = axes?.greed ?? 0
  let best = Number.NEGATIVE_INFINITY
  let bestPosition: DraftPosition = context.effectivePositions[0]
  for (const pos of context.effectivePositions) {
    const fit = pct !== undefined ? modelAttrFit(pos, pct, primaryAttr) : 0.5
    const greedFit = 1 - Math.abs(greed - POSITION_TEMPLATES[pos].greedTarget)
    const score =
      MODEL_ATTR_FIT_WEIGHT * (2 * fit - 1) +
      ROLE_GREED_WEIGHT * ROLE_MODEL_WEIGHT_SCALE * greedFit
    if (score > best) {
      best = score
      bestPosition = pos
    }
  }

  const delta = Math.max(
    -ROLE_ADJUSTMENT_CAP,
    Math.min(ROLE_ADJUSTMENT_CAP, best + urgency),
  )
  return { delta, bestPosition, reasons: [] }
}

/** True when the effective set makes this a CORE drafter (positions 1-3). */
export function isCoreRoleContext(context: RoleContext): boolean {
  return context.effectivePositions.some((p) => p <= 3)
}

/** Shape the context for the overlay payload (Maps don't survive IPC). */
export function toRoleContextDisplay(context: RoleContext): RoleContextDisplay {
  return {
    mode: context.mode,
    status: 'active',
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
