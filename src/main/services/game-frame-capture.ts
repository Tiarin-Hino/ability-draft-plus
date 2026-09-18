import { screen } from 'electron'
import sharp from 'sharp'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { ScreenshotService } from './screenshot-service'
import type { CachedWindowCaptureService } from './cached-window-capture-service'
import { GAME_WINDOW_TITLE, type WindowTrackerService } from './window-tracker-service'

// @DEV-GUIDE: The one way to grab a GAME-RELATIVE Dota frame, shared by draft scans
// and in-game top-bar seat identification.
// - Fullscreen Dota: the cached WGC frame first (fast, but it lives in the overlay
//   renderer, so it returns null once the overlay is closed), then a
//   desktopCapturer window grab from the main process, then the whole primary
//   display.
// - Windowed Dota: the primary display, cropped to the game window's physical
//   bounds, so layout coordinates (relative to the game window) line up.

export interface GameFrame {
  /** Game-relative raw RGB frame. */
  screenshot: DecodedScreenshot
  /** When the pixels were captured (before any downstream processing). */
  capturedAtMs: number
}

export function createGameFrameCapture(
  screenshotService: ScreenshotService,
  cachedWindowCapture: CachedWindowCaptureService,
  windowTracker: WindowTrackerService,
): () => Promise<GameFrame> {
  return async function captureGameFrame(): Promise<GameFrame> {
    const primary = screen.getPrimaryDisplay()
    const physicalScreen = {
      width: Math.round(primary.size.width * primary.scaleFactor),
      height: Math.round(primary.size.height * primary.scaleFactor),
    }
    const gameBounds = windowTracker.getGameWindowPhysicalBounds()
    const isFullscreen =
      !gameBounds ||
      (gameBounds.width >= physicalScreen.width && gameBounds.height >= physicalScreen.height)

    // Capture cascade: cached-source frame grab (persistent renderer stream,
    // ~10-50ms) -> per-call getSources window capture (~1s) -> full-display
    // capture. Each step returns null to hand off downward.
    let screenshot: DecodedScreenshot | null = null
    if (isFullscreen) {
      screenshot = await cachedWindowCapture.captureFrame(GAME_WINDOW_TITLE, physicalScreen)
      screenshot ??= await screenshotService.captureWindow(GAME_WINDOW_TITLE, physicalScreen)
    }
    screenshot ??= await screenshotService.capture()
    const capturedAtMs = Date.now()

    // Windowed: crop the display frame to the game window
    if (
      gameBounds &&
      (gameBounds.width < screenshot.width || gameBounds.height < screenshot.height)
    ) {
      const cropped = await sharp(screenshot.data, {
        raw: { width: screenshot.width, height: screenshot.height, channels: 3 },
      })
        .extract({
          left: gameBounds.x,
          top: gameBounds.y,
          width: gameBounds.width,
          height: gameBounds.height,
        })
        .raw()
        .toBuffer()
      screenshot = { data: cropped, width: gameBounds.width, height: gameBounds.height }
    }
    return { screenshot, capturedAtMs }
  }
}
