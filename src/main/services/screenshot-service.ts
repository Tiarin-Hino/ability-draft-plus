import screenshot from 'screenshot-desktop'
import log from 'electron-log/main'
import {
  SCREENSHOT_CACHE_TTL,
  SCREENSHOT_PREFETCH_INTERVAL,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Captures full-screen screenshots via the screenshot-desktop npm package (PNG format).
// Implements a simple cache with SCREENSHOT_CACHE_TTL (2s) to avoid redundant captures when
// multiple scan requests come in rapid succession.
//
// Prefetch mechanism: startPrefetch() begins periodic captures at SCREENSHOT_PREFETCH_INTERVAL
// so a fresh screenshot is always available in cache when a scan is triggered. This reduces
// perceived latency for the user because the screenshot is already captured before they click scan.
//
// The returned Buffer is the full screen; windowed-mode cropping happens in ml-handlers.ts.

const logger = log.scope('screenshot')

export interface ScreenshotService {
  capture(forceCapture?: boolean): Promise<Buffer>
  startPrefetch(): void
  stopPrefetch(): void
  clearCache(): void
}

export function createScreenshotService(): ScreenshotService {
  let cachedBuffer: Buffer | null = null
  let cacheTimestamp = 0
  let prefetchTimer: ReturnType<typeof setInterval> | null = null

  async function captureAndCache(): Promise<Buffer> {
    const buffer = (await screenshot({ format: 'png' })) as Buffer
    cachedBuffer = buffer
    cacheTimestamp = Date.now()
    return buffer
  }

  async function capture(forceCapture = false): Promise<Buffer> {
    const now = Date.now()
    if (
      !forceCapture &&
      cachedBuffer &&
      now - cacheTimestamp < SCREENSHOT_CACHE_TTL
    ) {
      return cachedBuffer
    }
    return captureAndCache()
  }

  function startPrefetch(): void {
    if (prefetchTimer) return
    logger.debug('Starting screenshot prefetch')
    captureAndCache().catch((err) =>
      logger.warn('Prefetch capture failed', { error: String(err) }),
    )
    prefetchTimer = setInterval(() => {
      captureAndCache().catch((err) =>
        logger.warn('Prefetch capture failed', { error: String(err) }),
      )
    }, SCREENSHOT_PREFETCH_INTERVAL)
  }

  function stopPrefetch(): void {
    if (prefetchTimer) {
      clearInterval(prefetchTimer)
      prefetchTimer = null
      logger.debug('Stopped screenshot prefetch')
    }
  }

  function clearCache(): void {
    cachedBuffer = null
    cacheTimestamp = 0
  }

  return { capture, startPrefetch, stopPrefetch, clearCache }
}
