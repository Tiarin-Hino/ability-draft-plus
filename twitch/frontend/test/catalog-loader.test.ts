import { describe, it, expect, vi } from 'vitest'
import { loadCatalog, type StorageLike } from '../src/net/catalog-loader'
import type { Catalog } from '../src/data/catalog-types'

const catalog = (tag: string): Catalog => ({
  schema: 1,
  builtAt: tag,
  source: { repo: 'odota/dotaconstants', commit: tag },
  abilities: {},
  heroes: {},
  aliases: { windrunToCdn: {} },
})

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

function fakeFetch(routes: Record<string, unknown | Error>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const hit = Object.entries(routes).find(([key]) => url.endsWith(key))
    if (!hit) return new Response('nf', { status: 404 })
    if (hit[1] instanceof Error) throw hit[1]
    return new Response(JSON.stringify(hit[1]), { status: 200 })
  }) as unknown as typeof fetch
}

describe('catalog-loader', () => {
  it('fetches manifest then catalog and caches it', async () => {
    const storage = memoryStorage()
    const fetchImpl = fakeFetch({
      'manifest.json': { schema: 1, hash: 'h1', url: 'https://x/catalog-h1.json' },
      'catalog-h1.json': catalog('one'),
    })
    const result = await loadCatalog({ manifestUrl: 'https://x/manifest.json', storage, fetchImpl })
    expect(result.builtAt).toBe('one')
    expect(JSON.parse(storage.data['adplus.catalog.v1']).hash).toBe('h1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('serves the cache when the manifest hash matches', async () => {
    const storage = memoryStorage({
      'adplus.catalog.v1': JSON.stringify({ hash: 'h1', catalog: catalog('cached') }),
    })
    const fetchImpl = fakeFetch({ 'manifest.json': { schema: 1, hash: 'h1', url: 'https://x/catalog-h1.json' } })
    const result = await loadCatalog({ manifestUrl: 'https://x/manifest.json', storage, fetchImpl })
    expect(result.builtAt).toBe('cached')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to the cache when the manifest is unreachable', async () => {
    const storage = memoryStorage({
      'adplus.catalog.v1': JSON.stringify({ hash: 'h1', catalog: catalog('cached') }),
    })
    const fetchImpl = fakeFetch({ 'manifest.json': new Error('offline') })
    const result = await loadCatalog({ manifestUrl: 'https://x/manifest.json', storage, fetchImpl })
    expect(result.builtAt).toBe('cached')
  })

  it('works without storage and survives quota errors', async () => {
    const fetchImpl = fakeFetch({
      'manifest.json': { schema: 1, hash: 'h2', url: 'https://x/catalog-h2.json' },
      'catalog-h2.json': catalog('two'),
    })
    const noStorage = await loadCatalog({ manifestUrl: 'https://x/manifest.json', storage: null, fetchImpl })
    expect(noStorage.builtAt).toBe('two')
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    }
    const quota = await loadCatalog({ manifestUrl: 'https://x/manifest.json', storage: throwing, fetchImpl })
    expect(quota.builtAt).toBe('two')
  })
})
