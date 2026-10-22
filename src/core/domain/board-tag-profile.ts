import type { ScanResult } from '@shared/types'
import type { AbilityTag, AbilityTagsLookup } from './ability-tags'

// @DEV-GUIDE: Board tag profile (round 5 shared plumbing, docs/proposals/
// community-tags-round5.md). ONE pass per scan over the drafted picks and the
// unpicked pool, producing tag COUNTS per side — mine / my teammates / the
// enemy five / everything drafted / the pool — so every board-aware verdict
// (dispel demand, team-amp demand, deny partners, pool gates) reads counts
// instead of re-walking selectedAbilities. Rows 0-4 are one team and 5-9 the
// other (the same split role-scoring uses); without a known My Spot the
// team/enemy halves stay empty (only `drafted` and `pool` are meaningful).
//
// Conditional tags (`with:` on a dataset entry) are resolved HERE, per owner:
// a pick's conditional tag counts only when the same player has drafted one
// of its dependencies; a POOL ability's conditional tag counts only when the
// USER holds the dependency (the pool is always read from the drafter's point
// of view). Upgrade-granted tags (`viaUpgrade`) count at full value by design.

export interface BoardTagProfile {
  /** Tag counts over the user's own drafted picks (empty without My Spot). */
  mine: ReadonlyMap<AbilityTag, number>
  /** Tag counts over the four teammates' drafted picks (empty without My Spot). */
  team: ReadonlyMap<AbilityTag, number>
  /** Tag counts over the enemy five's drafted picks (empty without My Spot). */
  enemy: ReadonlyMap<AbilityTag, number>
  /** Tag counts over every drafted pick on the board. */
  drafted: ReadonlyMap<AbilityTag, number>
  /** Tag counts over the UNPICKED pool (unique ability names). */
  pool: ReadonlyMap<AbilityTag, number>
}

const PLAYER_COUNT = 10
const TEAM_SIZE = PLAYER_COUNT / 2

type TagSource = Pick<AbilityTagsLookup, 'getTags' | 'getWith'>

/** The tags an ability contributes for a given owner: its tag set minus the
 * conditional tags whose dependency the owner has not drafted. */
export function effectiveTags(
  abilityName: string,
  ownerPickNames: ReadonlySet<string>,
  tags: TagSource,
): ReadonlySet<AbilityTag> | undefined {
  const base = tags.getTags(abilityName)
  if (base === undefined) return undefined
  const cond = tags.getWith?.(abilityName)
  if (cond === undefined || cond.size === 0) return base
  const result = new Set(base)
  for (const [tag, deps] of cond) {
    if (!deps.some((d) => ownerPickNames.has(d))) result.delete(tag)
  }
  return result
}

function bump(map: Map<AbilityTag, number>, tags: ReadonlySet<AbilityTag>): void {
  for (const tag of tags) map.set(tag, (map.get(tag) ?? 0) + 1)
}

export function computeBoardTagProfile(args: {
  selectedAbilities: readonly ScanResult[]
  poolNames: Iterable<string>
  myHeroOrder: number | null
  tags: TagSource
}): BoardTagProfile {
  const { selectedAbilities, poolNames, myHeroOrder, tags } = args
  const mine = new Map<AbilityTag, number>()
  const team = new Map<AbilityTag, number>()
  const enemy = new Map<AbilityTag, number>()
  const drafted = new Map<AbilityTag, number>()
  const pool = new Map<AbilityTag, number>()

  // Named picks per row, so conditional tags resolve against their owner.
  const picksByRow = new Map<number, Set<string>>()
  for (const slot of selectedAbilities) {
    if (!slot.name) continue
    let names = picksByRow.get(slot.hero_order)
    if (names === undefined) {
      names = new Set<string>()
      picksByRow.set(slot.hero_order, names)
    }
    names.add(slot.name)
  }

  const myTeamBase = myHeroOrder === null ? null : myHeroOrder < TEAM_SIZE ? 0 : TEAM_SIZE
  for (const [row, names] of picksByRow) {
    for (const name of names) {
      const eff = effectiveTags(name, names, tags)
      if (eff === undefined) continue
      bump(drafted, eff)
      if (myTeamBase === null) continue
      if (row === myHeroOrder) bump(mine, eff)
      else if (row >= myTeamBase && row < myTeamBase + TEAM_SIZE) bump(team, eff)
      else bump(enemy, eff)
    }
  }

  const myPickNames: ReadonlySet<string> =
    myHeroOrder === null ? new Set<string>() : (picksByRow.get(myHeroOrder) ?? new Set<string>())
  const seen = new Set<string>()
  for (const name of poolNames) {
    if (seen.has(name)) continue
    seen.add(name)
    const eff = effectiveTags(name, myPickNames, tags)
    if (eff !== undefined) bump(pool, eff)
  }

  return { mine, team, enemy, drafted, pool }
}
