import { join } from 'path'
import { promises as fs } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import { abilityCdnUrl, heroCdnUrl, isSafeIconName } from '@core/stream/icon-urls'

// @DEV-GUIDE: Download-through cache for official Valve CDN art, backing the stream
// server's /icons/* route. The OBS browser source NEVER talks to the CDN — only this
// main-process service does, and every response it serves is a local file:
//   userData/stream-icons/{abilities,heroes}/<name>.png
// On CDN miss/failure the bundled placeholder is served and the name is negative-cached
// in memory (NEGATIVE_CACHE_TTL_MS) so a bad name doesn't hammer the CDN once per tile
// render. CDN 404s are logged at warn level — those logs are the feed for growing
// ABILITY_ICON_NAME_OVERRIDES / HERO_CDN_NAME_OVERRIDES in src/core/stream/.
// fetchImpl is injectable for tests; production uses global fetch (Node >= 18).

const logger = log.scope('icon-cache')

const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const PREFETCH_CONCURRENCY = 6

export type IconKind = 'abilities' | 'heroes'

export interface IconResult {
  data: Buffer
  isPlaceholder: boolean
}

export interface PrefetchSummary {
  total: number
  fetched: number
  alreadyCached: number
  failed: number
}

export interface IconCacheService {
  /** Returns icon bytes — always resolves; placeholder on any failure. */
  getIcon(kind: IconKind, name: string): Promise<IconResult>
  /** Warm the cache for a list of ability internal names. */
  prefetchAbilities(names: string[]): Promise<PrefetchSummary>
}

export interface IconCacheOptions {
  cacheRoot?: string
  placeholderRoot?: string
  fetchImpl?: typeof fetch
}

function resourcesBase(): string {
  return app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources')
}

export function createIconCacheService(
  options: IconCacheOptions = {},
): IconCacheService {
  const cacheRoot =
    options.cacheRoot ?? join(app.getPath('userData'), 'stream-icons')
  const placeholderRoot =
    options.placeholderRoot ?? join(resourcesBase(), 'data', 'stream')
  const fetchImpl = options.fetchImpl ?? fetch

  // name -> retry-not-before timestamp
  const negativeCache = new Map<string, number>()
  const placeholders = new Map<IconKind, Buffer>()

  async function getPlaceholder(kind: IconKind): Promise<Buffer> {
    const cached = placeholders.get(kind)
    if (cached) return cached
    const file =
      kind === 'abilities' ? 'placeholder-ability.png' : 'placeholder-hero.png'
    try {
      const data = await fs.readFile(join(placeholderRoot, file))
      placeholders.set(kind, data)
      return data
    } catch (error) {
      logger.error('Placeholder icon missing', {
        file,
        error: error instanceof Error ? error.message : String(error),
      })
      // 1x1 transparent PNG as the last-resort fallback
      return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      )
    }
  }

  async function fetchFromCdn(kind: IconKind, name: string): Promise<Buffer | null> {
    const url = kind === 'abilities' ? abilityCdnUrl(name) : heroCdnUrl(name)
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        logger.warn('CDN icon miss — candidate for icon name overrides', {
          kind,
          name,
          status: response.status,
          url,
        })
        return null
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      logger.warn('CDN icon fetch failed', {
        kind,
        name,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async function getIcon(kind: IconKind, name: string): Promise<IconResult> {
    if (!isSafeIconName(name)) {
      return { data: await getPlaceholder(kind), isPlaceholder: true }
    }

    const filePath = join(cacheRoot, kind, `${name}.png`)

    try {
      return { data: await fs.readFile(filePath), isPlaceholder: false }
    } catch {
      // cache miss — fall through to CDN
    }

    const negativeKey = `${kind}/${name}`
    const retryAfter = negativeCache.get(negativeKey)
    if (retryAfter !== undefined && Date.now() < retryAfter) {
      return { data: await getPlaceholder(kind), isPlaceholder: true }
    }

    const data = await fetchFromCdn(kind, name)
    if (data === null) {
      negativeCache.set(negativeKey, Date.now() + NEGATIVE_CACHE_TTL_MS)
      return { data: await getPlaceholder(kind), isPlaceholder: true }
    }

    try {
      await fs.mkdir(join(cacheRoot, kind), { recursive: true })
      await fs.writeFile(filePath, data)
    } catch (error) {
      logger.warn('Failed to persist icon to cache', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return { data, isPlaceholder: false }
  }

  return {
    getIcon,

    async prefetchAbilities(names: string[]): Promise<PrefetchSummary> {
      const summary: PrefetchSummary = {
        total: names.length,
        fetched: 0,
        alreadyCached: 0,
        failed: 0,
      }

      const queue = [...names]
      async function worker(): Promise<void> {
        for (;;) {
          const name = queue.shift()
          if (name === undefined) return
          const cachedPath = join(cacheRoot, 'abilities', `${name}.png`)
          try {
            await fs.access(cachedPath)
            summary.alreadyCached++
            continue
          } catch {
            // not cached yet
          }
          const result = await getIcon('abilities', name)
          if (result.isPlaceholder) summary.failed++
          else summary.fetched++
        }
      }

      await Promise.all(
        Array.from({ length: PREFETCH_CONCURRENCY }, () => worker()),
      )
      logger.info('Ability icon prefetch complete', { ...summary })
      return summary
    },
  }
}

/** Ability internal names from the shipped ML class list (same file the classifier uses). */
export async function loadAbilityClassNames(): Promise<string[]> {
  const classNamesPath = join(resourcesBase(), 'model', 'class_names.json')
  const raw = await fs.readFile(classNamesPath, 'utf-8')
  const parsed = JSON.parse(raw) as unknown
  return Array.isArray(parsed)
    ? (parsed as string[])
    : Object.values(parsed as Record<string, string>)
}
