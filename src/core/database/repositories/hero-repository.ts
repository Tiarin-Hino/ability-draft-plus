import { eq, inArray, sql } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { heroes, abilities } from '../schema'
import type { Hero } from '@shared/types'
import type {
  AbilityShiftUpdate,
  AbilityShiftRow,
} from './ability-repository'

// @DEV-GUIDE: Hero CRUD repository. Provides getAll, getById, getByAbilityName (joins
// Abilities table to find which hero owns a given ability), upsertHeroes (batch insert
// from scraper with conflict handling), and deduplicateByDisplayName (cleans up seed vs
// Windrun naming collisions like "ancient_apparition" vs "ancientapparition").
// Used by: scan-processor (hero identification), scraper orchestrator (data ingestion).

export interface HeroUpsertData {
  name: string
  displayName: string
  winrate: number
  highSkillWinrate: number | null
  pickRate: number
  hsPickRate: number | null
  windrunId: number
}

export interface HeroRepository {
  getAll(): Hero[]
  getById(heroId: number): Hero | null
  getByAbilityName(
    abilityName: string,
  ): { heroId: number; heroName: string; heroDisplayName: string | null } | null
  upsertHeroes(batch: HeroUpsertData[]): Map<string, number>
  deduplicateByDisplayName(): number
  /**
   * Apply hero-MODEL /ability-shifts entries (negative-id rows, keyed here by
   * the positive hero windrun_id). Same never-wipe contract as the ability
   * variant. Returns the number of hero rows matched.
   */
  applyHeroShifts(shifts: AbilityShiftUpdate[]): number
  /** All heroes with their raw shift columns (name = hero internal name). */
  getAllShifts(): AbilityShiftRow[]
}

export function createHeroRepository(db: SQLJsDatabase): HeroRepository {
  return {
    getAll() {
      return db
        .select()
        .from(heroes)
        .all()
        .map((row) => ({
          heroId: row.heroId,
          name: row.name,
          displayName: row.displayName ?? row.name,
          winrate: row.winrate,
          highSkillWinrate: row.highSkillWinrate,
          pickRate: row.pickRate,
          hsPickRate: row.hsPickRate,
          windrunId: row.windrunId,
        }))
    },

    getById(heroId: number) {
      const row = db.select().from(heroes).where(eq(heroes.heroId, heroId)).get()
      if (!row) return null
      return {
        heroId: row.heroId,
        name: row.name,
        displayName: row.displayName ?? row.name,
        winrate: row.winrate,
        highSkillWinrate: row.highSkillWinrate,
        pickRate: row.pickRate,
        hsPickRate: row.hsPickRate,
        windrunId: row.windrunId,
      }
    },

    getByAbilityName(abilityName: string) {
      if (!abilityName) return null

      const row = db
        .select({
          heroId: heroes.heroId,
          heroName: heroes.name,
          heroDisplayName: heroes.displayName,
        })
        .from(abilities)
        .innerJoin(heroes, eq(abilities.heroId, heroes.heroId))
        .where(eq(abilities.name, abilityName))
        .get()

      return row ?? null
    },

    upsertHeroes(batch: HeroUpsertData[]): Map<string, number> {
      const nameToIdMap = new Map<string, number>()
      if (batch.length === 0) return nameToIdMap

      // Clean up stale hero entries that have a different name for the same windrunId.
      // This happens when the seed DB uses underscore-separated names (e.g., "ancient_apparition")
      // but Windrun uses concatenated names (e.g., "ancientapparition").
      const existing = db.select({ heroId: heroes.heroId, name: heroes.name, windrunId: heroes.windrunId }).from(heroes).all()
      const windrunIdToExisting = new Map<number, { heroId: number; name: string }>()
      for (const h of existing) {
        if (h.windrunId !== null) {
          windrunIdToExisting.set(Math.abs(h.windrunId), { heroId: h.heroId, name: h.name })
        }
      }
      for (const hero of batch) {
        const stale = windrunIdToExisting.get(hero.windrunId)
        if (stale && stale.name !== hero.name) {
          db.delete(heroes).where(eq(heroes.heroId, stale.heroId)).run()
        }
      }

      for (const hero of batch) {
        db.insert(heroes)
          .values({
            name: hero.name,
            displayName: hero.displayName,
            winrate: hero.winrate,
            highSkillWinrate: hero.highSkillWinrate,
            pickRate: hero.pickRate,
            hsPickRate: hero.hsPickRate,
            windrunId: hero.windrunId,
          })
          .onConflictDoUpdate({
            target: heroes.name,
            set: {
              displayName: sql`excluded.display_name`,
              winrate: sql`excluded.winrate`,
              highSkillWinrate: sql`excluded.high_skill_winrate`,
              pickRate: sql`excluded.pick_rate`,
              hsPickRate: sql`excluded.hs_pick_rate`,
              windrunId: sql`excluded.windrun_id`,
            },
          })
          .run()
      }

      // Build name → id map
      const rows = db.select({ heroId: heroes.heroId, name: heroes.name }).from(heroes).all()
      for (const row of rows) {
        nameToIdMap.set(row.name, row.heroId)
      }
      return nameToIdMap
    },

    applyHeroShifts(shifts: AbilityShiftUpdate[]): number {
      if (shifts.length === 0) return 0
      // sql.js run() doesn't report changes — count matches via SELECT first
      const known = new Set(
        db
          .select({ windrunId: heroes.windrunId })
          .from(heroes)
          .where(inArray(heroes.windrunId, shifts.map((s) => s.windrunId)))
          .all()
          .map((row) => row.windrunId),
      )
      let applied = 0
      for (const s of shifts) {
        if (!known.has(s.windrunId)) continue
        db.update(heroes)
          .set({
            killsShift: s.killsShift,
            deathsShift: s.deathsShift,
            kaShift: s.kaShift,
            gpmShift: s.gpmShift,
            xpmShift: s.xpmShift,
            dmgShift: s.dmgShift,
            healingShift: s.healingShift,
          })
          .where(eq(heroes.windrunId, s.windrunId))
          .run()
        applied += 1
      }
      return applied
    },

    getAllShifts(): AbilityShiftRow[] {
      return db
        .select({
          name: heroes.name,
          killsShift: heroes.killsShift,
          deathsShift: heroes.deathsShift,
          kaShift: heroes.kaShift,
          gpmShift: heroes.gpmShift,
          xpmShift: heroes.xpmShift,
          dmgShift: heroes.dmgShift,
          healingShift: heroes.healingShift,
        })
        .from(heroes)
        .all()
    },

    deduplicateByDisplayName(): number {
      // Find heroes that share the same display_name (e.g., seed "ancient_apparition" + Windrun "ancientapparition").
      // Keep the entry with the highest hero_id (the Windrun entry) and delete the rest.
      const all = db.select().from(heroes).all()
      const byDisplayName = new Map<string, typeof all>()
      for (const h of all) {
        const key = h.displayName ?? h.name
        const group = byDisplayName.get(key)
        if (group) group.push(h)
        else byDisplayName.set(key, [h])
      }
      let deleted = 0
      for (const group of byDisplayName.values()) {
        if (group.length <= 1) continue
        group.sort((a, b) => b.heroId - a.heroId)
        for (let i = 1; i < group.length; i++) {
          db.delete(heroes).where(eq(heroes.heroId, group[i].heroId)).run()
          deleted++
        }
      }
      return deleted
    },
  }
}
