import { desktopCapturer, screen } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Captures the primary display via Electron's native desktopCapturer.
// The previous screenshot-desktop implementation spawned a .bat file through
// cmd.exe, which required ASAR-unpacking and produced two classes of user-facing
// scan failures: #74 ("ENOENT: no such file or directory" — unpacked script path)
// and #76 ("spawn cmd.exe ENOENT" — cmd not resolvable). Native capture has no
// child processes, no ASAR concerns, and no PATH dependency.
//
// Returns a PNG buffer of the full primary display at PHYSICAL resolution
// (thumbnailSize is requested in physical pixels so layout coordinates align).
// Windowed-mode cropping happens in ml-handlers.ts.
//
// The old TTL-cache/prefetch layer was removed with the rewrite: it was never
// enabled (startPrefetch had no callers) and both call sites force-bypassed the
// cache anyway. Native capture is fast enough to run per scan.

const logger = log.scope('screenshot')

export interface ScreenshotService {
  capture(): Promise<Buffer>
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

      const png = source.thumbnail.toPNG()
      if (png.length === 0) {
        throw new Error('Screen capture returned an empty image')
      }

      logger.debug('Captured primary display', {
        sourceId: source.id,
        ...thumbnailSize,
      })
      return png
    },
  }
}
