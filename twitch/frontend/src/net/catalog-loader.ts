import type { Catalog, CatalogManifest } from '../data/catalog-types'

// Catalog loading: manifest (short cache) -> hashed catalog (immutable) -> localStorage.
// The extension iframe may have no usable storage (third-party partitioning) — degrade to
// memory. A stale cache beats no catalog when the manifest cannot be fetched.

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const CACHE_KEY = 'adplus.catalog.v1'
const FETCH_TIMEOUT_MS = 8_000

export interface CatalogLoadOptions {
  manifestUrl: string
  storage: StorageLike | null
  fetchImpl?: typeof fetch
}

export function safeLocalStorage(): StorageLike | null {
  try {
    const probe = '__adplus_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

function readCache(storage: StorageLike | null): { hash: string; catalog: Catalog } | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { hash?: string; catalog?: Catalog }
    if (typeof parsed.hash !== 'string' || !parsed.catalog || parsed.catalog.schema !== 1) return null
    return { hash: parsed.hash, catalog: parsed.catalog }
  } catch {
    return null
  }
}

function writeCache(storage: StorageLike | null, hash: string, catalog: Catalog): void {
  if (!storage) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ hash, catalog }))
  } catch {
    // Quota exceeded / disabled — memory only
  }
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string, cache: RequestCache): Promise<T> {
  const response = await fetchImpl(url, { cache, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return (await response.json()) as T
}

export async function loadCatalog(options: CatalogLoadOptions): Promise<Catalog> {
  const fetchImpl = options.fetchImpl ?? fetch
  const cached = readCache(options.storage)

  let manifest: CatalogManifest
  try {
    manifest = await fetchJson<CatalogManifest>(fetchImpl, options.manifestUrl, 'no-cache')
  } catch (error) {
    if (cached) return cached.catalog
    throw error
  }
  if (cached && cached.hash === manifest.hash) return cached.catalog

  const catalog = await fetchJson<Catalog>(fetchImpl, manifest.url, 'force-cache')
  if (catalog.schema !== 1) throw new Error('Unsupported catalog schema')
  writeCache(options.storage, manifest.hash, catalog)
  return catalog
}
