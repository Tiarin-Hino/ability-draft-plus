import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock screenshot-desktop
const mockScreenshot = vi.fn()
vi.mock('screenshot-desktop', () => ({
  default: (...args: unknown[]) => mockScreenshot(...args),
}))

// Mock electron-log
vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  },
}))

import { createScreenshotService } from '../../../../src/main/services/screenshot-service'

describe('ScreenshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockScreenshot.mockResolvedValue(Buffer.from('screenshot-data'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('capture', () => {
    it('captures a screenshot on first call', async () => {
      const service = createScreenshotService()
      const result = await service.capture()

      expect(mockScreenshot).toHaveBeenCalledWith({ format: 'png' })
      expect(result).toEqual(Buffer.from('screenshot-data'))
    })

    it('returns cached screenshot within TTL', async () => {
      const service = createScreenshotService()

      await service.capture()
      vi.advanceTimersByTime(1000) // Within 2s TTL
      const result = await service.capture()

      expect(mockScreenshot).toHaveBeenCalledTimes(1) // Only one actual capture
      expect(result).toEqual(Buffer.from('screenshot-data'))
    })

    it('captures new screenshot after TTL expires', async () => {
      const service = createScreenshotService()

      await service.capture()
      vi.advanceTimersByTime(2100) // Past 2s TTL

      const newBuffer = Buffer.from('new-screenshot')
      mockScreenshot.mockResolvedValueOnce(newBuffer)
      const result = await service.capture()

      expect(mockScreenshot).toHaveBeenCalledTimes(2)
      expect(result).toEqual(newBuffer)
    })

    it('bypasses cache when forceCapture is true', async () => {
      const service = createScreenshotService()

      await service.capture()
      const result = await service.capture(true)

      expect(mockScreenshot).toHaveBeenCalledTimes(2)
      expect(result).toBeDefined()
    })
  })

  describe('prefetch', () => {
    it('starts background capture interval', async () => {
      const service = createScreenshotService()
      service.startPrefetch()

      // Initial capture + interval
      await vi.advanceTimersByTimeAsync(0)
      expect(mockScreenshot).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1500)
      expect(mockScreenshot).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1500)
      expect(mockScreenshot).toHaveBeenCalledTimes(3)

      service.stopPrefetch()
    })

    it('does not start multiple prefetch timers', async () => {
      const service = createScreenshotService()
      service.startPrefetch()
      service.startPrefetch() // Second call should be no-op

      await vi.advanceTimersByTimeAsync(0)
      expect(mockScreenshot).toHaveBeenCalledTimes(1)

      service.stopPrefetch()
    })

    it('stops prefetch cleanly', async () => {
      const service = createScreenshotService()
      service.startPrefetch()

      await vi.advanceTimersByTimeAsync(0)
      expect(mockScreenshot).toHaveBeenCalledTimes(1)

      service.stopPrefetch()

      await vi.advanceTimersByTimeAsync(3000)
      expect(mockScreenshot).toHaveBeenCalledTimes(1) // No more captures
    })
  })

  describe('clearCache', () => {
    it('clears cached screenshot', async () => {
      const service = createScreenshotService()

      await service.capture()
      service.clearCache()

      await service.capture()
      expect(mockScreenshot).toHaveBeenCalledTimes(2)
    })
  })
})
