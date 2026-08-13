import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CAPTURE_FRAME_TIMEOUT_MS,
  CAPTURE_IDLE_STOP_MS,
} from '@shared/constants/thresholds'

// Mock electron's desktopCapturer + ipcMain
const mockGetSources = vi.fn()
const ipcListeners = new Map<string, (...args: unknown[]) => void>()
vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: (...args: unknown[]) => mockGetSources(...args),
  },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, listener)
    },
    removeListener: (channel: string) => {
      ipcListeners.delete(channel)
    },
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

import { createCachedWindowCaptureService } from '../../../../src/main/services/cached-window-capture-service'
import type { CachedWindowCaptureService } from '../../../../src/main/services/cached-window-capture-service'
import type { WindowManager } from '../../../../src/main/services/window-manager'

/** RGBA frame: every pixel R=30, G=20, B=10, A=255. */
function makeRgbaFrame(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 30
    data[i + 1] = 20
    data[i + 2] = 10
    data[i + 3] = 255
  }
  return data
}

interface SentFrameRequest {
  requestId: number
  sourceId: string
  maxWidth: number
  maxHeight: number
}

describe('CachedWindowCaptureService', () => {
  const mockSend = vi.fn()
  let overlayDestroyed = false
  let overlayExists = true
  const windowManager = {
    getOverlayWindow: () =>
      overlayExists
        ? { isDestroyed: () => overlayDestroyed, webContents: { send: mockSend } }
        : null,
  } as unknown as WindowManager

  let service: CachedWindowCaptureService

  /** Wires webContents.send('capture:frame') to synchronously answer like the renderer. */
  function autoRespond(
    responder: (req: SentFrameRequest) => Record<string, unknown> | null,
  ): void {
    mockSend.mockImplementation((channel: string, req: SentFrameRequest) => {
      if (channel !== 'capture:frame') return
      const reply = responder(req)
      if (reply) {
        ipcListeners.get('capture:frameResult')?.({}, { requestId: req.requestId, ...reply })
      }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ipcListeners.clear()
    overlayDestroyed = false
    overlayExists = true
    mockGetSources.mockResolvedValue([
      { id: 'window:1:0', name: 'Discord' },
      { id: 'window:2:0', name: 'Dota 2' },
    ])
    service = createCachedWindowCaptureService(windowManager)
  })

  afterEach(() => {
    service.dispose()
    vi.useRealTimers()
  })

  it('resolves the source id thumbnail-free, grabs a frame, and converts RGBA to RGB', async () => {
    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))

    const raw = await service.captureFrame('Dota 2', { width: 2, height: 2 })

    expect(mockGetSources).toHaveBeenCalledWith({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    const frameRequest = mockSend.mock.calls.find(([c]) => c === 'capture:frame')
    expect(frameRequest?.[1]).toMatchObject({
      sourceId: 'window:2:0',
      maxWidth: 2,
      maxHeight: 2,
    })
    expect(raw).not.toBeNull()
    expect(raw?.width).toBe(2)
    expect(raw?.height).toBe(2)
    expect(raw?.data.length).toBe(2 * 2 * 3)
    // RGBA (30,20,10,255) comes out as RGB (30,20,10) — alpha dropped
    expect(raw?.data[0]).toBe(30)
    expect(raw?.data[1]).toBe(20)
    expect(raw?.data[2]).toBe(10)
  })

  it('reuses the cached source id — getSources runs once across scans', async () => {
    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))

    await service.captureFrame('Dota 2', { width: 2, height: 2 })
    await service.captureFrame('Dota 2', { width: 2, height: 2 })

    expect(mockGetSources).toHaveBeenCalledTimes(1)
  })

  it('returns null when the window title is not among the sources', async () => {
    mockGetSources.mockResolvedValue([{ id: 'window:1:0', name: 'Discord' }])
    expect(await service.captureFrame('Dota 2', { width: 2, height: 2 })).toBeNull()
    expect(mockSend).not.toHaveBeenCalledWith('capture:frame', expect.anything())
  })

  it('returns null without touching getSources when the overlay window is gone', async () => {
    overlayExists = false
    expect(await service.captureFrame('Dota 2', { width: 2, height: 2 })).toBeNull()
    expect(mockGetSources).not.toHaveBeenCalled()
  })

  it('invalidates the cached id on a renderer error and re-resolves next scan', async () => {
    autoRespond(() => ({ ok: false, error: 'stream died' }))
    expect(await service.captureFrame('Dota 2', { width: 2, height: 2 })).toBeNull()
    // Failure sends capture:stop to the renderer
    expect(mockSend).toHaveBeenCalledWith('capture:stop')

    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))
    expect(await service.captureFrame('Dota 2', { width: 2, height: 2 })).not.toBeNull()
    expect(mockGetSources).toHaveBeenCalledTimes(2)
  })

  it('returns null when the captured size deviates from the expected size', async () => {
    autoRespond(() => ({ ok: true, width: 8, height: 8, data: makeRgbaFrame(8, 8) }))
    expect(await service.captureFrame('Dota 2', { width: 2, height: 2 })).toBeNull()
  })

  it('accepts a size within the 2px tolerance', async () => {
    autoRespond(() => ({ ok: true, width: 4, height: 3, data: makeRgbaFrame(4, 3) }))
    const raw = await service.captureFrame('Dota 2', { width: 3, height: 2 })
    expect(raw?.width).toBe(4)
  })

  it('times out and returns null when the renderer never responds', async () => {
    vi.useFakeTimers()
    autoRespond(() => null)

    const promise = service.captureFrame('Dota 2', { width: 2, height: 2 })
    await vi.advanceTimersByTimeAsync(CAPTURE_FRAME_TIMEOUT_MS + 1)

    expect(await promise).toBeNull()
  })

  it('drops the cached id when the renderer reports the session ended', async () => {
    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))
    await service.captureFrame('Dota 2', { width: 2, height: 2 })

    ipcListeners.get('capture:sessionEnded')?.({})

    await service.captureFrame('Dota 2', { width: 2, height: 2 })
    expect(mockGetSources).toHaveBeenCalledTimes(2)
  })

  it('stops the renderer stream after the idle period', async () => {
    vi.useFakeTimers()
    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))
    await service.captureFrame('Dota 2', { width: 2, height: 2 })

    expect(mockSend).not.toHaveBeenCalledWith('capture:stop')
    await vi.advanceTimersByTimeAsync(CAPTURE_IDLE_STOP_MS + 1)
    expect(mockSend).toHaveBeenCalledWith('capture:stop')
  })

  it('a scan within the idle period re-arms the idle stop', async () => {
    vi.useFakeTimers()
    autoRespond(() => ({ ok: true, width: 2, height: 2, data: makeRgbaFrame(2, 2) }))

    await service.captureFrame('Dota 2', { width: 2, height: 2 })
    await vi.advanceTimersByTimeAsync(CAPTURE_IDLE_STOP_MS - 1000)
    await service.captureFrame('Dota 2', { width: 2, height: 2 })
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockSend).not.toHaveBeenCalledWith('capture:stop')
  })

  it('dispose unregisters the ipc listeners', () => {
    expect(ipcListeners.has('capture:frameResult')).toBe(true)
    expect(ipcListeners.has('capture:sessionEnded')).toBe(true)
    service.dispose()
    expect(ipcListeners.has('capture:frameResult')).toBe(false)
    expect(ipcListeners.has('capture:sessionEnded')).toBe(false)
  })
})
