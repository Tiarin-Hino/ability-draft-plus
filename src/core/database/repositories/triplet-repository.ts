import { sql, inArray, or } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { abilityTriplets, heroAbilityTriplets, abilities } from '../schema'

// @DEV-GUIDE: Triplet (3-ability combination) repository. Handles both pure ability triplets
// and hero+2-ability triplets. IDs are stored in sorted order for deduplication.
//
// Key method: getThirdAbilitiesForPairs(pairKeys) — given a list of ability ID pairs,
// finds all triplets containing both abilities and returns the third ability info.
// This powers the Phase 8.5 "suggested third ability" badge in scan-processor.ts.
//
// Bulk write methods (clearAndInsert*) are used by the scraper orchestrator after
// transforming Windrun /ability-triplets API responses.

export interface TripletInsertData {
  ability1Name: string
  ability2Name: string
  ability3Name: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

export interface HeroTripletInsertData {
  heroName: string
  ability1Name: string
  ability2Name: string
  synergyWinrate: number
  synergyIncrease: number
  numPicks: number
  isOp: boolean
}

export interface ThirdAbilityInfo {
  thirdAbilityName: string
  thirdAbilityDisplayName: string
  tripletWinrate: number
  tripletPicks: number
}

export interface TripletRepository {
  clearAndInsertAbilityTriplets(
    triplets: TripletInsertData[],
    nameToIdMap: Map<string, number>,
  ): number

  clearAndInsertHeroAbilityTriplets(
    triplets: HeroTripletInsertData[],
    abilityNameToIdMap: Map<string, number>,
    heroNameToIdMap: Map<string, number>,
  ): number

