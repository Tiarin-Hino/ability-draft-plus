import { desktopCapturer, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { IpcSendMap } from '@shared/ipc/api'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { WindowManager } from './window-manager'
import {
  CAPTURE_FRAME_TIMEOUT_MS,
  CAPTURE_IDLE_STOP_MS,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: The PRIMARY scan capture path for fullscreen/borderless Dota.
// desktopCapturer.getSources() thumbnails every open window to deliver the one
// game frame — measured 730-1075ms per scan (1775ms cold, 16 windows), ~85% of
// total scan latency in the turn-driven auto-rescan flow. This service instead:
// 1. Resolves the game window's source id ONCE via a thumbnail-free getSources
//    call ({width:0,height:0} skips the per-window captures entirely).
// 2. Grabs frames from a persistent getUserMedia(chromeMediaSourceId) stream
//    living in the OVERLAY RENDERER (capture-agent.ts) — scans exist only while
//    the overlay is up, so the stream's lifetime matches naturally. Frames come
//    back as tightly-packed RGBA (the renderer's canvas normalizes whatever
//    pixel format WGC delivers); main only drops alpha.
// The renderer request/response correlation (requestId) lives here, which is
// why the capture:frameResult/sessionEnded send channels are handled in this
// service rather than in src/main/ipc/.
//
// EVERY failure returns null so scan-trigger falls back to the proven
// getSources path (screenshot-service): source not found, renderer timeout or
// error, captured size drifting from the expected physical size, or the track
// dying (game window recreated on resolution change -> renderer reports
// capture:sessionEnded and the cached id is dropped for re-resolution).
// After CAPTURE_IDLE_STOP_MS without a request the renderer stream is stopped
// so the WGC session doesn't outlive the draft; the source id stays cached.

const logger = log.scope('cached-capture')

const WINDOW_SIZE_TOLERANCE_PX = 2

type FrameResult = IpcSendMap['capture:frameResult']

export interface CachedWindowCaptureService {
  /**
   * Capture one frame of the window with this exact title at the expected
   * physical size. Null on any failure — callers fall back to the
   * screenshot-service getSources path.
   */
  captureFrame(
    title: string,
    expectedSize: { width: number; height: number },
  ): Promise<DecodedScreenshot | null>
  dispose(): void
}

/** getImageData output is tightly-packed RGBA; drop alpha in one pass. */
function rgbaToRgb(rgba: Uint8Array, width: number, height: number): Buffer {
  const rgb = Buffer.allocUnsafe(width * height * 3)
  for (let src = 0, dst = 0; dst < rgb.length; src += 4, dst += 3) {
    rgb[dst] = rgba[src]
    rgb[dst + 1] = rgba[src + 1]
    rgb[dst + 2] = rgba[src + 2]
  }
  return rgb
}

export function createCachedWindowCaptureService(
  windowManager: WindowManager,
): CachedWindowCaptureService {
  let sourceId: string | null = null
  let nextRequestId = 1
  const pending = new Map<number, (result: FrameResult) => void>()
  let idleTimer: NodeJS.Timeout | null = null

  function onFrameResult(_event: Electron.IpcMainEvent, result: FrameResult): void {
    pending.get(result.requestId)?.(result)
  }

  function onSessionEnded(): void {
    logger.debug('Renderer capture session ended — dropping cached source id')
    sourceId = null
  }

  ipcMain.on('capture:frameResult', onFrameResult)
  ipcMain.on('capture:sessionEnded', onSessionEnded)

  function sendStopToRenderer(): void {
    const overlay = windowManager.getOverlayWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('capture:stop')
    }
  }

  /** Forget the source and stop the renderer stream — next scan re-resolves. */
  function invalidate(): void {
    sourceId = null
    sendStopToRenderer()
  }

  function armIdleStop(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      logger.debug('Capture idle — stopping renderer stream')
      sendStopToRenderer()
    }, CAPTURE_IDLE_STOP_MS)
  }

  function requestFrame(
    overlay: Electron.BrowserWindow,
    id: string,
    expectedSize: { width: number; height: number },
  ): Promise<FrameResult | null> {
    return new Promise((resolve) => {
      const requestId = nextRequestId++
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve(null)
      }, CAPTURE_FRAME_TIMEOUT_MS)
      pending.set(requestId, (result) => {
        clearTimeout(timer)
        pending.delete(requestId)
        resolve(result)
      })
      overlay.webContents.send('capture:frame', {
        requestId,
        sourceId: id,
        maxWidth: expectedSize.width,
        maxHeight: expectedSize.height,
      })
    })
  }

  return {
    async captureFrame(title, expectedSize): Promise<DecodedScreenshot | null> {
      const overlay = windowManager.getOverlayWindow()
      if (!overlay || overlay.isDestroyed()) return null

      try {
        let resolveMs: number | null = null
        if (sourceId === null) {
          const start = performance.now()
          // Zero thumbnailSize skips the expensive per-window thumbnail
          // captures — this enumerates ids/titles only.
          const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: false,
          })
          resolveMs = Math.round(performance.now() - start)
          const source = sources.find((s) => s.name === title)
          if (!source) {
            logger.debug('Window source not found, falling back', {
              title,
              resolveMs,
              windowCount: sources.length,
            })
            return null
          }
          sourceId = source.id
          logger.debug('Resolved game window capture source', {
            title,
            sourceId,
            resolveMs,
            windowCount: sources.length,
          })
        }

        const grabStart = performance.now()
        const result = await requestFrame(overlay, sourceId, expectedSize)
        const grabMs = Math.round(performance.now() - grabStart)

        if (
          !result ||
          !result.ok ||
          result.data === undefined ||
          result.width === undefined ||
          result.height === undefined
        ) {
          logger.debug('Cached-source frame grab failed, falling back', {
            title,
            grabMs,
            error: result ? (result.error ?? 'malformed response') : 'timeout',
          })
          invalidate()
          return null
        }

        if (
          Math.abs(result.width - expectedSize.width) > WINDOW_SIZE_TOLERANCE_PX ||
          Math.abs(result.height - expectedSize.height) > WINDOW_SIZE_TOLERANCE_PX ||
          result.data.length < result.width * result.height * 4
        ) {
          // Windowed mode / resolution change — coordinates would misalign
          logger.debug('Cached-source capture size mismatch, falling back', {
            title,
            captured: { width: result.width, height: result.height },
            expected: expectedSize,
          })
          invalidate()
          return null
        }

        const convertStart = performance.now()
        const rgb = rgbaToRgb(result.data, result.width, result.height)
        logger.debug('Captured game window (cached source)', {
          title,
          grabMs,
          convertMs: Math.round(performance.now() - convertStart),
          ...(resolveMs !== null ? { resolveMs } : {}),
          width: result.width,
          height: result.height,
        })

        armIdleStop()
        return { data: rgb, width: result.width, height: result.height }
      } catch (error) {
        logger.warn('Cached window capture failed, falling back', {
          title,
          error: error instanceof Error ? error.message : String(error),
        })
        invalidate()
        return null
      }
    },

    dispose(): void {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      ipcMain.removeListener('capture:frameResult', onFrameResult)
      ipcMain.removeListener('capture:sessionEnded', onSessionEnded)
      pending.clear()
      sendStopToRenderer()
    },
  }
}
