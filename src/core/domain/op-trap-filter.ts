import type {
  AbilitySynergyPair,
  HeroAbilitySynergyRow,
} from '@core/database/repositories/synergy-repository'
import type { SynergyPairDisplay, HeroSynergyDisplay } from '@shared/types'

// @DEV-GUIDE: Filters synergy combinations for the OP/Trap panels in the overlay.
// OP: ability pairs where synergy winrate exceeds OP threshold (default 13%).
// Trap: pairs where synergy winrate falls below trap threshold (default 5%).
// Same-hero pairs are excluded (abilities from same hero can't realistically be drafted together).
// Hero synergies/traps are filtered to heroes actually present in the current pool.

/**
 * Filter OP ability-ability combinations to those relevant to the current draft:
 * include if both in pool, OR one in pool + one picked.
 */
export function filterRelevantOPCombinations(
  allOPCombs: AbilitySynergyPair[],
  poolNames: Set<string>,
  pickedNames: Set<string>,
): SynergyPairDisplay[] {
  return filterAbilityPairs(allOPCombs, poolNames, pickedNames)
}

/**
 * Filter trap ability-ability combinations to those relevant to the current draft.
 * Same relevance logic as OP combinations.
 */
export function filterRelevantTrapCombinations(
  allTrapCombs: AbilitySynergyPair[],
  poolNames: Set<string>,
  pickedNames: Set<string>,
): SynergyPairDisplay[] {
  return filterAbilityPairs(allTrapCombs, poolNames, pickedNames)
}

function filterAbilityPairs(
  pairs: AbilitySynergyPair[],
  poolNames: Set<string>,
  pickedNames: Set<string>,
): SynergyPairDisplay[] {
  return pairs
    .filter((combo) => {
      const a1InPool = poolNames.has(combo.ability1InternalName)
      const a2InPool = poolNames.has(combo.ability2InternalName)
      const a1Picked = pickedNames.has(combo.ability1InternalName)
      const a2Picked = pickedNames.has(combo.ability2InternalName)
      return (
        (a1InPool && a2InPool) ||
        (a1InPool && a2Picked) ||
        (a1Picked && a2InPool)
      )
    })
    .map((combo) => ({
      ability1DisplayName: combo.ability1DisplayName,
      ability2DisplayName: combo.ability2DisplayName,
      synergyWinrate: combo.synergyWinrate,
    }))
}

/**
 * Filter hero-ability OP synergies: ability must be in pool or picked, hero must be
 * in pool, and synergyWinrate - 0.5 must be >= threshold.
 */
export function filterRelevantHeroSynergies(
  allHeroSynergies: HeroAbilitySynergyRow[],
  poolNames: Set<string>,
  pickedNames: Set<string>,
  heroesInPool: Set<string>,
  threshold: number,
): HeroSynergyDisplay[] {
  return allHeroSynergies
    .filter((synergy) => {
      const abilityRelevant =
        poolNames.has(synergy.abilityInternalName) ||
        pickedNames.has(synergy.abilityInternalName)
      const heroRelevant = heroesInPool.has(synergy.heroInternalName)
      const isOP = synergy.synergyWinrate - 0.5 >= threshold
      return abilityRelevant && heroRelevant && isOP
    })
    .map(toHeroSynergyDisplay)
}

/**
 * Filter hero-ability trap synergies: ability must be in pool or picked,
 * hero must be in pool.
 */
export function filterRelevantHeroTraps(
  allHeroTrapSynergies: HeroAbilitySynergyRow[],
  poolNames: Set<string>,
  pickedNames: Set<string>,
  heroesInPool: Set<string>,
): HeroSynergyDisplay[] {
  return allHeroTrapSynergies
    .filter((synergy) => {
      const abilityRelevant =
        poolNames.has(synergy.abilityInternalName) ||
        pickedNames.has(synergy.abilityInternalName)
      const heroRelevant = heroesInPool.has(synergy.heroInternalName)
      return abilityRelevant && heroRelevant
    })
    .map(toHeroSynergyDisplay)
}

function toHeroSynergyDisplay(row: HeroAbilitySynergyRow): HeroSynergyDisplay {
  return {
    heroDisplayName: row.heroDisplayName,
    abilityDisplayName: row.abilityDisplayName,
    synergyWinrate: row.synergyWinrate,
  }
}
