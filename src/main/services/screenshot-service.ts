import { desktopCapturer, screen } from 'electron'
import sharp from 'sharp'
import log from 'electron-log/main'

// @DEV-GUIDE: Captures via Electron's native desktopCapturer. Two paths:
// - capture(): full primary display at PHYSICAL resolution (mapper/calibration and
//   the windowed-mode scan fallback — windowed scans crop to game bounds downstream).
// - captureWindow(title, expectedSize): a single window source by exact title —
//   the scan path for fullscreen/borderless Dota. Capturing only the game window
//   avoids the full-display Windows Graphics Capture session that hitches the game
//   (and briefly the cursor) every auto-rescan tick. Returns null when the source
//   is missing or the captured size deviates from expectedSize (e.g. windowed mode,
//   where the window includes its frame) — callers fall back to capture().
//
// PNG encoding is NOT done with NativeImage.toPNG(): that is synchronous on the
// main process thread (~100ms+ at 1440p) and froze the event loop once auto-rescan
// started running every 5s. Instead the raw BGRA bitmap is swapped to RGBA (cheap)
// and encoded by sharp on the libuv threadpool, keeping the main thread responsive.
//
// The previous screenshot-desktop implementation spawned a .bat through cmd.exe
// (issues #74/#76) — never reintroduce child-process capture.

const logger = log.scope('screenshot')

const WINDOW_SIZE_TOLERANCE_PX = 2
// Fast compression: scan screenshots are transient (worker decodes them right
// away); trading size for encode speed keeps the threadpool stall negligible.
const PNG_COMPRESSION_LEVEL = 1

export interface ScreenshotService {
  /** Full primary display at physical resolution. */
  capture(): Promise<Buffer>
  /**
   * Capture one window by exact title at the expected physical size. Null when
   * the window source is unavailable or the frame size doesn't match.
   */
  captureWindow(
    title: string,
    expectedSize: { width: number; height: number },
  ): Promise<Buffer | null>
}

/** Electron bitmaps are BGRA; sharp expects RGBA — swap in place (a few ms). */
function bgraToRgba(buffer: Buffer): Buffer {
  for (let i = 0; i < buffer.length; i += 4) {
    const blue = buffer[i]
    buffer[i] = buffer[i + 2]
    buffer[i + 2] = blue
  }
  return buffer
}

async function encodePng(thumbnail: Electron.NativeImage): Promise<Buffer> {
  const size = thumbnail.getSize()
  const raw = thumbnail.toBitmap()
  if (raw.length === 0 || size.width === 0 || size.height === 0) {
    throw new Error('Capture returned an empty image')
  }
  return sharp(bgraToRgba(raw), {
    raw: { width: size.width, height: size.height, channels: 4 },
  })
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL })
    .toBuffer()
}

export function createScreenshotService(): ScreenshotService {
  return {
    async capture(): Promise<Buffer> {
      const primary = screen.getPrimaryDisplay()
      const thumbnailSize = {
        width: Math.round(primary.size.width * primary.scaleFactor),
        height: Math.round(primary.size.height * primary.scaleFactor),
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
      })

      const source =
        sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
      if (!source) {
        throw new Error('No screen sources available for capture')
      }

      const png = await encodePng(source.thumbnail)
      logger.debug('Captured primary display', {
        sourceId: source.id,
        ...thumbnailSize,
      })
      return png
    },

    async captureWindow(title, expectedSize): Promise<Buffer | null> {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: expectedSize,
        })
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

        const png = await encodePng(source.thumbnail)
        logger.debug('Captured game window', { title, ...size })
        return png
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
