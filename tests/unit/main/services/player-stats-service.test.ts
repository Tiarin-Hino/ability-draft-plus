import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WindrunApiClient } from '@core/scraper'
import type {
  PlayerStatsRepository,
  PlayerStatsUpsert,
} from '@core/database/repositories/player-stats-repository'

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// api-config imports electron; the service only needs it when no api client
// override is passed, but the module-level import must still resolve
vi.mock('../../../../src/main/services/api-config', () => ({
  loadClientTag: () => undefined,
}))

import { createPlayerStatsService } from '../../../../src/main/services/player-stats-service'
import type { DatabaseService } from '../../../../src/main/services/database-service'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDb {
  service: DatabaseService
  metadata: Map<string, string>
  abilityStats: PlayerStatsUpsert[]
  heroStats: PlayerStatsUpsert[]
  persistCount: () => number
  /** Names the ability-stats join resolves to (simulates windrun_id coverage). */
  setJoinedNames: (names: string[]) => void
}

function makeFakeDb(): FakeDb {
  const metadata = new Map<string, string>()
  let abilityStats: PlayerStatsUpsert[] = []
  let heroStats: PlayerStatsUpsert[] = []
  let joinedNames: string[] = []
  let persists = 0

  const playerStats: PlayerStatsRepository = {
    replaceAbilityStats(entries) {
      abilityStats = entries
    },
    replaceHeroStats(entries) {
      heroStats = entries
    },
    getAbilityStatsByName() {
      const map = new Map()
      for (const name of joinedNames) {
        map.set(name, { games: 1, wins: 1, winrate: 1, avgPickPosition: null })
      }
      return map
    },
    getHeroStatsByName() {
      return new Map()
    },
    clear() {
      abilityStats = []
      heroStats = []
    },
  }

  const service = {
    metadata: {
      get: (key: string) => metadata.get(key) ?? null,
      set: (key: string, value: string) => {
        metadata.set(key, value)
      },
    },
    playerStats,
    persist: () => {
      persists += 1
    },
  } as unknown as DatabaseService

  return {
    service,
    metadata,
    get abilityStats() {
      return abilityStats
    },
    get heroStats() {
      return heroStats
    },
    persistCount: () => persists,
    setJoinedNames: (names) => {
      joinedNames = names
    },
  }
}

