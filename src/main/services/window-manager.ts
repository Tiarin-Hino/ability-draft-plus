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
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
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

      overlayWindow.setBounds(adjusted)
      logger.info('Overlay repositioned', adjusted)
    }
  }

  function setOverlayMouseEvents(ignore: boolean, forward = true): void {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(ignore, { forward })
    }
  }

  return {
    createControlPanelWindow,
    createOverlayWindow,
    repositionOverlay,
    getControlPanelWindow,
    getOverlayWindow,
    closeOverlay,
    setOverlayMouseEvents,
  }
}
