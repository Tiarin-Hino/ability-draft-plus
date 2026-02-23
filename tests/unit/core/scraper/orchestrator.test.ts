import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performFullScrape, performLiquipediaEnrichment } from '@core/scraper/orchestrator'
import type { ScraperDeps, LiquipediaDeps } from '@core/scraper/orchestrator'
import type { ScraperProgress } from '@core/scraper/types'
import type { WindrunApiClient } from '@core/scraper/windrun-api-client'

function createMockApiClient(): WindrunApiClient {
  return {
    fetchStaticAbilities: vi.fn().mockResolvedValue({
      data: [
        {
          valveId: 5359, englishName: 'Fury Swipes', shortName: 'ursa_fury_swipes',
          ownerHeroId: 70, hasScepter: false, hasShard: true,
        },
      ],
    }),
    fetchStaticHeroes: vi.fn().mockResolvedValue({
      data: {
        '70': {
          id: 70, englishName: 'Ursa', shortName: 'ursa',
        },
      },
    }),
    fetchPatches: vi.fn().mockResolvedValue({ data: ['7.40c'] }),
    fetchAbilities: vi.fn().mockResolvedValue({
      data: {
        patches: { overall: ['7.40c'] },
        abilityStats: [
          {
            abilityId: 5359, numPicks: 800, avgPickPosition: 2.6,
            wins: 440, ownerHero: 70, winrate: 0.55, pickRate: 0.99,
          },
          {
            abilityId: -70, numPicks: 1000, avgPickPosition: 4.5,
            wins: 520, ownerHero: 70, winrate: 0.52, pickRate: 0.95,
          },
        ],
      },
    }),
    fetchAbilityHighSkill: vi.fn().mockResolvedValue({
      data: {
        allData: {
          patches: { overall: ['7.40c'] },
          abilityStats: [],
        },
        highSkillData: {
          patches: { overall: ['7.40c'] },
          abilityStats: [
            {
              abilityId: 5359, numPicks: 150, avgPickPosition: 2.2,
              wins: 90, ownerHero: 70, winrate: 0.60, pickRate: 0.98,
            },
          ],
        },
      },
    }),
    fetchHeroes: vi.fn().mockResolvedValue({ data: { patches: { overall: ['7.40c'] }, heroStats: {} } }),
    fetchAbilityPairs: vi.fn().mockResolvedValue({
      data: {
        abilityPairs: [],
        abilityStats: [],
      },
    }),
    fetchAbilityTriplets: vi.fn().mockResolvedValue({
      data: {
        abilityTriplets: [],
      },
    }),
  }
}

function createMockDeps(apiClient?: WindrunApiClient): ScraperDeps {
  return {
    apiClient: apiClient ?? createMockApiClient(),
    heroes: {
      upsertHeroes: vi.fn().mockReturnValue(new Map([['ursa', 1]])),
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn(),
      getByName: vi.fn(),
    } as unknown as ScraperDeps['heroes'],
    abilities: {
      upsertAbilities: vi.fn(),
      getNameToIdMap: vi.fn().mockReturnValue(new Map([['ursa_fury_swipes', 100]])),
      getAllNames: vi.fn().mockReturnValue(['ursa_fury_swipes']),
      updateAbilityMeta: vi.fn().mockReturnValue(1),
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn(),
      getByName: vi.fn(),
    } as unknown as ScraperDeps['abilities'],
    synergies: {
      clearAndInsertAbilitySynergies: vi.fn().mockReturnValue(0),
      clearAndInsertHeroAbilitySynergies: vi.fn().mockReturnValue(0),
      getOpAbilitySynergies: vi.fn().mockReturnValue([]),
      getTrapAbilitySynergies: vi.fn().mockReturnValue([]),
    } as unknown as ScraperDeps['synergies'],
    triplets: {
      clearAndInsertAbilityTriplets: vi.fn().mockReturnValue(0),
      clearAndInsertHeroAbilityTriplets: vi.fn().mockReturnValue(0),
      getThirdAbilitiesForPairs: vi.fn().mockReturnValue(new Map()),
    } as unknown as ScraperDeps['triplets'],
    metadata: {
      setLastScrapeDate: vi.fn(),
      getLastScrapeDate: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
    } as unknown as ScraperDeps['metadata'],
    persist: vi.fn(),
  }
}