function makeApiClient(overrides: Partial<WindrunApiClient> = {}): WindrunApiClient {
  return {
    fetchStaticAbilities: vi.fn(),
    fetchStaticHeroes: vi.fn(),
    fetchPatches: vi.fn(),
    fetchAbilities: vi.fn(),
    fetchAbilityHighSkill: vi.fn(),
    fetchHeroes: vi.fn(),
    fetchAbilityPairs: vi.fn(),
    fetchAbilityTriplets: vi.fn(),
    fetchPlayerProfile: vi.fn().mockResolvedValue({
      data: {
        steamId: 45008415,
        nickname: 'Tester',
        avatar: 'https://avatars.example/x.jpg',
        rating: 2700,
        region: 'europe',
        overallRank: 1000,
        regionalRank: 500,
        percentile: 0.95,
        wins: 10,
        losses: 5,
        lastMatch: null,
      },
    }),
    fetchPlayerStats: vi.fn().mockResolvedValue({
      stats: {
        spellStats: {
          '879': { wins: 9, losses: 6, winrate: 0.6, avgPickPosition: 12.5 },
          '5003': { wins: 3, losses: 2, winrate: 0.6, avgPickPosition: 20 },
        },
        heroStats: {
          '1': { wins: 7, losses: 9, total: 16, winrate: 7 / 16 },
        },
      },
    }),
    ...overrides,
  } as WindrunApiClient
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('player-stats-service', () => {
  let db: FakeDb

  beforeEach(() => {
    db = makeFakeDb()
  })

  describe('linkProfile', () => {
    it('rejects unparseable input without any network call', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      const result = await service.linkProfile('not a player')
      expect(result.success).toBe(false)
      expect(result.errorKey).toBe('personalStats.errorInvalidInput')
      expect(api.fetchPlayerProfile).not.toHaveBeenCalled()
    })

    it('validates, stores the profile, and fetches the first snapshot', async () => {
      db.setJoinedNames(['techies_sticky_bomb'])
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)

      const result = await service.linkProfile('https://windrun.io/players/45008415')

      expect(result.success).toBe(true)
      expect(result.profile?.playerId).toBe(45008415)
      expect(result.profile?.nickname).toBe('Tester')
      expect(result.stats?.success).toBe(true)
      expect(result.stats?.abilityCount).toBe(2)
      expect(result.stats?.heroCount).toBe(1)
      expect(result.stats?.matchedAbilityCount).toBe(1)

      expect(db.metadata.get('player_profile_id')).toBe('45008415')
      expect(db.abilityStats).toHaveLength(2)
      expect(db.heroStats).toHaveLength(1)
      expect(db.persistCount()).toBeGreaterThan(0)
    })

    it('returns errorProfileNotFound when the profile fetch fails and stores nothing', async () => {
      const api = makeApiClient({
        fetchPlayerProfile: vi.fn().mockRejectedValue(new Error('404')),
      })
      const service = createPlayerStatsService(db.service, api)

      const result = await service.linkProfile('45008415')
      expect(result.success).toBe(false)
      expect(result.errorKey).toBe('personalStats.errorProfileNotFound')
      expect(db.metadata.has('player_profile_id')).toBe(false)
    })

    it('links the profile even when the initial stats fetch fails', async () => {
      const api = makeApiClient({
        fetchPlayerStats: vi.fn().mockRejectedValue(new Error('503')),
      })
      const service = createPlayerStatsService(db.service, api)

      const result = await service.linkProfile('45008415')
      expect(result.success).toBe(true)
      expect(result.stats).toBeUndefined()
      expect(db.metadata.get('player_profile_id')).toBe('45008415')
    })
  })

  describe('refreshStats', () => {
    it('fails with errorNotLinked when no profile is linked', async () => {
      const service = createPlayerStatsService(db.service, makeApiClient())
      const result = await service.refreshStats()
      expect(result.success).toBe(false)
      expect(result.errorKey).toBe('personalStats.errorNotLinked')
    })

    it('keeps the previous snapshot on fetch failure', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.linkProfile('45008415')
      expect(db.abilityStats).toHaveLength(2)

      ;(api.fetchPlayerStats as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('down'),
      )
      const result = await service.refreshStats()
      expect(result.success).toBe(false)
      expect(result.errorKey).toBe('personalStats.errorFetchFailed')
      expect(db.abilityStats).toHaveLength(2)
    })
  })

  describe('refreshIfStale', () => {
    it('does nothing without a linked profile', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.refreshIfStale()
      expect(api.fetchPlayerStats).not.toHaveBeenCalled()
    })

    it('skips the fetch while the snapshot is fresh', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.linkProfile('45008415')
      expect(api.fetchPlayerStats).toHaveBeenCalledTimes(1)

      await service.refreshIfStale()
      expect(api.fetchPlayerStats).toHaveBeenCalledTimes(1)
    })

    it('refetches once the snapshot is older than the TTL', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.linkProfile('45008415')

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      db.metadata.set('player_stats_fetched_at', twoHoursAgo)

      await service.refreshIfStale()
      expect(api.fetchPlayerStats).toHaveBeenCalledTimes(2)
    })

    it('refetches when the linked profile changed since the last snapshot', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.linkProfile('45008415')

      db.metadata.set('player_stats_fetched_for', '99999')
      await service.refreshIfStale()
      expect(api.fetchPlayerStats).toHaveBeenCalledTimes(2)
    })

    it('never throws on fetch failure', async () => {
      const api = makeApiClient()
      const service = createPlayerStatsService(db.service, api)
      await service.linkProfile('45008415')
      db.metadata.set(
        'player_stats_fetched_at',
        new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      )
      ;(api.fetchPlayerStats as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('down'),
      )
      await expect(service.refreshIfStale()).resolves.toBeUndefined()
    })
  })

  describe('unlinkProfile', () => {
    it('clears stats and profile identity', async () => {
      const service = createPlayerStatsService(db.service, makeApiClient())
      await service.linkProfile('45008415')
      expect(service.getProfile()).not.toBeNull()

      service.unlinkProfile()
      expect(service.getProfile()).toBeNull()
      expect(db.abilityStats).toHaveLength(0)
      expect(db.heroStats).toHaveLength(0)
    })
  })
})
