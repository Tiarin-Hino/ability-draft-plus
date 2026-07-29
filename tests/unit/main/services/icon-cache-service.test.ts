import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      throw new Error(`Unexpected getPath: ${name}`)
    },
    getAppPath: () => userDataDir,
    isPackaged: false,
  },
}))

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

import { createIconCacheService } from '../../../../src/main/services/icon-cache-service'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const PLACEHOLDER_BYTES = Buffer.from('placeholder-png')

function okResponse(): Response {
  return new Response(PNG_BYTES, { status: 200 })
}

function notFoundResponse(): Response {
  return new Response('not found', { status: 404 })
}

describe('icon-cache-service', () => {
  let cacheRoot: string
  let placeholderRoot: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'adp-icon-test-'))
    cacheRoot = join(userDataDir, 'stream-icons')
    placeholderRoot = join(userDataDir, 'placeholders')
    mkdirSync(placeholderRoot, { recursive: true })
    writeFileSync(join(placeholderRoot, 'placeholder-ability.png'), PLACEHOLDER_BYTES)
    writeFileSync(join(placeholderRoot, 'placeholder-hero.png'), PLACEHOLDER_BYTES)
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('fetches from CDN on cache miss and persists to disk', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    const result = await service.getIcon('abilities', 'pudge_rot')
    expect(result.isPlaceholder).toBe(false)
    expect(result.data.equals(PNG_BYTES)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0]).toContain('/abilities/pudge_rot.png')
    expect(existsSync(join(cacheRoot, 'abilities', 'pudge_rot.png'))).toBe(true)
  })

  it('serves from disk without fetching on subsequent calls', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    await service.getIcon('abilities', 'pudge_rot')
    const second = await service.getIcon('abilities', 'pudge_rot')

    expect(second.isPlaceholder).toBe(false)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('resolves _ad variants to the base CDN name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    await service.getIcon('abilities', 'invoker_sun_strike_ad')
    expect(fetchImpl.mock.calls[0][0]).toContain('/abilities/invoker_sun_strike.png')
  })

  it('serves placeholder and negative-caches on CDN 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(notFoundResponse())
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    const first = await service.getIcon('abilities', 'renamed_ability')
    expect(first.isPlaceholder).toBe(true)
    expect(first.data.equals(PLACEHOLDER_BYTES)).toBe(true)

    const second = await service.getIcon('abilities', 'renamed_ability')
    expect(second.isPlaceholder).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('serves placeholder on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    const result = await service.getIcon('heroes', 'pudge')
    expect(result.isPlaceholder).toBe(true)
  })

  it('rejects unsafe names without touching the network', async () => {
    const fetchImpl = vi.fn()
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    const result = await service.getIcon('abilities', '../../../etc/passwd')
    expect(result.isPlaceholder).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the hero CDN path for hero icons', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

    await service.getIcon('heroes', 'sand_king')
    expect(fetchImpl.mock.calls[0][0]).toContain('/heroes/sand_king.png')
  })

  describe('prefetchAbilities', () => {
    it('reports fetched, cached, and failed counts', async () => {
      const fetchImpl = vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.includes('bad_ability') ? notFoundResponse() : okResponse(),
          ),
        )
      const service = createIconCacheService({ cacheRoot, placeholderRoot, fetchImpl })

      // Pre-cache one ability
      await service.getIcon('abilities', 'already_here')

      const summary = await service.prefetchAbilities([
        'already_here',
        'new_one',
        'bad_ability',
      ])

      expect(summary).toEqual({
        total: 3,
        fetched: 1,
        alreadyCached: 1,
        failed: 1,
      })
    })
  })
})
