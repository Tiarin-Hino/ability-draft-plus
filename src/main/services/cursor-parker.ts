import { screen } from 'electron'
import log from 'electron-log/main'

// @DEV-GUIDE: Parks the mouse cursor in the bottom-right screen corner for the duration
// of an auto-rescan screenshot and restores it afterwards — in-game hover tooltips over
// ability tiles would otherwise contaminate the capture. Win32 GetCursorPos/SetCursorPos
// via koffi, lazy-loaded with the same pattern as window-tracker-service (type names
// prefixed CP_ to avoid koffi global type collisions). NO BlockInput: it requires
// elevation — the auto-rescan service avoids scanning during the user's own turn instead.
// SetCursorPos works in physical pixels; Electron's screen module provides DIP * scale.

const logger = log.scope('cursor-parker')

interface Win32CursorBindings {
  getCursorPos: (point: { x: number; y: number }) => boolean
  setCursorPos: (x: number, y: number) => boolean
}

let bindings: Win32CursorBindings | null = null
let bindingsFailed = false

function loadBindings(): Win32CursorBindings | null {
  if (bindings || bindingsFailed) return bindings
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const POINT = koffi.struct('CP_POINT', { x: 'long', y: 'long' })
    const GetCursorPos = user32.func('__stdcall', 'GetCursorPos', 'bool', [
      koffi.out(koffi.pointer(POINT)),
    ])
    const SetCursorPos = user32.func('__stdcall', 'SetCursorPos', 'bool', [
      'int',
      'int',
    ])
    bindings = {
      getCursorPos: (point) => GetCursorPos(point) as boolean,
      setCursorPos: (x, y) => SetCursorPos(x, y) as boolean,
    }
    logger.info('Win32 cursor bindings loaded via koffi')
  } catch (error) {
    bindingsFailed = true
    logger.error('Failed to load cursor bindings — auto-rescan will capture without parking', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return bindings
}

export interface CursorParker {
  /** Save the cursor position and move it to the bottom-right corner. */
  park(): void
  /** Restore the cursor to where park() found it. No-op if not parked. */
  restore(): void
}

export function createCursorParker(): CursorParker {
  let savedPosition: { x: number; y: number } | null = null

  return {
    park(): void {
      const win32 = loadBindings()
      if (!win32) return
      const point = { x: 0, y: 0 }
      if (!win32.getCursorPos(point)) return
      savedPosition = { x: point.x, y: point.y }

      const display = screen.getPrimaryDisplay()
      const physicalW = Math.round(display.size.width * display.scaleFactor)
      const physicalH = Math.round(display.size.height * display.scaleFactor)
      win32.setCursorPos(physicalW - 2, physicalH - 2)
    },

    restore(): void {
      const win32 = loadBindings()
      if (!win32 || !savedPosition) return
      win32.setCursorPos(savedPosition.x, savedPosition.y)
      savedPosition = null
    },
  }
}
