import { join } from 'path'
import { promises as fs } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import { abilityCdnUrl, heroCdnUrl, isSafeIconName } from '@core/stream/icon-urls'
import { ICON_CACHE_REFRESH_TTL_MS } from '@shared/constants/thresholds'

// @DEV-GUIDE: Download-through cache for official Valve CDN art, backing the stream
// server's /icons/* route AND the pick-slot template matcher (ml-worker). The OBS
// browser source NEVER talks to the CDN — only this main-process service does, and
// every response it serves is a local file:
//   userData/stream-icons/{abilities,heroes}/<name>.png
// Cached files are NOT immutable: Valve reworks icon art in place (2026-08 Pugna),
// which silently breaks template matching and shows outdated art. prefetchAbilities
// therefore revalidates any cached icon whose mtime is older than
// ICON_CACHE_REFRESH_TTL_MS, fetching with a cache-busting query — Valve's own edge
// cache (Cloudflare) served stale pre-rework bytes under the bare URL, so only an
// uncacheable URL reliably reaches origin. Unchanged art just gets its mtime bumped;
// changed art is rewritten (the ml-worker reloads templates by mtime diff).
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
  /** Cached icons past the refresh TTL whose art had actually changed upstream. */
  refreshed: number
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

  async function fetchFromCdn(
    kind: IconKind,
    name: string,
    bustCache = false,
  ): Promise<Buffer | null> {
    let url = kind === 'abilities' ? abilityCdnUrl(name) : heroCdnUrl(name)
    // Uncacheable URL → forces the CDN edge to revalidate against origin. The
    // edge is known to keep serving pre-rework bytes under the bare URL.
    if (bustCache) url += `?_=${Date.now()}`
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
        refreshed: 0,
        failed: 0,
      }

      // Revalidates a cached icon that outlived the refresh TTL: refetch with a
      // cache-busting URL, rewrite on changed art, bump mtime otherwise. Any
      // failure keeps the old file — stale art still beats a placeholder.
      async function refreshStaleIcon(
        name: string,
        cachedPath: string,
      ): Promise<void> {
        const fresh = await fetchFromCdn('abilities', name, true)
        if (fresh === null) {
          summary.alreadyCached++
          return
        }
        const current = await fs.readFile(cachedPath)
        if (fresh.equals(current)) {
          const now = new Date()
          await fs.utimes(cachedPath, now, now)
          summary.alreadyCached++
          return
        }
        await fs.writeFile(cachedPath, fresh)
        logger.info('Cached icon refreshed — upstream art changed', { name })
        summary.refreshed++
      }

      const queue = [...names]
      async function worker(): Promise<void> {
        for (;;) {
          const name = queue.shift()
          if (name === undefined) return
          const cachedPath = join(cacheRoot, 'abilities', `${name}.png`)
          let cachedMtimeMs: number | null = null
          try {
            cachedMtimeMs = (await fs.stat(cachedPath)).mtimeMs
          } catch {
            // not cached yet
          }
          if (cachedMtimeMs !== null) {
            if (Date.now() - cachedMtimeMs < ICON_CACHE_REFRESH_TTL_MS) {
              summary.alreadyCached++
              continue
            }
            try {
              await refreshStaleIcon(name, cachedPath)
            } catch (error) {
              logger.warn('Icon refresh failed — keeping cached copy', {
                name,
                error: error instanceof Error ? error.message : String(error),
              })
              summary.alreadyCached++
            }
            continue
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