  getThirdAbilitiesForPairs(
    pairKeys: { a: number; b: number }[],
  ): Map<string, ThirdAbilityInfo[]>
}

export function createTripletRepository(db: SQLJsDatabase): TripletRepository {
  return {
    clearAndInsertAbilityTriplets(
      triplets: TripletInsertData[],
      nameToIdMap: Map<string, number>,
    ): number {
      db.delete(abilityTriplets).run()

      let inserted = 0
      for (const t of triplets) {
        const id1 = nameToIdMap.get(t.ability1Name)
        const id2 = nameToIdMap.get(t.ability2Name)
        const id3 = nameToIdMap.get(t.ability3Name)
        if (!id1 || !id2 || !id3) continue

        // Ensure ordered
        const sorted = [id1, id2, id3].sort((a, b) => a - b)

        db.insert(abilityTriplets)
          .values({
            abilityIdOne: sorted[0],
            abilityIdTwo: sorted[1],
            abilityIdThree: sorted[2],
            synergyWinrate: t.synergyWinrate,
            synergyIncrease: t.synergyIncrease,
            numPicks: t.numPicks,
            isOp: t.isOp,
          })
          .onConflictDoUpdate({
            target: [abilityTriplets.abilityIdOne, abilityTriplets.abilityIdTwo, abilityTriplets.abilityIdThree],
            set: {
              synergyWinrate: sql`excluded.synergy_winrate`,
              synergyIncrease: sql`excluded.synergy_increase`,
              numPicks: sql`excluded.num_picks`,
              isOp: sql`excluded.is_op`,
            },
          })
          .run()
        inserted++
      }
      return inserted
    },

    clearAndInsertHeroAbilityTriplets(
      triplets: HeroTripletInsertData[],
      abilityNameToIdMap: Map<string, number>,
      heroNameToIdMap: Map<string, number>,
    ): number {
      db.delete(heroAbilityTriplets).run()

      let inserted = 0
      for (const t of triplets) {
        const heroId = heroNameToIdMap.get(t.heroName)
        const id1 = abilityNameToIdMap.get(t.ability1Name)
        const id2 = abilityNameToIdMap.get(t.ability2Name)
        if (!heroId || !id1 || !id2) continue

        const [aId1, aId2] = id1 < id2 ? [id1, id2] : [id2, id1]

        db.insert(heroAbilityTriplets)
          .values({
            heroId,
            abilityIdOne: aId1,
            abilityIdTwo: aId2,
            synergyWinrate: t.synergyWinrate,
            synergyIncrease: t.synergyIncrease,
            numPicks: t.numPicks,
            isOp: t.isOp,
          })
          .onConflictDoUpdate({
            target: [heroAbilityTriplets.heroId, heroAbilityTriplets.abilityIdOne, heroAbilityTriplets.abilityIdTwo],
            set: {
              synergyWinrate: sql`excluded.synergy_winrate`,
              synergyIncrease: sql`excluded.synergy_increase`,
              numPicks: sql`excluded.num_picks`,
              isOp: sql`excluded.is_op`,
            },
          })
          .run()
        inserted++
      }
      return inserted
    },

    getThirdAbilitiesForPairs(
      pairKeys: { a: number; b: number }[],
    ): Map<string, ThirdAbilityInfo[]> {
      const result = new Map<string, ThirdAbilityInfo[]>()
      if (pairKeys.length === 0) return result

      // Collect all ability IDs from pairs
      const allIds = new Set<number>()
      for (const pair of pairKeys) {
        allIds.add(pair.a)
        allIds.add(pair.b)
      }
      const idArray = Array.from(allIds)

      // Find all triplets where at least one of the pair's abilities appears
      // We query triplets containing any of the relevant ability IDs
      const rows = db
        .select({
          idOne: abilityTriplets.abilityIdOne,
          idTwo: abilityTriplets.abilityIdTwo,
          idThree: abilityTriplets.abilityIdThree,
          synergyWinrate: abilityTriplets.synergyWinrate,
          numPicks: abilityTriplets.numPicks,
        })
        .from(abilityTriplets)
        .where(
          or(
            inArray(abilityTriplets.abilityIdOne, idArray),
            inArray(abilityTriplets.abilityIdTwo, idArray),
            inArray(abilityTriplets.abilityIdThree, idArray),
          ),
        )
        .all()

      // Build ability ID → name/displayName lookup for the third abilities
      const thirdAbilityIds = new Set<number>()
      for (const row of rows) {
        thirdAbilityIds.add(row.idOne)
        thirdAbilityIds.add(row.idTwo)
        thirdAbilityIds.add(row.idThree)
      }

      const abilityLookup = new Map<number, { name: string; displayName: string }>()
      if (thirdAbilityIds.size > 0) {
        const abilityRows = db
          .select({
            abilityId: abilities.abilityId,
            name: abilities.name,
            displayName: abilities.displayName,
          })
          .from(abilities)
          .where(inArray(abilities.abilityId, Array.from(thirdAbilityIds)))
          .all()
        for (const row of abilityRows) {
          abilityLookup.set(row.abilityId, {
            name: row.name,
            displayName: row.displayName ?? row.name,
          })
        }
      }

      // For each pair (a,b), find triplets containing both a and b
      for (const pair of pairKeys) {
        const [a, b] = pair.a < pair.b ? [pair.a, pair.b] : [pair.b, pair.a]
        const key = `${a}-${b}`
        const thirds: ThirdAbilityInfo[] = []

        for (const row of rows) {
          const ids = [row.idOne, row.idTwo, row.idThree]
          if (!ids.includes(a) || !ids.includes(b)) continue

          // The third ability is the one that's neither a nor b
          const thirdId = ids.find((id) => id !== a && id !== b)
          if (thirdId === undefined) continue

          const abilityInfo = abilityLookup.get(thirdId)
          if (!abilityInfo) continue

          thirds.push({
            thirdAbilityName: abilityInfo.name,
            thirdAbilityDisplayName: abilityInfo.displayName,
            tripletWinrate: row.synergyWinrate,
            tripletPicks: row.numPicks ?? 0,
          })
        }

        if (thirds.length > 0) {
          // Sort by triplet winrate descending, take top suggestion
          thirds.sort((x, y) => y.tripletWinrate - x.tripletWinrate)
          result.set(key, thirds)
        }
      }

      return result
    },
  }
}
