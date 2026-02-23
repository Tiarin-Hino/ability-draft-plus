import { screen } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Tracks the Dota 2 game window position/size using Win32 API calls via koffi (FFI).
// Used for two purposes:
// 1. Overlay repositioning -- in windowed mode, the overlay must match the game window bounds
// 2. Screenshot cropping -- screenshot-desktop captures the full screen; in windowed mode,
//    the ML scan must crop to the game window so JSON coords (relative to game) align correctly
//
// Returns two kinds of bounds:
// - Logical pixels (physical / DPI scale) -- for Electron BrowserWindow.setBounds()
// - Physical pixels -- for screenshot crop and resolution detection
//
// Uses lazy-loaded koffi bindings to call user32.dll: FindWindowW → GetClientRect → ClientToScreen.
// koffi type names are prefixed with "WTS_" to avoid global collisions if init is retried.
// The bindingsInitFailed flag prevents retrying after a permanent failure (e.g. missing DLL).
//
// Polling: startTracking() queries the window every 2s and fires callback only on bounds change.

const logger = log.scope('window-tracker')

export interface GameWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowTrackerService {
  /** Logical pixel bounds for Electron BrowserWindow positioning */
  getGameWindowBounds(): GameWindowBounds | null
  /** Physical pixel bounds for screenshot cropping (matches screenshot-desktop output) */
  getGameWindowPhysicalBounds(): GameWindowBounds | null
  startTracking(
    onBoundsChange: (bounds: GameWindowBounds | null) => void,
    intervalMs?: number,
  ): void
  stopTracking(): void
}

// Lazy-loaded koffi bindings — initialized on first use
let bindings: {
  FindWindowW: (className: null, windowName: string) => unknown
  GetClientRect: (hwnd: unknown, rect: Record<string, number>) => boolean
  ClientToScreen: (hwnd: unknown, point: Record<string, number>) => boolean
} | null = null

let bindingsInitFailed = false

function loadBindings(): typeof bindings {
  if (bindings) return bindings
  if (bindingsInitFailed) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')

    const user32 = koffi.load('user32.dll')

    // Use unique type names to avoid collisions if koffi types persist globally
    const RECT = koffi.struct('WTS_RECT', {
      left: 'int32_t',
      top: 'int32_t',
      right: 'int32_t',
      bottom: 'int32_t',
    })

    const POINT = koffi.struct('WTS_POINT', {
      x: 'int32_t',
      y: 'int32_t',
    })

    const HWND = koffi.pointer('WTS_HWND', koffi.opaque())

    // Define functions using array-style API to avoid string interpolation issues
    const FindWindowW = user32.func('__stdcall', 'FindWindowW', HWND, [
      'str16',
      'str16',
    ])

    const GetClientRect = user32.func('__stdcall', 'GetClientRect', 'bool', [
      HWND,
      koffi.out(koffi.pointer(RECT)),
    ])

    const ClientToScreen = user32.func(
      '__stdcall',
      'ClientToScreen',
      'bool',
      [HWND, koffi.inout(koffi.pointer(POINT))],
    )

    bindings = { FindWindowW, GetClientRect, ClientToScreen }

    logger.info('Win32 bindings loaded via koffi')
    return bindings
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to load koffi bindings', { error: msg })
    bindingsInitFailed = true
    return null
  }
}

const GAME_WINDOW_TITLE = 'Dota 2'

interface RawGameWindowBounds {
  physical: GameWindowBounds
  logical: GameWindowBounds
}

// @DEV-GUIDE: Single query to Win32 for the Dota 2 window's client area (excludes title bar).
// GetClientRect returns size relative to client origin (0,0), ClientToScreen translates to screen coords.
// Returns null if the window isn't found, has zero size, or FFI bindings failed to load.
function queryGameWindow(): RawGameWindowBounds | null {
  const b = loadBindings()
  if (!b) return null

  const hwnd = b.FindWindowW(null, GAME_WINDOW_TITLE)
  if (!hwnd) return null

  const clientRect: Record<string, number> = {}
  if (!b.GetClientRect(hwnd, clientRect)) return null

  const origin: Record<string, number> = { x: 0, y: 0 }
  if (!b.ClientToScreen(hwnd, origin)) return null

  // GetClientRect returns {left:0, top:0, right:width, bottom:height}
  const physWidth = clientRect['right'] ?? 0
  const physHeight = clientRect['bottom'] ?? 0
  const physX = origin['x'] ?? 0
  const physY = origin['y'] ?? 0

  if (physWidth <= 0 || physHeight <= 0) return null

  // Convert physical pixels → logical pixels for Electron BrowserWindow
  const dpi = screen.getPrimaryDisplay().scaleFactor
  return {
    physical: { x: physX, y: physY, width: physWidth, height: physHeight },
    logical: {
      x: Math.round(physX / dpi),
      y: Math.round(physY / dpi),
      width: Math.round(physWidth / dpi),
      height: Math.round(physHeight / dpi),
    },
  }
}

function boundsEqual(
  a: GameWindowBounds | null,
  b: GameWindowBounds | null,
): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function createWindowTrackerService(): WindowTrackerService {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let lastBounds: GameWindowBounds | null = null
  let lastRaw: RawGameWindowBounds | null = null

  return {
    getGameWindowBounds(): GameWindowBounds | null {
      const raw = queryGameWindow()
      lastRaw = raw
      return raw?.logical ?? null
    },

    getGameWindowPhysicalBounds(): GameWindowBounds | null {
      // Use cached raw from last tracking poll, or query fresh
      if (lastRaw) return lastRaw.physical
      const raw = queryGameWindow()
      return raw?.physical ?? null
    },

    startTracking(onBoundsChange, intervalMs = 2000): void {
      this.stopTracking()

      // Query immediately
      lastRaw = queryGameWindow()
      lastBounds = lastRaw?.logical ?? null
      onBoundsChange(lastBounds)

      intervalId = setInterval(() => {
        lastRaw = queryGameWindow()
        const current = lastRaw?.logical ?? null
        if (!boundsEqual(current, lastBounds)) {
          lastBounds = current
          onBoundsChange(current)
        }
      }, intervalMs)

      logger.info('Game window tracking started', { intervalMs })
    },

    stopTracking(): void {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
        lastBounds = null
        lastRaw = null
        logger.info('Game window tracking stopped')
      }
    },
  }
}
