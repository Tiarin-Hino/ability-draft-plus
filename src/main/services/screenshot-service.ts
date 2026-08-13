import { desktopCapturer, screen } from 'electron'
import log from 'electron-log/main'
import type { DecodedScreenshot } from '@core/ml/preprocessing'

// @DEV-GUIDE: Captures via Electron's native desktopCapturer. Two paths:
// - capture(): full primary display at PHYSICAL resolution (mapper/calibration and
//   the windowed-mode scan fallback — windowed scans crop to game bounds downstream).
// - captureWindow(title, expectedSize): a single window source by exact title —
//   the scan FALLBACK for fullscreen/borderless Dota (the primary path is
//   cached-window-capture-service, which avoids the per-scan getSources
//   enumeration measured at 730-1075ms). Capturing only the game window
//   avoids the full-display Windows Graphics Capture session that hitches the game
//   (and briefly the cursor) every auto-rescan tick. Returns null when the source
//   is missing or the captured size deviates from expectedSize (e.g. windowed mode,
//   where the window includes its frame) — callers fall back to capture().
//
// Output is a RAW RGB bitmap ({data,width,height}), NOT PNG: the scan pipeline used
// to PNG-encode here (~70ms) only for the ML worker to decode it again (~75ms).
// Raw goes straight to the worker as a transferred ArrayBuffer; consumers that
// genuinely need PNG (feedback snapshots, the mapper IPC) encode lazily themselves.
// The BGRA->RGB conversion drops alpha in the same single pass as the channel swap.
//
// Known noise: getSources() thumbnails EVERY window, and Chromium logs a stderr
// "Failed to start capture" for non-capturable ones (e.g. the minimized control
// panel) before the game window succeeds — Electron exposes no per-source filter.
// The debug timing log below keeps that enumeration cost measurable.
//
// The previous screenshot-desktop implementation spawned a .bat through cmd.exe
// (issues #74/#76) — never reintroduce child-process capture.

const logger = log.scope('screenshot')

const WINDOW_SIZE_TOLERANCE_PX = 2

export interface ScreenshotService {
  /** Full primary display at physical resolution, as a raw RGB bitmap. */
  capture(): Promise<DecodedScreenshot>
  /**
   * Capture one window by exact title at the expected physical size. Null when
   * the window source is unavailable or the frame size doesn't match.
   */
  captureWindow(
    title: string,
    expectedSize: { width: number; height: number },
  ): Promise<DecodedScreenshot | null>
}

/** Electron bitmaps are BGRA; convert to 3-channel RGB in one pass. */
function bgraToRgb(bgra: Buffer, width: number, height: number): Buffer {
  const rgb = Buffer.allocUnsafe(width * height * 3)
  for (let src = 0, dst = 0; src < bgra.length; src += 4, dst += 3) {
    rgb[dst] = bgra[src + 2]
    rgb[dst + 1] = bgra[src + 1]
    rgb[dst + 2] = bgra[src]
  }
  return rgb
}

function toRawScreenshot(thumbnail: Electron.NativeImage): DecodedScreenshot {
  const size = thumbnail.getSize()
  const bgra = thumbnail.toBitmap()
  if (bgra.length === 0 || size.width === 0 || size.height === 0) {
    throw new Error('Capture returned an empty image')
  }
  return {
    data: bgraToRgb(bgra, size.width, size.height),
    width: size.width,
    height: size.height,
  }
}

export function createScreenshotService(): ScreenshotService {
  return {
    async capture(): Promise<DecodedScreenshot> {
      const primary = screen.getPrimaryDisplay()
      const thumbnailSize = {
        width: Math.round(primary.size.width * primary.scaleFactor),
        height: Math.round(primary.size.height * primary.scaleFactor),
      }

      const start = performance.now()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
      })
      const getSourcesMs = Math.round(performance.now() - start)

      const source =
        sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
      if (!source) {
        throw new Error('No screen sources available for capture')
      }

      const raw = toRawScreenshot(source.thumbnail)
      logger.debug('Captured primary display', {
        sourceId: source.id,
        getSourcesMs,
        ...thumbnailSize,
      })
      return raw
    },

    async captureWindow(title, expectedSize): Promise<DecodedScreenshot | null> {
      try {
        const start = performance.now()
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: expectedSize,
        })
        const getSourcesMs = Math.round(performance.now() - start)

        const source = sources.find((s) => s.name === title)
        if (!source) {
          logger.debug('Window source not found, falling back', { title })
          return null
        }

        const size = source.thumbnail.getSize()
        if (
          Math.abs(size.width - expectedSize.width) > WINDOW_SIZE_TOLERANCE_PX ||
          Math.abs(size.height - expectedSize.height) > WINDOW_SIZE_TOLERANCE_PX
        ) {
          // Windowed mode (frame included) or unexpected scaling — coordinates
          // would misalign; let the caller use the screen path instead.
          logger.debug('Window capture size mismatch, falling back', {
            title,
            captured: size,
            expected: expectedSize,
          })
          return null
        }

        const convertStart = performance.now()
        const raw = toRawScreenshot(source.thumbnail)
        logger.debug('Captured game window', {
          title,
          getSourcesMs,
          convertMs: Math.round(performance.now() - convertStart),
          windowCount: sources.length,
          ...size,
        })
        return raw
      } catch (error) {
        logger.warn('Window capture failed, falling back to screen', {
          title,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    },
  }
}
