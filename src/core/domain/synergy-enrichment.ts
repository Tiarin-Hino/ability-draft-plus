import type { SynergyPairDisplay, HeroSynergyDisplay } from '@shared/types'
import type { SynergyPartner, HeroAbilitySynergyRow } from '@core/database/repositories/synergy-repository'
import type { SynergyLookup } from './types'

// @DEV-GUIDE: Synergy lookup functions for overlay tooltips.
// getAbilitySynergySplit: For one ability, returns high-WR (>=50%) and low-WR (<50%) partner lists
// getHeroSynergiesForAbility: For one ability, returns which heroes in the pool synergize
// getAbilitySynergiesForHero: For one hero model, returns which pool abilities synergize
// All functions filter to only include entities currently in the draft pool.

/**
 * For a single ability, fetch all synergy partners in the pool and split by winrate threshold.
 * High = WR >= 0.5, Low = WR < 0.5.
 */
export function getAbilitySynergySplit(
  abilityName: string,
  draftPoolNames: string[],
  synergyLookup: SynergyLookup,
): { high: SynergyPairDisplay[]; low: SynergyPairDisplay[] } {
  const all = synergyLookup.getHighWinrateCombinations(
    abilityName,
    draftPoolNames,
  )
  return {
    high: all
      .filter((c) => c.synergyWinrate >= 0.5)
      .map((c) => toSynergyPairDisplay(abilityName, c)),
    low: all
      .filter((c) => c.synergyWinrate < 0.5)
      .map((c) => toSynergyPairDisplay(abilityName, c)),
  }
}

function toSynergyPairDisplay(
  baseName: string,
  partner: SynergyPartner,
): SynergyPairDisplay {
  return {
    ability1DisplayName: baseName,
    ability2DisplayName: partner.partnerDisplayName,
    synergyWinrate: partner.synergyWinrate,
  }
}

/**
 * For a single ability, compute hero synergies filtered to heroes in the current pool.
 * Returns top 5 strong (WR >= 0.5, sorted desc) and top 5 weak (WR < 0.5, sorted asc).
 */
export function getHeroSynergiesForAbility(
  abilityInternalName: string,
  allHeroSynergies: HeroAbilitySynergyRow[],
  heroesInPool: Set<string>,
): { strong: HeroSynergyDisplay[]; weak: HeroSynergyDisplay[] } {
  const relevant = allHeroSynergies
    .filter(
      (s) =>
        s.abilityInternalName === abilityInternalName &&
        heroesInPool.has(s.heroInternalName),
    )
    .map((s) => ({
      heroDisplayName: s.heroDisplayName,
      abilityDisplayName: s.abilityDisplayName,
      synergyWinrate: s.synergyWinrate,
    }))

  const strong = relevant
    .filter((s) => s.synergyWinrate >= 0.5)
    .sort((a, b) => b.synergyWinrate - a.synergyWinrate)
    .slice(0, 5)

  const weak = relevant
    .filter((s) => s.synergyWinrate < 0.5)
    .sort((a, b) => a.synergyWinrate - b.synergyWinrate)
    .slice(0, 5)

  return { strong, weak }
}

/**
 * For a hero model, compute ability synergies filtered to abilities in pool or picked.
 * Returns top 5 strong (WR >= 0.5, sorted desc) and top 5 weak (WR < 0.5, sorted asc).
 */
export function getAbilitySynergiesForHero(
  heroInternalName: string,
  allHeroSynergies: HeroAbilitySynergyRow[],
  poolAndPickedAbilityNames: Set<string>,
): { strong: HeroSynergyDisplay[]; weak: HeroSynergyDisplay[] } {
  const relevant = allHeroSynergies
    .filter(
      (s) =>
        s.heroInternalName === heroInternalName &&
        poolAndPickedAbilityNames.has(s.abilityInternalName),
    )
    .map((s) => ({
      heroDisplayName: s.heroDisplayName,
      abilityDisplayName: s.abilityDisplayName,
      synergyWinrate: s.synergyWinrate,
    }))

  const strong = relevant
    .filter((s) => s.synergyWinrate >= 0.5)
    .sort((a, b) => b.synergyWinrate - a.synergyWinrate)
    .slice(0, 5)

  const weak = relevant
    .filter((s) => s.synergyWinrate < 0.5)
    .sort((a, b) => a.synergyWinrate - b.synergyWinrate)
    .slice(0, 5)

  return { strong, weak }
}
