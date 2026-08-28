import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { abilities, heroes, playerAbilityStats, playerHeroStats } from '../schema'
import type { PersonalAbilityStats, PersonalHeroStats } from '@shared/types'

// @DEV-GUIDE: Personal stats of the linked Windrun profile (personalized suggestions).
// Rows are keyed by WINDRUN ids and fully replaced on each refresh — the source
// endpoint (/players/{id}/stats) returns a complete snapshot, and partial upserts
// would leave stale rows behind when an ability drops out of the player's top 200.
// The *ByName getters join onto Abilities.windrun_id / Heroes.windrun_id so the
// scan pipeline (which works in internal names) never sees windrun ids. Abilities
// scraped before 2.6 have windrun_id NULL — those rows simply don't join until the
// next scrape, which degrades gracefully to global-only scores.

export interface PlayerStatsUpsert {
  windrunId: number
  wins: number
  losses: number
  winrate: number
  /** Abilities only; heroes have no personal pick position. */
  avgPickPosition?: number | null
}

export interface PlayerStatsRepository {
  /** Replace ALL personal ability stats with a fresh snapshot. */
  replaceAbilityStats(entries: PlayerStatsUpsert[]): void
  /** Replace ALL personal hero stats with a fresh snapshot. */
  replaceHeroStats(entries: PlayerStatsUpsert[]): void
  /** Personal ability stats keyed by internal ability name (joined via windrun_id). */
  getAbilityStatsByName(): Map<string, PersonalAbilityStats>
  /** Personal hero stats keyed by internal hero name (joined via windrun_id). */
  getHeroStatsByName(): Map<string, PersonalHeroStats>
  /** Wipe all personal stats (profile unlinked). */
  clear(): void
}

export function createPlayerStatsRepository(db: SQLJsDatabase): PlayerStatsRepository {
  return {
    replaceAbilityStats(entries: PlayerStatsUpsert[]): void {
      db.delete(playerAbilityStats).run()
      for (const entry of entries) {
        db.insert(playerAbilityStats)
          .values({
            windrunAbilityId: entry.windrunId,
            wins: entry.wins,
            losses: entry.losses,
            winrate: entry.winrate,
            avgPickPosition: entry.avgPickPosition ?? null,
          })
          .run()
      }
    },

    replaceHeroStats(entries: PlayerStatsUpsert[]): void {
      db.delete(playerHeroStats).run()
      for (const entry of entries) {
        db.insert(playerHeroStats)
          .values({
            windrunHeroId: entry.windrunId,
            wins: entry.wins,
            losses: entry.losses,
            winrate: entry.winrate,
          })
          .run()
      }
    },

    getAbilityStatsByName(): Map<string, PersonalAbilityStats> {
      const rows = db
        .select({
          name: abilities.name,
          wins: playerAbilityStats.wins,
          losses: playerAbilityStats.losses,
          winrate: playerAbilityStats.winrate,
          avgPickPosition: playerAbilityStats.avgPickPosition,
        })
        .from(playerAbilityStats)
        .innerJoin(abilities, eq(abilities.windrunId, playerAbilityStats.windrunAbilityId))
        .all()

      const map = new Map<string, PersonalAbilityStats>()
      for (const row of rows) {
        map.set(row.name, {
          games: row.wins + row.losses,
          wins: row.wins,
          winrate: row.winrate,
          avgPickPosition: row.avgPickPosition,
        })
      }
      return map
    },

    getHeroStatsByName(): Map<string, PersonalHeroStats> {
      const rows = db
        .select({
          name: heroes.name,
          wins: playerHeroStats.wins,
          losses: playerHeroStats.losses,
          winrate: playerHeroStats.winrate,
        })
        .from(playerHeroStats)
        .innerJoin(heroes, eq(heroes.windrunId, playerHeroStats.windrunHeroId))
        .all()

      const map = new Map<string, PersonalHeroStats>()
      for (const row of rows) {
        map.set(row.name, {
          games: row.wins + row.losses,
          wins: row.wins,
          winrate: row.winrate,
        })
      }
      return map
    },

    clear(): void {
      db.delete(playerAbilityStats).run()
      db.delete(playerHeroStats).run()
    },
  }
}
