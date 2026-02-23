import type {
  WindrunAbilityStat,
  WindrunPair,
  WindrunTriplet,
  WindrunStaticAbility,
  WindrunStaticHero,
  TransformedHero,
  TransformedAbility,
  TransformedAbilitySynergy,
  TransformedHeroAbilitySynergy,
  TransformedAbilityTriplet,
  TransformedHeroAbilityTriplet,
} from './types'

// @DEV-GUIDE: Transforms raw Windrun API responses into DB-ready format.
// Handles ID mapping (Windrun IDs -> internal DB IDs), name normalization,
// synergy pair extraction with synergy_increase calculation, and triplet formatting.
// Key: Windrun shortNames are single concatenated words (e.g., "drowranger" not "drow_ranger").
//
// Three transform functions match the three data categories:
// - transformAbilitiesAndHeroes: Splits stats into hero vs ability entries (negative ID = hero)
// - transformPairs: Splits pairs into ability-ability and hero-ability, calculates synergy_increase
// - transformTriplets: Same split for 3-way combinations (hero+2 abilities or 3 abilities)
// synergy_increase = pair_winrate - average(individual_winrates), measuring "how much better together"

const OP_THRESHOLD = 0.13

/**
 * Internal lookup type: ability valveId → static ability data.
 * Built from the raw array via `buildAbilityLookup()`.
 */
export type AbilityLookup = Map<number, WindrunStaticAbility>

/**
 * Build a valveId → static ability lookup from the raw array.
 * The /static/abilities endpoint returns an array, but we need
 * fast lookup by valveId (which matches abilityId in stats/pairs).
 */
export function buildAbilityLookup(abilities: WindrunStaticAbility[]): AbilityLookup {
  const map = new Map<number, WindrunStaticAbility>()
  for (const ability of abilities) {
    if (ability.valveId > 0) {
      map.set(ability.valveId, ability)
    }
  }
  return map
}

// ── Abilities & Heroes ───────────────────────────────────────────────────────

export function transformAbilitiesAndHeroes(
  overallStats: WindrunAbilityStat[],
  hsStats: WindrunAbilityStat[],
  abilityLookup: AbilityLookup,
  staticHeroes: Record<string, WindrunStaticHero>,
): { heroData: TransformedHero[]; abilityData: TransformedAbility[] } {
  // Build high-skill lookup by abilityId
  const hsMap = new Map<number, WindrunAbilityStat>()
  for (const stat of hsStats) {
    hsMap.set(stat.abilityId, stat)
  }

  const heroData: TransformedHero[] = []
  const abilityData: TransformedAbility[] = []

  for (const stat of overallStats) {
    const hs = hsMap.get(stat.abilityId)

    if (stat.abilityId < 0) {
      // Negative ID = hero entry
      const heroId = Math.abs(stat.abilityId)
      const staticHero = staticHeroes[String(heroId)]
      if (!staticHero) continue

      heroData.push({
        name: staticHero.shortName,
        displayName: staticHero.englishName,
        winrate: stat.winrate,
        highSkillWinrate: hs?.winrate ?? null,
        pickRate: stat.avgPickPosition,
        hsPickRate: hs?.avgPickPosition ?? null,
        windrunId: heroId,
      })
    } else {
      // Positive ID = ability entry (valveId)
      const staticAbility = abilityLookup.get(stat.abilityId)
      if (!staticAbility) continue

      const heroId = staticAbility.ownerHeroId
      const staticHero = heroId ? staticHeroes[String(heroId)] : null

      abilityData.push({
        name: staticAbility.shortName,
        displayName: staticAbility.englishName,
        heroId: heroId || null,
        heroName: staticHero?.shortName ?? null,
        winrate: stat.winrate,
        highSkillWinrate: hs?.winrate ?? null,
        pickRate: stat.avgPickPosition,
        hsPickRate: hs?.avgPickPosition ?? null,
        isUltimate: staticAbility.isUltimate ?? false,
      })
    }
  }

  return { heroData, abilityData }
}

// ── Pairs ────────────────────────────────────────────────────────────────────

