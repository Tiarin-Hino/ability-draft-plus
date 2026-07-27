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

function makeSource(id: string, displayId: string, png: Buffer) {
  return {
    id,
    display_id: displayId,
    thumbnail: { toPNG: () => png },
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
    mockGetSources.mockResolvedValue([
      makeSource('screen:42', '42', Buffer.from('primary-png')),
    ])
  })

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

  it('returns the PNG buffer of the primary display source', async () => {
    const service = createScreenshotService()
    const result = await service.capture()
    expect(result).toEqual(Buffer.from('primary-png'))
  })

  it('selects the source matching the primary display id among several', async () => {
    mockGetSources.mockResolvedValue([
      makeSource('screen:7', '7', Buffer.from('secondary-png')),
      makeSource('screen:42', '42', Buffer.from('primary-png')),
    ])

    const service = createScreenshotService()
    const result = await service.capture()
    expect(result).toEqual(Buffer.from('primary-png'))
  })

  it('falls back to the first source when no display id matches', async () => {
    mockGetSources.mockResolvedValue([
      makeSource('screen:7', '', Buffer.from('only-png')),
    ])

    const service = createScreenshotService()
    const result = await service.capture()
    expect(result).toEqual(Buffer.from('only-png'))
  })

  it('throws when no screen sources are available', async () => {
    mockGetSources.mockResolvedValue([])

    const service = createScreenshotService()
    await expect(service.capture()).rejects.toThrow('No screen sources')
  })

  it('throws when the capture produces an empty image', async () => {
    mockGetSources.mockResolvedValue([
      makeSource('screen:42', '42', Buffer.alloc(0)),
    ])

    const service = createScreenshotService()
    await expect(service.capture()).rejects.toThrow('empty image')
  })
})
