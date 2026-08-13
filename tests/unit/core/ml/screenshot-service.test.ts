import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron's desktopCapturer + screen
const mockGetSources = vi.fn()
const mockGetPrimaryDisplay = vi.fn()
vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: (...args: unknown[]) => mockGetSources(...args),
  },
  screen: {
    getPrimaryDisplay: () => mockGetPrimaryDisplay(),
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  },
}))

import { createScreenshotService } from '../../../../src/main/services/screenshot-service'

/** 2x2 BGRA bitmap: every pixel B=10, G=20, R=30, A=255. */
function makeBgraBitmap(width = 2, height = 2): Buffer {
  const buffer = Buffer.alloc(width * height * 4)
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 10
    buffer[i + 1] = 20
    buffer[i + 2] = 30
    buffer[i + 3] = 255
  }
  return buffer
}

function makeSource(
  id: string,
  displayId: string,
  options: { name?: string; width?: number; height?: number; empty?: boolean } = {},
) {
  const width = options.width ?? 2
  const height = options.height ?? 2
  return {
    id,
    display_id: displayId,
    name: options.name ?? '',
    thumbnail: {
      toBitmap: () => (options.empty ? Buffer.alloc(0) : makeBgraBitmap(width, height)),
      getSize: () => ({ width, height }),
    },
  }
}

describe('ScreenshotService (desktopCapturer)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPrimaryDisplay.mockReturnValue({
      id: 42,
      size: { width: 2560, height: 1440 },
      scaleFactor: 1,
    })
    mockGetSources.mockResolvedValue([makeSource('screen:42', '42')])
  })

  describe('capture (full screen)', () => {
    it('requests screen sources at the primary display physical resolution', async () => {
      mockGetPrimaryDisplay.mockReturnValue({
        id: 42,
        size: { width: 1707, height: 1067 }, // logical points at 150% scaling
        scaleFactor: 1.5,
      })

      const service = createScreenshotService()
      await service.capture()

      expect(mockGetSources).toHaveBeenCalledWith({
        types: ['screen'],
        thumbnailSize: { width: 2561, height: 1601 }, // rounded physical pixels
      })
    })

    it('converts the BGRA bitmap to raw RGB with swapped channels, no alpha', async () => {
      const service = createScreenshotService()
      const raw = await service.capture()

      expect(raw.width).toBe(2)
      expect(raw.height).toBe(2)
      expect(raw.data.length).toBe(2 * 2 * 3)
      // BGRA (10,20,30,255) must come out as RGB (30,20,10)
      expect(raw.data[0]).toBe(30)
      expect(raw.data[1]).toBe(20)
      expect(raw.data[2]).toBe(10)
    })

    it('selects the source matching the primary display id among several', async () => {
      mockGetSources.mockResolvedValue([
        makeSource('screen:7', '7', { width: 4, height: 4 }),
        makeSource('screen:42', '42', { width: 2, height: 2 }),
      ])

      const service = createScreenshotService()
      const raw = await service.capture()
      expect(raw.width).toBe(2)
    })

    it('throws when no screen sources are available', async () => {
      mockGetSources.mockResolvedValue([])
      const service = createScreenshotService()
      await expect(service.capture()).rejects.toThrow('No screen sources')
    })

    it('throws when the capture produces an empty image', async () => {
      mockGetSources.mockResolvedValue([
        makeSource('screen:42', '42', { empty: true }),
      ])
      const service = createScreenshotService()
      await expect(service.capture()).rejects.toThrow('empty image')
    })
  })

  describe('captureWindow', () => {
    it('captures a window source matched by exact title', async () => {
      mockGetSources.mockResolvedValue([
        makeSource('window:1', '', { name: 'Discord', width: 2, height: 2 }),
        makeSource('window:2', '', { name: 'Dota 2', width: 2, height: 2 }),
      ])

      const service = createScreenshotService()
      const raw = await service.captureWindow('Dota 2', { width: 2, height: 2 })

      expect(mockGetSources).toHaveBeenCalledWith({
        types: ['window'],
        thumbnailSize: { width: 2, height: 2 },
      })
      expect(raw).not.toBeNull()
      expect(raw?.width).toBe(2)
      expect(raw?.data[0]).toBe(30)
    })

    it('returns null when the window is not among the sources', async () => {
      mockGetSources.mockResolvedValue([
        makeSource('window:1', '', { name: 'Discord' }),
      ])
      const service = createScreenshotService()
      expect(await service.captureWindow('Dota 2', { width: 2, height: 2 })).toBeNull()
    })

    it('returns null when the captured size deviates from the expected size', async () => {
      // Windowed mode: the window includes its frame, so it is larger than the
      // client area the caller expects
      mockGetSources.mockResolvedValue([
        makeSource('window:2', '', { name: 'Dota 2', width: 8, height: 8 }),
      ])
      const service = createScreenshotService()
      expect(await service.captureWindow('Dota 2', { width: 2, height: 2 })).toBeNull()
    })

    it('returns null instead of throwing when capture fails', async () => {
      mockGetSources.mockRejectedValue(new Error('capture backend gone'))
      const service = createScreenshotService()
      expect(await service.captureWindow('Dota 2', { width: 2, height: 2 })).toBeNull()
    })
  })
})