export function transformPairs(
  pairs: WindrunPair[],
  abilityWinrates: Map<number, number>,
  abilityLookup: AbilityLookup,
  staticHeroes: Record<string, WindrunStaticHero>,
): {
  abilityPairs: TransformedAbilitySynergy[]
  heroPairs: TransformedHeroAbilitySynergy[]
} {
  const abilityPairs: TransformedAbilitySynergy[] = []
  const heroPairs: TransformedHeroAbilitySynergy[] = []

  for (const pair of pairs) {
    const { abilityIdOne, abilityIdTwo, winrate, numPicks } = pair

    if (abilityIdOne < 0) {
      // Hero-ability pair: negative ID is the hero
      const heroId = Math.abs(abilityIdOne)
      const staticHero = staticHeroes[String(heroId)]
      const staticAbil = abilityLookup.get(abilityIdTwo)
      if (!staticHero || !staticAbil) continue

      const heroWr = abilityWinrates.get(abilityIdOne) ?? 0.5
      const abilWr = abilityWinrates.get(abilityIdTwo) ?? 0.5
      const synergyIncrease = winrate - (heroWr + abilWr) / 2

      heroPairs.push({
        heroName: staticHero.shortName,
        abilityName: staticAbil.shortName,
        synergyWinrate: winrate,
        synergyIncrease,
        numPicks,
        isOp: synergyIncrease >= OP_THRESHOLD,
      })
    } else {
      // Ability-ability pair
      const staticAbil1 = abilityLookup.get(abilityIdOne)
      const staticAbil2 = abilityLookup.get(abilityIdTwo)
      if (!staticAbil1 || !staticAbil2) continue

      // Skip same-hero pairs
      if (
        staticAbil1.ownerHeroId &&
        staticAbil2.ownerHeroId &&
        staticAbil1.ownerHeroId === staticAbil2.ownerHeroId
      ) {
        continue
      }

      const wr1 = abilityWinrates.get(abilityIdOne) ?? 0.5
      const wr2 = abilityWinrates.get(abilityIdTwo) ?? 0.5
      const synergyIncrease = winrate - (wr1 + wr2) / 2

      // Ensure ordered: name1 < name2 for consistent storage
      const [name1, name2] =
        staticAbil1.shortName < staticAbil2.shortName
          ? [staticAbil1.shortName, staticAbil2.shortName]
          : [staticAbil2.shortName, staticAbil1.shortName]

      abilityPairs.push({
        ability1Name: name1,
        ability2Name: name2,
        synergyWinrate: winrate,
        synergyIncrease,
        numPicks,
        isOp: synergyIncrease >= OP_THRESHOLD,
      })
    }
  }

  return { abilityPairs, heroPairs }
}

// ── Triplets ─────────────────────────────────────────────────────────────────

export function transformTriplets(
  triplets: WindrunTriplet[],
  abilityWinrates: Map<number, number>,
  abilityLookup: AbilityLookup,
  staticHeroes: Record<string, WindrunStaticHero>,
): {
  abilityTriplets: TransformedAbilityTriplet[]
  heroTriplets: TransformedHeroAbilityTriplet[]
} {
  const abilityTriplets: TransformedAbilityTriplet[] = []
  const heroTriplets: TransformedHeroAbilityTriplet[] = []

  for (const triplet of triplets) {
    const { abilityIdOne, abilityIdTwo, abilityIdThree, winrate, numPicks } = triplet

    if (abilityIdOne < 0) {
      // Hero + 2 abilities
      const heroId = Math.abs(abilityIdOne)
      const staticHero = staticHeroes[String(heroId)]
      const staticAbil1 = abilityLookup.get(abilityIdTwo)
      const staticAbil2 = abilityLookup.get(abilityIdThree)
      if (!staticHero || !staticAbil1 || !staticAbil2) continue

      const heroWr = abilityWinrates.get(abilityIdOne) ?? 0.5
      const wr1 = abilityWinrates.get(abilityIdTwo) ?? 0.5
      const wr2 = abilityWinrates.get(abilityIdThree) ?? 0.5
      const synergyIncrease = winrate - (heroWr + wr1 + wr2) / 3

      // Ensure ordered: ability1 < ability2
      const [name1, name2] =
        staticAbil1.shortName < staticAbil2.shortName
          ? [staticAbil1.shortName, staticAbil2.shortName]
          : [staticAbil2.shortName, staticAbil1.shortName]

      heroTriplets.push({
        heroName: staticHero.shortName,
        ability1Name: name1,
        ability2Name: name2,
        synergyWinrate: winrate,
        synergyIncrease,
        numPicks,
        isOp: synergyIncrease >= OP_THRESHOLD,
      })
    } else {
      // 3 abilities
      const staticAbil1 = abilityLookup.get(abilityIdOne)
      const staticAbil2 = abilityLookup.get(abilityIdTwo)
      const staticAbil3 = abilityLookup.get(abilityIdThree)
      if (!staticAbil1 || !staticAbil2 || !staticAbil3) continue

      const wr1 = abilityWinrates.get(abilityIdOne) ?? 0.5
      const wr2 = abilityWinrates.get(abilityIdTwo) ?? 0.5
      const wr3 = abilityWinrates.get(abilityIdThree) ?? 0.5
      const synergyIncrease = winrate - (wr1 + wr2 + wr3) / 3

      // Sort names for consistent ordering
      const names = [
        staticAbil1.shortName,
        staticAbil2.shortName,
        staticAbil3.shortName,
      ].sort()

      abilityTriplets.push({
        ability1Name: names[0],
        ability2Name: names[1],
        ability3Name: names[2],
        synergyWinrate: winrate,
        synergyIncrease,
        numPicks,
        isOp: synergyIncrease >= OP_THRESHOLD,
      })
    }
  }

  return { abilityTriplets, heroTriplets }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a map of windrun abilityId → winrate from stats array */
export function buildWinrateMap(stats: WindrunAbilityStat[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const stat of stats) {
    map.set(stat.abilityId, stat.winrate)
  }
  return map
}
