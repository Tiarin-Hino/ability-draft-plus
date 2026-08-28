import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  createPlayerStatsRepository,
  type PlayerStatsRepository,
} from '@core/database/repositories/player-stats-repository'
import * as schema from '@core/database/schema'
import { createTestDb, seedTestData, type TestDb } from './test-helpers'

describe('PlayerStatsRepository', () => {
  let testDb: TestDb
  let repo: PlayerStatsRepository

  beforeEach(async () => {
    testDb = await createTestDb()
    seedTestData(testDb.db)
    // Give some seed abilities windrun ids (the scraper populates these);
    // invoker_quas deliberately keeps windrun_id NULL (pre-2.6 database row)
    testDb.db
      .update(schema.abilities)
      .set({ windrunId: 101 })
      .where(eq(schema.abilities.name, 'antimage_mana_break'))
      .run()
    testDb.db
      .update(schema.abilities)
      .set({ windrunId: 102 })
      .where(eq(schema.abilities.name, 'pudge_rot'))
      .run()
    repo = createPlayerStatsRepository(testDb.db)
  })

  afterEach(() => {
    testDb.close()
  })

  it('joins ability stats to internal names via windrun_id', () => {
    repo.replaceAbilityStats([
      { windrunId: 101, wins: 9, losses: 6, winrate: 0.6, avgPickPosition: 12.5 },
      { windrunId: 102, wins: 2, losses: 8, winrate: 0.2, avgPickPosition: 33 },
    ])

    const byName = repo.getAbilityStatsByName()
    expect(byName.size).toBe(2)
    expect(byName.get('antimage_mana_break')).toEqual({
      games: 15,
      wins: 9,
      winrate: 0.6,
      avgPickPosition: 12.5,
    })
    expect(byName.get('pudge_rot')).toEqual({
      games: 10,
      wins: 2,
      winrate: 0.2,
      avgPickPosition: 33,
    })
  })

  it('drops stats whose windrun id matches no ability row', () => {
    repo.replaceAbilityStats([
      { windrunId: 999, wins: 5, losses: 5, winrate: 0.5, avgPickPosition: 20 },
    ])
    expect(repo.getAbilityStatsByName().size).toBe(0)
  })

  it('fully replaces the previous snapshot', () => {
    repo.replaceAbilityStats([
      { windrunId: 101, wins: 9, losses: 6, winrate: 0.6, avgPickPosition: 12.5 },
    ])
    repo.replaceAbilityStats([
      { windrunId: 102, wins: 2, losses: 8, winrate: 0.2, avgPickPosition: 33 },
    ])

    const byName = repo.getAbilityStatsByName()
    expect(byName.size).toBe(1)
    expect(byName.has('antimage_mana_break')).toBe(false)
    expect(byName.has('pudge_rot')).toBe(true)
  })

  it('joins hero stats to internal names via windrun_id', () => {
    // seedTestData: antimage has windrunId 1, crystal_maiden 2
    repo.replaceHeroStats([
      { windrunId: 1, wins: 7, losses: 9, winrate: 7 / 16 },
      { windrunId: 2, wins: 12, losses: 3, winrate: 0.8 },
    ])

    const byName = repo.getHeroStatsByName()
    expect(byName.size).toBe(2)
    expect(byName.get('antimage')).toEqual({
      games: 16,
      wins: 7,
      winrate: 7 / 16,
    })
    expect(byName.get('crystal_maiden')).toEqual({
      games: 15,
      wins: 12,
      winrate: 0.8,
    })
  })

  it('clear() wipes both tables', () => {
    repo.replaceAbilityStats([
      { windrunId: 101, wins: 9, losses: 6, winrate: 0.6, avgPickPosition: 12.5 },
    ])
    repo.replaceHeroStats([{ windrunId: 1, wins: 7, losses: 9, winrate: 7 / 16 }])

    repo.clear()
    expect(repo.getAbilityStatsByName().size).toBe(0)
    expect(repo.getHeroStatsByName().size).toBe(0)
  })

  it('stores a null pick position (heroes have none)', () => {
    repo.replaceAbilityStats([
      { windrunId: 101, wins: 9, losses: 6, winrate: 0.6, avgPickPosition: null },
    ])
    expect(repo.getAbilityStatsByName().get('antimage_mana_break')!.avgPickPosition).toBeNull()
  })
})
