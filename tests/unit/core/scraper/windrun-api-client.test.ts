import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWindrunApiClient } from '@core/scraper/windrun-api-client'
import type {
  WindrunAbilitiesResponse,
  WindrunStaticAbilitiesResponse,
  WindrunPairsResponse,
  WindrunTripletsResponse,
} from '@core/scraper/types'

describe('WindrunApiClient', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetchJson(data: unknown) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    })
  }

  function mockFetchError(status: number, statusText: string) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status,
      statusText,
    })
  }

  it('fetchStaticAbilities calls correct URL', async () => {
    const response: WindrunStaticAbilitiesResponse = {
      data: [
        {
          valveId: 5359, englishName: 'Fury Swipes', shortName: 'ursa_fury_swipes',
          ownerHeroId: 70, hasScepter: false, hasShard: true,
        },
      ],
    }
    mockFetchJson(response)

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    const result = await client.fetchStaticAbilities()

    expect(result.data[0].shortName).toBe('ursa_fury_swipes')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.windrun.io/api/v2/static/abilities',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
  })

  it('fetchAbilities appends patch parameter when provided', async () => {
    const response: WindrunAbilitiesResponse = {
      data: {
        patches: { overall: ['7.40c'] },
        abilityStats: [],
      },
    }
    mockFetchJson(response)

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    await client.fetchAbilities('7.40c')

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('patch=7.40c')
  })

  it('fetchAbilities omits patch parameter when not provided', async () => {
    const response: WindrunAbilitiesResponse = {
      data: {
        patches: { overall: ['7.40c'] },
        abilityStats: [],
      },
    }
    mockFetchJson(response)

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    await client.fetchAbilities()

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).not.toContain('patch=')
  })

  it('fetchAbilityPairs returns both pairs and abilityStats', async () => {
    const response: WindrunPairsResponse = {
      data: {
        abilityPairs: [
          { abilityIdOne: 5359, abilityIdTwo: 5100, numPicks: 500, winrate: 0.60 },
        ],
        abilityStats: [
          { abilityId: 5359, numPicks: 800, avgPickPosition: 2.6, wins: 440, ownerHero: 70, winrate: 0.55, pickRate: 0.99 },
        ],
      },
    }
    mockFetchJson(response)

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    const result = await client.fetchAbilityPairs()

    expect(result.data.abilityPairs).toHaveLength(1)
    expect(result.data.abilityStats).toHaveLength(1)
  })

  it('fetchAbilityTriplets returns triplets', async () => {
    const response: WindrunTripletsResponse = {
      data: {
        abilityTriplets: [
          { abilityIdOne: -70, abilityIdTwo: 5359, abilityIdThree: 5100, numPicks: 200, winrate: 0.65 },
        ],
      },
    }
    mockFetchJson(response)

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    const result = await client.fetchAbilityTriplets()

    expect(result.data.abilityTriplets).toHaveLength(1)
    expect(result.data.abilityTriplets[0].abilityIdOne).toBe(-70)
  })

  it('throws on HTTP error response', async () => {
    mockFetchError(500, 'Internal Server Error')

    const client = createWindrunApiClient('https://api.windrun.io/api/v2')
    await expect(client.fetchStaticAbilities()).rejects.toThrow(
      'Windrun API error: 500 Internal Server Error for static/abilities',
    )
  })

  it('handles custom base URL', async () => {
    mockFetchJson({ data: {} })

    const client = createWindrunApiClient('http://localhost:3000/api/v2')
    await client.fetchStaticHeroes()

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:3000/api/v2/static/heroes')
  })

  it('handles base URL with trailing slash', async () => {
    mockFetchJson({ data: {} })

    const client = createWindrunApiClient('https://api.windrun.io/api/v2/')
    await client.fetchPatches()

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe('https://api.windrun.io/api/v2/static/patches')
  })
})
