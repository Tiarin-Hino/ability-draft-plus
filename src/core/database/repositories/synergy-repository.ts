import { eq, and, or, ne, gte, lte, lt, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { abilities, abilitySynergies, heroAbilitySynergies, heroes } from '../schema'

// @DEV-GUIDE: Synergy pair lookup and bulk insert repository. Handles both ability-ability
// pairs (AbilitySynergies table) and hero-ability pairs (HeroAbilitySynergies table).
//
// Key query methods used by scan-processor:
// - getHighWinrateCombinations: Bidirectional synergy lookup for a single ability vs the pool.
//   Performs two queries (forward + reverse) because pairs are stored base_id < synergy_id.
//   Filters out same-hero pairs. Used for per-slot tooltip synergy lists.
// - getAllOPCombinations / getAllTrapCombinations: Bulk fetch by synergy_increase threshold.
//   Same-hero pairs excluded via SQL WHERE clause. Used for OP/Trap combination panels.
// - getAllHeroSynergies / getAllHeroTrapSynergies: Hero-ability synergies by threshold.
//
// Bulk write methods used by scraper:
// - clearAndInsertAbilitySynergies: DELETE all + INSERT with ON CONFLICT UPDATE.
// - clearAndInsertHeroAbilitySynergies: Same pattern for hero-ability pairs.

export interface SynergyPartner {
  partnerDisplayName: string
  partnerInternalName: string
  synergyWinrate: number
}

export interface AbilitySynergyPair {
  ability1InternalName: string
  ability1DisplayName: string
  ability2InternalName: string
  ability2DisplayName: string
  synergyWinrate: number
}

export interface HeroAbilitySynergyRow {
  heroInternalName: string
  heroDisplayName: string
  abilityInternalName: string
  abilityDisplayName: string
  synergyWinrate: number
}

export interface SynergyPairDisplay {
  ability1DisplayName: string
  ability2DisplayName: string
  synergyWinrate: number
}

export interface HeroSynergyDisplay {
  heroDisplayName: string
  abilityDisplayName: string
  synergyWinrate: number
}

export interface SynergyClearInsertData {
  ability1Name: string
  ability2Name: string
  synergyWinrate: number
  synergyIncrease: number
  isOp: boolean
}

export interface HeroSynergyClearInsertData {
  heroName: string
  abilityName: string
  synergyWinrate: number
  synergyIncrease: number
  isOp: boolean
}

export interface SynergyRepository {
  getHighWinrateCombinations(
    baseAbilityName: string,
    draftPoolNames: string[],
  ): SynergyPartner[]

  getOPCombinationsInPool(
    draftPoolNames: string[],
    threshold: number,
  ): SynergyPairDisplay[]

  getAllOPCombinations(threshold: number): AbilitySynergyPair[]

  getAllHeroSynergies(threshold: number): HeroAbilitySynergyRow[]

  getAllHeroAbilitySynergiesUnfiltered(): HeroAbilitySynergyRow[]

  getHeroSynergiesInPool(
    draftPoolNames: string[],
    threshold: number,
  ): HeroSynergyDisplay[]

  getAllTrapCombinations(threshold: number): AbilitySynergyPair[]

  getAllHeroTrapSynergies(threshold: number): HeroAbilitySynergyRow[]

  clearAndInsertAbilitySynergies(
    pairs: SynergyClearInsertData[],
    nameToIdMap: Map<string, number>,
  ): number

  clearAndInsertHeroAbilitySynergies(
    pairs: HeroSynergyClearInsertData[],
    abilityNameToIdMap: Map<string, number>,
    heroNameToIdMap: Map<string, number>,
  ): number
}

export function createSynergyRepository(db: SQLJsDatabase): SynergyRepository {
  // Drizzle aliases for self-joining Abilities table
  const a1 = alias(abilities, 'a1')
  const a2 = alias(abilities, 'a2')

  function queryHeroAbilitySynergies(
    thresholdFilter?: { direction: 'gte' | 'lte'; value: number },
    poolFilter?: string[],
  ): HeroAbilitySynergyRow[] {
    const conditions = []

    // Exclude hero's own abilities (built-in kit synergies are uninformative)
    conditions.push(
      or(isNull(abilities.heroId), ne(heroAbilitySynergies.heroId, abilities.heroId)),
    )

    if (thresholdFilter) {
      const { direction, value } = thresholdFilter
      conditions.push(
        direction === 'gte'
          ? gte(heroAbilitySynergies.synergyIncrease, value)
          : lte(heroAbilitySynergies.synergyIncrease, value),
      )
    }

    if (poolFilter && poolFilter.length > 0) {
      conditions.push(inArray(abilities.name, poolFilter))
    }

    const query = db
      .select({
        heroInternalName: heroes.name,
        heroDisplayName: heroes.displayName,
        abilityInternalName: abilities.name,
        abilityDisplayName: abilities.displayName,
        synergyWinrate: heroAbilitySynergies.synergyWinrate,
      })
      .from(heroAbilitySynergies)
      .innerJoin(heroes, eq(heroAbilitySynergies.heroId, heroes.heroId))
      .innerJoin(abilities, eq(heroAbilitySynergies.abilityId, abilities.abilityId))

    const rows =
      conditions.length > 0
        ? query.where(and(...conditions)).all()
        : query.all()

    return rows.map((row) => ({
      heroInternalName: row.heroInternalName,
      heroDisplayName: row.heroDisplayName ?? row.heroInternalName,
      abilityInternalName: row.abilityInternalName,
      abilityDisplayName: row.abilityDisplayName ?? row.abilityInternalName,
      synergyWinrate: row.synergyWinrate,
    }))
  }

  return {
    getHighWinrateCombinations(
      baseAbilityName: string,
      draftPoolNames: string[],
    ): SynergyPartner[] {
      if (!baseAbilityName || draftPoolNames.length === 0) return []

      // Get the base ability's hero_id for same-hero filtering
      const baseAbility = db
        .select({ heroId: abilities.heroId })
        .from(abilities)
        .where(eq(abilities.name, baseAbilityName))
        .get()

      if (!baseAbility) return []

      const otherPool = draftPoolNames.filter((n) => n !== baseAbilityName)
      if (otherPool.length === 0) return []

      const baseHeroId = baseAbility.heroId

      // Two queries for bidirectional synergy lookup, then merge in TypeScript.
      // Query 1: base ability is on the base_ability_id side
      const forwardRows = db
        .select({
          synergyWinrate: abilitySynergies.synergyWinrate,
          partnerDisplayName: a2.displayName,
          partnerInternalName: a2.name,
          partnerHeroId: a2.heroId,
        })
        .from(abilitySynergies)
        .innerJoin(a1, eq(abilitySynergies.baseAbilityId, a1.abilityId))
        .innerJoin(a2, eq(abilitySynergies.synergyAbilityId, a2.abilityId))
        .where(and(eq(a1.name, baseAbilityName), inArray(a2.name, otherPool)))
        .all()

      // Query 2: base ability is on the synergy_ability_id side
      const reverseRows = db
        .select({
          synergyWinrate: abilitySynergies.synergyWinrate,
          partnerDisplayName: a1.displayName,
          partnerInternalName: a1.name,
          partnerHeroId: a1.heroId,
        })
        .from(abilitySynergies)
        .innerJoin(a1, eq(abilitySynergies.baseAbilityId, a1.abilityId))
        .innerJoin(a2, eq(abilitySynergies.synergyAbilityId, a2.abilityId))
        .where(and(eq(a2.name, baseAbilityName), inArray(a1.name, otherPool)))
        .all()

      // Merge, filter same-hero, deduplicate, sort
      const seen = new Set<string>()
      const results: SynergyPartner[] = []

      for (const row of [...forwardRows, ...reverseRows]) {
        // Skip same-hero pairs
        if (baseHeroId !== null && row.partnerHeroId === baseHeroId) continue
        // Deduplicate by partner name
        if (seen.has(row.partnerInternalName)) continue
        seen.add(row.partnerInternalName)

        results.push({
          partnerDisplayName: row.partnerDisplayName ?? row.partnerInternalName,
          partnerInternalName: row.partnerInternalName,
          synergyWinrate: row.synergyWinrate,
        })
      }

      results.sort((a, b) => b.synergyWinrate - a.synergyWinrate)
      return results
    },

    getOPCombinationsInPool(
      draftPoolNames: string[],
      threshold: number,
    ): SynergyPairDisplay[] {
      if (draftPoolNames.length < 2) return []

      const rows = db
        .select({
          ability1DisplayName: a1.displayName,
          ability1InternalName: a1.name,
          ability2DisplayName: a2.displayName,
          ability2InternalName: a2.name,
          synergyWinrate: abilitySynergies.synergyWinrate,
        })
        .from(abilitySynergies)
        .innerJoin(a1, eq(abilitySynergies.baseAbilityId, a1.abilityId))
        .innerJoin(a2, eq(abilitySynergies.synergyAbilityId, a2.abilityId))
        .where(
          and(
            gte(abilitySynergies.synergyIncrease, threshold),
            inArray(a1.name, draftPoolNames),
            inArray(a2.name, draftPoolNames),
            lt(abilitySynergies.baseAbilityId, abilitySynergies.synergyAbilityId),
          ),
        )
        .all()

      return rows.map((row) => ({
        ability1DisplayName: row.ability1DisplayName ?? row.ability1InternalName,
        ability2DisplayName: row.ability2DisplayName ?? row.ability2InternalName,
        synergyWinrate: row.synergyWinrate,
      }))
    },

    getAllOPCombinations(threshold: number): AbilitySynergyPair[] {
      const rows = db
        .select({
          ability1InternalName: a1.name,
          ability1DisplayName: a1.displayName,
          ability2InternalName: a2.name,
          ability2DisplayName: a2.displayName,
          synergyWinrate: abilitySynergies.synergyWinrate,
        })
        .from(abilitySynergies)
        .innerJoin(a1, eq(abilitySynergies.baseAbilityId, a1.abilityId))
        .innerJoin(a2, eq(abilitySynergies.synergyAbilityId, a2.abilityId))
        .where(
          and(
            gte(abilitySynergies.synergyIncrease, threshold),
            lt(abilitySynergies.baseAbilityId, abilitySynergies.synergyAbilityId),
            or(isNull(a1.heroId), isNull(a2.heroId), ne(a1.heroId, a2.heroId)),
          ),
        )
        .all()

      return rows.map((row) => ({
        ability1InternalName: row.ability1InternalName,
        ability1DisplayName: row.ability1DisplayName ?? row.ability1InternalName,
        ability2InternalName: row.ability2InternalName,
        ability2DisplayName: row.ability2DisplayName ?? row.ability2InternalName,
        synergyWinrate: row.synergyWinrate,
      }))
    },

    getAllHeroSynergies(threshold: number): HeroAbilitySynergyRow[] {
      return queryHeroAbilitySynergies({ direction: 'gte', value: threshold })
    },

    getAllHeroAbilitySynergiesUnfiltered(): HeroAbilitySynergyRow[] {
      return queryHeroAbilitySynergies()
    },

    getHeroSynergiesInPool(
      draftPoolNames: string[],
      threshold: number,
    ): HeroSynergyDisplay[] {
      if (draftPoolNames.length === 0) return []
      const rows = queryHeroAbilitySynergies(
        { direction: 'gte', value: threshold },
        draftPoolNames,
      )
      return rows.map((row) => ({
        heroDisplayName: row.heroDisplayName,
        abilityDisplayName: row.abilityDisplayName,
        synergyWinrate: row.synergyWinrate,
      }))
    },

    getAllTrapCombinations(threshold: number): AbilitySynergyPair[] {
      const negatedThreshold = -threshold

      const rows = db
        .select({
          ability1InternalName: a1.name,
          ability1DisplayName: a1.displayName,
          ability2InternalName: a2.name,
          ability2DisplayName: a2.displayName,
          synergyWinrate: abilitySynergies.synergyWinrate,
        })
        .from(abilitySynergies)
        .innerJoin(a1, eq(abilitySynergies.baseAbilityId, a1.abilityId))
        .innerJoin(a2, eq(abilitySynergies.synergyAbilityId, a2.abilityId))
        .where(
          and(
            lte(abilitySynergies.synergyIncrease, negatedThreshold),
            lt(abilitySynergies.baseAbilityId, abilitySynergies.synergyAbilityId),
            or(isNull(a1.heroId), isNull(a2.heroId), ne(a1.heroId, a2.heroId)),
          ),
        )
        .all()

      return rows.map((row) => ({
        ability1InternalName: row.ability1InternalName,
        ability1DisplayName: row.ability1DisplayName ?? row.ability1InternalName,
        ability2InternalName: row.ability2InternalName,
        ability2DisplayName: row.ability2DisplayName ?? row.ability2InternalName,
        synergyWinrate: row.synergyWinrate,
      }))
    },

    getAllHeroTrapSynergies(threshold: number): HeroAbilitySynergyRow[] {
      return queryHeroAbilitySynergies({ direction: 'lte', value: -threshold })
    },

    clearAndInsertAbilitySynergies(
      pairs: SynergyClearInsertData[],
      nameToIdMap: Map<string, number>,
    ): number {
      // Delete all existing
      db.delete(abilitySynergies).run()

      let inserted = 0
      for (const pair of pairs) {
        const id1 = nameToIdMap.get(pair.ability1Name)
        const id2 = nameToIdMap.get(pair.ability2Name)
        if (!id1 || !id2) continue

        // Ensure ordered: baseAbilityId < synergyAbilityId
        const [baseId, synId] = id1 < id2 ? [id1, id2] : [id2, id1]

        db.insert(abilitySynergies)
          .values({
            baseAbilityId: baseId,
            synergyAbilityId: synId,
            synergyWinrate: pair.synergyWinrate,
            synergyIncrease: pair.synergyIncrease,
            isOp: pair.isOp,
          })
          .onConflictDoUpdate({
            target: [abilitySynergies.baseAbilityId, abilitySynergies.synergyAbilityId],
            set: {
              synergyWinrate: sql`excluded.synergy_winrate`,
              synergyIncrease: sql`excluded.synergy_increase`,
              isOp: sql`excluded.is_op`,
            },
          })
          .run()
        inserted++
      }
      return inserted
    },

    clearAndInsertHeroAbilitySynergies(
      pairs: HeroSynergyClearInsertData[],
      abilityNameToIdMap: Map<string, number>,
      heroNameToIdMap: Map<string, number>,
    ): number {
      // Delete all existing
      db.delete(heroAbilitySynergies).run()

      let inserted = 0
      for (const pair of pairs) {
        const heroId = heroNameToIdMap.get(pair.heroName)
        const abilityId = abilityNameToIdMap.get(pair.abilityName)
        if (!heroId || !abilityId) continue

        db.insert(heroAbilitySynergies)
          .values({
            heroId,
            abilityId,
            synergyWinrate: pair.synergyWinrate,
            synergyIncrease: pair.synergyIncrease,
            isOp: pair.isOp,
          })
          .onConflictDoUpdate({
            target: [heroAbilitySynergies.heroId, heroAbilitySynergies.abilityId],
            set: {
              synergyWinrate: sql`excluded.synergy_winrate`,
              synergyIncrease: sql`excluded.synergy_increase`,
              isOp: sql`excluded.is_op`,
            },
          })
          .run()
        inserted++
      }
      return inserted
    },
  }
}
