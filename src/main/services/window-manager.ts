import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'

// @DEV-GUIDE: Creates and manages the two Electron BrowserWindow instances:
// 1. Control Panel -- main app window (1000x700, resizable) with React SPA
// 2. Overlay -- transparent, frameless, always-on-top window for the game overlay
//
// Overlay uses critical Windows-specific techniques:
// - transparent: true + frame: false for full transparency
// - setAlwaysOnTop(true, 'screen-saver') to stay above fullscreen games
// - setIgnoreMouseEvents(true, { forward: true }) for OS-level click-through
// - Width shrunk by 1px to prevent Windows from treating it as fullscreen
//   (fullscreen transparent windows break mouse event forwarding after toggle)
// - showInactive() to avoid stealing focus from the game
//
// Mouse-move FORWARDING is the fragile part: hover-only elements (ability
// tooltips) never toggle click-through themselves, so they work only while
// forwarding is armed — and Windows drops it whenever the window's layered
// state is rebuilt, notably on setBounds. repositionOverlay therefore skips
// no-op moves and re-applies the flag after real ones, and callers can
// re-arm explicitly via refreshOverlayMouseEvents(). Always re-apply the
// CURRENT state; forcing ignore=true would break an in-progress hover.
//
// When overlay closes, the 'closed' event fires and main process resets overlay state
// in AppStore. The control panel auto-restores and refocuses.

const logger = log.scope('window-manager')

export interface WindowManager {
  createControlPanelWindow(): BrowserWindow
  createOverlayWindow(): BrowserWindow
  repositionOverlay(bounds: { x: number; y: number; width: number; height: number }): void
  getControlPanelWindow(): BrowserWindow | null
  getOverlayWindow(): BrowserWindow | null
  closeOverlay(): void
  setOverlayMouseEvents(ignore: boolean, forward?: boolean): void
  /** Re-applies the current click-through state (see refreshOverlayMouseEvents). */
  refreshOverlayMouseEvents(): void
}

