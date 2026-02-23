import { eq, inArray, sql } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { abilities } from '../schema'
import type { AbilityDetail } from '@shared/types'

// @DEV-GUIDE: Ability CRUD repository. Key methods:
// - getDetails(names[]): Batch lookup by internal name, returns Map<name, AbilityDetail>.
//   This is the hot path during scan processing (Phase 3).
// - upsertAbilities: Batch insert from scraper with ON CONFLICT UPDATE.
// - getNameToIdMap: Returns Map<internalName, abilityId> for synergy/triplet foreign key resolution.
// - updateAbilityMeta: Applies Liquipedia-sourced ability_order and is_ultimate updates.
// Used by: scan-processor, scraper orchestrator, Liquipedia enrichment, staleness detector.

export interface AbilityUpsertData {
  name: string
  displayName: string
  heroName: string | null
  winrate: number
  highSkillWinrate: number | null
  pickRate: number
  hsPickRate: number | null
  isUltimate?: boolean
}

export interface AbilityRepository {
  getAll(): AbilityDetail[]
  getDetails(names: string[]): Map<string, AbilityDetail>
  getByHeroId(heroId: number): AbilityDetail[]
  upsertAbilities(batch: AbilityUpsertData[], heroNameToIdMap: Map<string, number>): void
  getNameToIdMap(): Map<string, number>
  getAllNames(): string[]
  updateAbilityMeta(updates: Array<{ name: string; abilityOrder: number; isUltimate: boolean }>): number
}

function mapRow(row: typeof abilities.$inferSelect): AbilityDetail {
  return {
    abilityId: row.abilityId,
    name: row.name,
    displayName: row.displayName ?? row.name,
    heroId: row.heroId ?? 0,
    winrate: row.winrate,
    highSkillWinrate: row.highSkillWinrate,
    pickRate: row.pickRate,
    hsPickRate: row.hsPickRate,
    isUltimate: row.isUltimate ?? false,
    abilityOrder: row.abilityOrder ?? 0,
  }
}

export function createAbilityRepository(db: SQLJsDatabase): AbilityRepository {
  return {
    getAll() {
      return db
        .select()
        .from(abilities)
        .orderBy(abilities.heroId, abilities.abilityOrder)
        .all()
        .map(mapRow)
    },

    getDetails(names: string[]) {
      const detailsMap = new Map<string, AbilityDetail>()
      if (names.length === 0) return detailsMap

      const rows = db
        .select()
        .from(abilities)
        .where(inArray(abilities.name, names))
        .all()

      for (const row of rows) {
        detailsMap.set(row.name, mapRow(row))
      }
      return detailsMap
    },

    getByHeroId(heroId: number) {
      return db
        .select()
        .from(abilities)
        .where(eq(abilities.heroId, heroId))
        .orderBy(abilities.abilityOrder)
        .all()
        .map(mapRow)
    },

    upsertAbilities(batch: AbilityUpsertData[], heroNameToIdMap: Map<string, number>): void {
      for (const ability of batch) {
        const heroId = ability.heroName ? (heroNameToIdMap.get(ability.heroName) ?? null) : null
        db.insert(abilities)
          .values({
            name: ability.name,
            displayName: ability.displayName,
            heroId,
            winrate: ability.winrate,
            highSkillWinrate: ability.highSkillWinrate,
            pickRate: ability.pickRate,
            hsPickRate: ability.hsPickRate,
            isUltimate: ability.isUltimate ?? false,
          })
          .onConflictDoUpdate({
            target: abilities.name,
            set: {
              displayName: sql`excluded.display_name`,
              heroId: sql`excluded.hero_id`,
              winrate: sql`excluded.winrate`,
              highSkillWinrate: sql`excluded.high_skill_winrate`,
              pickRate: sql`excluded.pick_rate`,
              hsPickRate: sql`excluded.hs_pick_rate`,
              isUltimate: sql`excluded.is_ultimate`,
            },
          })
          .run()
      }
    },

    getNameToIdMap(): Map<string, number> {
      const map = new Map<string, number>()
      const rows = db
        .select({ abilityId: abilities.abilityId, name: abilities.name })
        .from(abilities)
        .all()
      for (const row of rows) {
        map.set(row.name, row.abilityId)
      }
      return map
    },

    getAllNames(): string[] {
      return db
        .select({ name: abilities.name })
        .from(abilities)
        .all()
        .map((row) => row.name)
    },

    updateAbilityMeta(updates: Array<{ name: string; abilityOrder: number; isUltimate: boolean }>): number {
      let updated = 0
      for (const u of updates) {
        const existing = db
          .select({ name: abilities.name })
          .from(abilities)
          .where(eq(abilities.name, u.name))
          .all()
        if (existing.length === 0) continue
        db.update(abilities)
          .set({
            abilityOrder: u.abilityOrder,
            isUltimate: u.isUltimate,
          })
          .where(eq(abilities.name, u.name))
          .run()
        updated += 1
      }
      return updated
    },
  }
}
