import type { SlotCoordinate } from '@shared/types'
import type { HeroLookup, IdentifiedHeroModel } from './types'

// @DEV-GUIDE: Identifies which hero each "model slot" in the draft represents.
// In Dota 2 Ability Draft, each player has a random hero. The hero is identified by
// its "hero-defining ability" -- the ability at ability_order === 2 in the draft grid.
// The ML model classifies this ability icon, then this function looks up which hero owns it.

/**
 * Identify heroes from their defining abilities (ability_order === 2).
 * For each hero-defining ability with a non-null name, looks up the hero in the DB.
 * Returns an array of identified hero models matching modelCoords order,
 * with "Unknown Hero" fallback for unidentified slots.
 */
export function identifyHeroModels(
  heroDefiningAbilities: Array<{
    name: string | null
    confidence: number
    hero_order: number
  }>,
  modelCoords: SlotCoordinate[],
  heroLookup: HeroLookup,
): IdentifiedHeroModel[] {
  const identifiedMap = new Map<number, IdentifiedHeroModel>()

  for (const ability of heroDefiningAbilities) {
    if (!ability.name) continue

    const heroIdentity = heroLookup.getByAbilityName(ability.name)
    if (!heroIdentity) continue

    const fullHero = heroLookup.getById(heroIdentity.heroId)
    if (!fullHero) continue

    identifiedMap.set(ability.hero_order, {
      heroOrder: ability.hero_order,
      heroName: fullHero.name,
      heroDisplayName: fullHero.displayName,
      dbHeroId: fullHero.heroId,
      winrate: fullHero.winrate,
      highSkillWinrate: fullHero.highSkillWinrate,
      pickRate: fullHero.pickRate,
      hsPickRate: fullHero.hsPickRate,
      identificationConfidence: ability.confidence,
    })
  }

  return modelCoords.map((coord) => {
    const matched = identifiedMap.get(coord.hero_order)
    if (matched) return matched
    return {
      heroOrder: coord.hero_order,
      heroName: `unknown_model_${coord.hero_order}`,
      heroDisplayName: 'Unknown Hero',
      dbHeroId: null,
      winrate: null,
      highSkillWinrate: null,
      pickRate: null,
      hsPickRate: null,
      identificationConfidence: 0,
    }
  })
}