// @DEV-GUIDE: In dev mode, electron-vite serves renderers at ELECTRON_RENDERER_URL.
// In production, renderers are bundled as static HTML files in the dist output.
function loadWindowContent(
  window: BrowserWindow,
  rendererPath: string,
): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${rendererPath}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${rendererPath}`))
  }
}

export function createWindowManager(): WindowManager {
  let controlPanelWindow: BrowserWindow | null = null
  let overlayWindow: BrowserWindow | null = null
  // Current click-through state, mirrored so it can be re-applied after window
  // operations that silently drop it (see refreshOverlayMouseEvents).
  let mouseIgnore = true
  let mouseForward = true

  function createControlPanelWindow(): BrowserWindow {
    controlPanelWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 800,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/control-panel.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    controlPanelWindow.on('ready-to-show', () => {
      controlPanelWindow?.show()
    })

    controlPanelWindow.webContents.on('render-process-gone', (_event, details) => {
      logger.error('Control panel renderer crashed', { reason: details.reason, exitCode: details.exitCode })
    })

    controlPanelWindow.on('unresponsive', () => {
      logger.warn('Control panel window became unresponsive')
    })

    controlPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    loadWindowContent(controlPanelWindow, 'control-panel/index.html')

    controlPanelWindow.on('closed', () => {
      controlPanelWindow = null
      // Close overlay when control panel closes, then quit
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close()
      }
      app.quit()
    })

    logger.info('Control panel window created')
    return controlPanelWindow
  }

  function createOverlayWindow(): BrowserWindow {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height, x, y } = primaryDisplay.bounds

    // Shrink by 1px to prevent Windows from treating this as a true fullscreen window.
    // When a transparent overlay covers the entire display, Windows stops forwarding
    // mouse events after setIgnoreMouseEvents is toggled, breaking the click-through mechanism.
    overlayWindow = new BrowserWindow({
      width: width - 1,
      height,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setVisibleOnAllWorkspaces(true)
    applyOverlayMouseEvents(true, true)
    overlayWindow.showInactive()

    loadWindowContent(overlayWindow, 'overlay/index.html')

    overlayWindow.webContents.on('render-process-gone', (_event, details) => {
      logger.error('Overlay renderer crashed', { reason: details.reason, exitCode: details.exitCode })
    })

    if (!app.isPackaged) {
      overlayWindow.webContents.openDevTools({ mode: 'detach' })
    }

    overlayWindow.on('closed', () => {
      overlayWindow = null
      if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.show()
        controlPanelWindow.focus()
      }
      logger.info('Overlay window closed')
    })

    logger.info('Overlay window created', { width, height })
    return overlayWindow
  }

  function getControlPanelWindow(): BrowserWindow | null {
    return controlPanelWindow
  }

  function getOverlayWindow(): BrowserWindow | null {
    return overlayWindow
  }

  function closeOverlay(): void {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
    }
  }

  // @DEV-GUIDE: Called by window tracker polling when the Dota 2 game window moves or resizes.
  // In windowed mode, the overlay shrinks to match the game window. In fullscreen, it covers
  // the display (minus 1px). The 1px shrink is critical — see createOverlayWindow comment.
  function repositionOverlay(bounds: { x: number; y: number; width: number; height: number }): void {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      // Prevent the overlay from covering the entire display — see createOverlayWindow comment.
      const display = screen.getPrimaryDisplay()
      const coversFullDisplay =
        bounds.x === display.bounds.x &&
        bounds.y === display.bounds.y &&
        bounds.width >= display.bounds.width &&
        bounds.height >= display.bounds.height
      const adjusted = coversFullDisplay
        ? { ...bounds, width: bounds.width - 1 }
        : bounds

      // Skip no-op moves. The tracker reports raw game-window bounds, and
      // several distinct game bounds collapse onto the SAME adjusted overlay
      // bounds (anything covering the display maps to display-minus-1px), so
      // this fired repeatedly with identical values. That churn is not free:
      // every setBounds re-creates the window's layered/transparent state on
      // Windows and drops the mouse-move FORWARDING that setIgnoreMouseEvents
      // installed — after which hover-only elements (ability tooltips) stop
      // receiving events until something toggles the flag again. Users saw
      // exactly that: tooltips dead after a scan until they clicked a button
      // (whose hover enter/leave re-applied the flag).
      const current = overlayWindow.getBounds()
      if (
        current.x === adjusted.x &&
        current.y === adjusted.y &&
        current.width === adjusted.width &&
        current.height === adjusted.height
      ) {
        return
      }

      overlayWindow.setBounds(adjusted)
      // setBounds dropped the forwarding state — put it back exactly as it was
      // (NOT unconditionally click-through: the user may be hovering a button
      // right now, which means ignore is legitimately false).
      applyOverlayMouseEvents(mouseIgnore, mouseForward)
      logger.info('Overlay repositioned', adjusted)
    }
  }

  function applyOverlayMouseEvents(ignore: boolean, forward: boolean): void {
    mouseIgnore = ignore
    mouseForward = forward
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(ignore, { forward })
    }
  }

  function setOverlayMouseEvents(ignore: boolean, forward = true): void {
    applyOverlayMouseEvents(ignore, forward)
  }

  /**
   * Re-applies the CURRENT click-through state. Mouse-move forwarding is
   * fragile on Windows — window operations can silently drop it, leaving
   * hover-only overlay elements dead. Cheap and idempotent, so callers re-arm
   * it after anything that disturbs the window (notably a completed scan,
   * which repaints the whole hotspot layer).
   */
  function refreshOverlayMouseEvents(): void {
    applyOverlayMouseEvents(mouseIgnore, mouseForward)
  }

  return {
    createControlPanelWindow,
    createOverlayWindow,
    repositionOverlay,
    getControlPanelWindow,
    getOverlayWindow,
    closeOverlay,
    setOverlayMouseEvents,
    refreshOverlayMouseEvents,
  }
}