describe('performFullScrape', () => {
  let deps: ScraperDeps
  let progress: ScraperProgress[]

  beforeEach(() => {
    deps = createMockDeps()
    progress = []
  })

  function onProgress(p: ScraperProgress) {
    progress.push(p)
  }

  it('completes all three phases successfully', async () => {
    const result = await performFullScrape(deps, onProgress)

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('reports progress through all phases', async () => {
    await performFullScrape(deps, onProgress)

    const phases = progress.map((p) => p.phase)
    expect(phases).toContain('phase1')
    expect(phases).toContain('phase2')
    expect(phases).toContain('done')
  })

  it('fetches static data and stats in parallel', async () => {
    const client = createMockApiClient()
    deps = createMockDeps(client)

    await performFullScrape(deps, onProgress)

    expect(client.fetchStaticAbilities).toHaveBeenCalledOnce()
    expect(client.fetchStaticHeroes).toHaveBeenCalledOnce()
    expect(client.fetchAbilities).toHaveBeenCalledOnce()
    expect(client.fetchAbilityHighSkill).toHaveBeenCalledOnce()
  })

  it('calls upsertHeroes and upsertAbilities in phase 1', async () => {
    await performFullScrape(deps, onProgress)

    expect(deps.heroes.upsertHeroes).toHaveBeenCalledOnce()
    expect(deps.abilities.upsertAbilities).toHaveBeenCalledOnce()
  })

  it('persists after each phase', async () => {
    await performFullScrape(deps, onProgress)

    // Phase 1 persist + Phase 2 persist + final success persist = 3
    expect(deps.persist).toHaveBeenCalledTimes(3)
  })

  it('calls clearAndInsert for pairs and triplets in phase 2', async () => {
    await performFullScrape(deps, onProgress)

    expect(deps.synergies.clearAndInsertAbilitySynergies).toHaveBeenCalledOnce()
    expect(deps.synergies.clearAndInsertHeroAbilitySynergies).toHaveBeenCalledOnce()
    expect(deps.triplets.clearAndInsertAbilityTriplets).toHaveBeenCalledOnce()
    expect(deps.triplets.clearAndInsertHeroAbilityTriplets).toHaveBeenCalledOnce()
  })

  it('sets last scrape date on success', async () => {
    await performFullScrape(deps, onProgress)

    expect(deps.metadata.setLastScrapeDate).toHaveBeenCalledOnce()
    const dateArg = (deps.metadata.setLastScrapeDate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('passes patch option to API calls', async () => {
    const client = createMockApiClient()
    deps = createMockDeps(client)

    await performFullScrape(deps, onProgress, { patch: '7.40c' })

    expect(client.fetchAbilities).toHaveBeenCalledWith('7.40c')
    expect(client.fetchAbilityHighSkill).toHaveBeenCalledWith('7.40c')
    expect(client.fetchAbilityPairs).toHaveBeenCalledWith('7.40c')
    expect(client.fetchAbilityTriplets).toHaveBeenCalledWith('7.40c')
  })

  it('returns error on API failure', async () => {
    const client = createMockApiClient()
    client.fetchStaticAbilities = vi.fn().mockRejectedValue(new Error('Network error'))
    deps = createMockDeps(client)

    const result = await performFullScrape(deps, onProgress)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('reports error phase on failure', async () => {
    const client = createMockApiClient()
    client.fetchStaticAbilities = vi.fn().mockRejectedValue(new Error('timeout'))
    deps = createMockDeps(client)

    await performFullScrape(deps, onProgress)

    const errorProgress = progress.find((p) => p.phase === 'error')
    expect(errorProgress).toBeDefined()
    expect(errorProgress!.message).toContain('timeout')
  })

  it('does not set last scrape date on failure', async () => {
    const client = createMockApiClient()
    client.fetchStaticAbilities = vi.fn().mockRejectedValue(new Error('fail'))
    deps = createMockDeps(client)

    await performFullScrape(deps, onProgress)

    expect(deps.metadata.setLastScrapeDate).not.toHaveBeenCalled()
  })

  it('runs staleness detection when classNames provided', async () => {
    deps.classNames = ['ursa_fury_swipes', 'some_removed_ability']

    const result = await performFullScrape(deps, onProgress)

    expect(result.success).toBe(true)
    expect(result.modelGaps).toBeDefined()
    expect(result.modelGaps!.staleInModel).toContain('some_removed_ability')
  })

  it('skips staleness detection when no classNames', async () => {
    const result = await performFullScrape(deps, onProgress)

    expect(result.success).toBe(true)
    expect(result.modelGaps).toBeNull()
  })

  it('returns modelGaps null when everything matches', async () => {
    deps.classNames = ['ursa_fury_swipes']

    const result = await performFullScrape(deps, onProgress)

    expect(result.success).toBe(true)
    expect(result.modelGaps).toBeNull()
  })
})

describe('performLiquipediaEnrichment', () => {
  let progress: ScraperProgress[]

  function onProgress(p: ScraperProgress) {
    progress.push(p)
  }

  beforeEach(() => {
    progress = []
  })

  it('applies Liquipedia updates via updateAbilityMeta', async () => {
    const updateAbilityMeta = vi.fn().mockReturnValue(2)
    const deps: LiquipediaDeps = {
      abilities: {
        updateAbilityMeta,
      } as unknown as LiquipediaDeps['abilities'],
      persist: vi.fn(),
      enrichFromLiquipedia: vi.fn().mockResolvedValue([
        { abilityName: 'ursa_fury_swipes', abilityOrder: 3, isUltimate: false },
        { abilityName: 'ursa_enrage', abilityOrder: 0, isUltimate: true },
      ]),
    }

    const result = await performLiquipediaEnrichment(deps, ['Ursa'], onProgress)

    expect(result.success).toBe(true)
    expect(updateAbilityMeta).toHaveBeenCalledWith([
      { name: 'ursa_fury_swipes', abilityOrder: 3, isUltimate: false },
      { name: 'ursa_enrage', abilityOrder: 0, isUltimate: true },
    ])
    expect(deps.persist).toHaveBeenCalled()
  })

  it('handles empty updates gracefully', async () => {
    const deps: LiquipediaDeps = {
      abilities: {
        updateAbilityMeta: vi.fn(),
      } as unknown as LiquipediaDeps['abilities'],
      persist: vi.fn(),
      enrichFromLiquipedia: vi.fn().mockResolvedValue([]),
    }

    const result = await performLiquipediaEnrichment(deps, ['Ursa'], onProgress)

    expect(result.success).toBe(true)
    expect(deps.abilities.updateAbilityMeta).not.toHaveBeenCalled()
    expect(deps.persist).not.toHaveBeenCalled()
  })

  it('returns error on failure', async () => {
    const deps: LiquipediaDeps = {
      abilities: {
        updateAbilityMeta: vi.fn(),
      } as unknown as LiquipediaDeps['abilities'],
      persist: vi.fn(),
      enrichFromLiquipedia: vi.fn().mockRejectedValue(new Error('Rate limited')),
    }

    const result = await performLiquipediaEnrichment(deps, ['Ursa'], onProgress)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Rate limited')
  })

  it('converts hero display names to underscore format', async () => {
    const enrichFn = vi.fn().mockResolvedValue([])
    const deps: LiquipediaDeps = {
      abilities: {
        updateAbilityMeta: vi.fn(),
      } as unknown as LiquipediaDeps['abilities'],
      persist: vi.fn(),
      enrichFromLiquipedia: enrichFn,
    }

    await performLiquipediaEnrichment(deps, ['Drow Ranger', 'Anti-Mage'], onProgress)

    const heroNames = enrichFn.mock.calls[0][0] as string[]
    expect(heroNames).toEqual(['Drow_Ranger', 'Anti-Mage'])
  })
})
