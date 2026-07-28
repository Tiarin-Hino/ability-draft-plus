import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { abilities, heroes } from '../schema'
import type { AbilityDetail } from '@shared/types'

// @DEV-GUIDE: Ability CRUD repository. Key methods:
// - getDetails(names[]): Batch lookup by internal name, returns Map<name, AbilityDetail>.
//   This is the hot path during scan processing (Phase 3).
// - upsertAbilities: Batch insert from scraper with ON CONFLICT UPDATE.
// - deleteAbilitiesNotIn: Post-scrape prune of abilities that dropped out of Windrun data
//   (removed/renamed in a patch). Without it, stale rows accumulate and pollute ML
//   staleness detection. FK cascades clean up dependent synergy/triplet rows.
// - getNameToIdMap: Returns Map<internalName, abilityId> for synergy/triplet foreign key resolution.
// - applyLiquipediaMeta: Applies Liquipedia-sourced ability_order and is_ultimate updates.
//   Matches by DISPLAY name scoped to a hero (Liquipedia has no internal names), and only
//   accepts ultimate candidates (non-Q/W/E hotkey) when Windrun data agrees is_ultimate=1.
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

export interface LiquipediaMetaUpdate {
  /** Hero display name as stored in Heroes.display_name, e.g. "Drow Ranger" */
  heroDisplayName: string
  /** Ability display name as rendered on Liquipedia, e.g. "Shadow Step" */
  abilityDisplayName: string
  /** 1-3 for Q/W/E hotkeys; 0 for ultimate candidates */
  abilityOrder: number
  /**
   * True when the Liquipedia hotkey is not Q/W/E (R, F, D, ...). Applied as an
   * ultimate (order 0) only if the DB row is already is_ultimate per Windrun data —
   * this filters out sub-abilities (e.g. Spectre's Reality) that also carry hotkeys.
   */
  isUltimateCandidate: boolean
}

export interface AbilityRepository {
  getAll(): AbilityDetail[]
  getDetails(names: string[]): Map<string, AbilityDetail>
  getByHeroId(heroId: number): AbilityDetail[]
  upsertAbilities(batch: AbilityUpsertData[], heroNameToIdMap: Map<string, number>): void
  /**
   * Delete abilities whose name is NOT in keepNames (i.e. no longer served by Windrun).
   * No-op when keepNames is empty (a failed/empty scrape must never wipe the table).
   * Returns the names of the deleted abilities.
   */
  deleteAbilitiesNotIn(keepNames: string[]): string[]
  getNameToIdMap(): Map<string, number>
  getAllNames(): string[]
  applyLiquipediaMeta(updates: LiquipediaMetaUpdate[]): number
  /**
   * Force ability_order/is_ultimate by internal name. Used for the hand-curated
   * slot overrides (see scraper/slot-metadata-overrides.ts) — authoritative over
   * both Windrun and Liquipedia. Returns the number of rows that matched.
   */
  setSlotMetadata(
    entries: Array<{ name: string; abilityOrder: number; isUltimate: boolean }>,
  ): number
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

    deleteAbilitiesNotIn(keepNames: string[]): string[] {
      if (keepNames.length === 0) return []
      const staleNames = db
        .select({ name: abilities.name })
        .from(abilities)
        .where(notInArray(abilities.name, keepNames))
        .all()
        .map((row) => row.name)
      if (staleNames.length === 0) return []
      db.delete(abilities).where(inArray(abilities.name, staleNames)).run()
      return staleNames
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

    setSlotMetadata(
      entries: Array<{ name: string; abilityOrder: number; isUltimate: boolean }>,
    ): number {
      if (entries.length === 0) return 0
      // sql.js run() doesn't report changes — count matches via SELECT first
      const existing = new Set(
        db
          .select({ name: abilities.name })
          .from(abilities)
          .where(inArray(abilities.name, entries.map((e) => e.name)))
          .all()
          .map((row) => row.name),
      )
      for (const entry of entries) {
        if (!existing.has(entry.name)) continue
        db.update(abilities)
          .set({ abilityOrder: entry.abilityOrder, isUltimate: entry.isUltimate })
          .where(eq(abilities.name, entry.name))
          .run()
      }
      return existing.size
    },

    applyLiquipediaMeta(updates: LiquipediaMetaUpdate[]): number {
      let applied = 0
      for (const u of updates) {
        const rows = db
          .select({ abilityId: abilities.abilityId, isUltimate: abilities.isUltimate })
          .from(abilities)
          .innerJoin(heroes, eq(abilities.heroId, heroes.heroId))
          .where(
            and(
              eq(abilities.displayName, u.abilityDisplayName),
              eq(heroes.displayName, u.heroDisplayName),
            ),
          )
          .all()
        if (rows.length === 0) continue
        const row = rows[0]

        if (u.isUltimateCandidate) {
          if (!row.isUltimate) continue
          db.update(abilities)
            .set({ abilityOrder: 0, isUltimate: true })
            .where(eq(abilities.abilityId, row.abilityId))
            .run()
        } else {
          db.update(abilities)
            .set({ abilityOrder: u.abilityOrder, isUltimate: false })
            .where(eq(abilities.abilityId, row.abilityId))
            .run()
        }
        applied += 1
      }
      return applied
    },
  }
}
