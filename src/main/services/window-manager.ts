import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import log from 'electron-log/main'

// @DEV-GUIDE: Creates and manages the two Electron BrowserWindow instances:
// 1. Control Panel -- main app window (1000x700, resizable) with React SPA
// 2. Overlay -- either:
//    a) Visible game overlay (`visible: true`): transparent, frameless, always-on-top
//       fullscreen window shrunk by 1px to preserve Windows click-through forwarding
//    b) Background capture host (`visible: false`): minimal 100x100 non-transparent
//       hidden window (`?background=1`) running only capture-agent.ts (no React UI,
//       never topmost/click-through, recycled cleanly on match boundaries via
//       `recycleBackgroundOverlay()` so Windows WGC/DWM handles do not accumulate).
//
// Overlay uses critical Windows-specific techniques (visible mode only):
// - transparent: true + frame: false for full transparency
// - setAlwaysOnTop(true, 'screen-saver') to stay above fullscreen games
// - setIgnoreMouseEvents(true, { forward: true }) for OS-level click-through
// - Width shrunk by 1px to prevent Windows from treating it as fullscreen
//   (fullscreen transparent windows break mouse event forwarding after toggle)
// - showInactive() to avoid stealing focus from the game
// - Window tracker reposition, setOverlayMouseEvents, and refreshOverlayMouseEvents
//   are strict no-ops when `!isOverlayVisible()` so background mode never arms
//   WH_MOUSE_LL hooks or transparent layered surfaces over the taskbar.
//
// Mouse-move FORWARDING is the fragile part: hover-only elements (ability
// tooltips) never toggle click-through themselves, so they work only while
// forwarding is armed — and Windows drops it whenever the window's layered
// state is rebuilt, notably on setBounds. repositionOverlay therefore skips
// no-op moves and re-applies the flag after real ones, and callers can
// re-arm explicitly via refreshOverlayMouseEvents(). Always re-apply the
// CURRENT state; forcing ignore=true would break an in-progress hover.
//
// Logical session close (`onOverlayClosed`) fires on user/OS close, closeOverlay(),
// or unrecoverable window destruction — never during internal window replacement or
// background capture recycling. Visible closes auto-restore/focus Control Panel
// unless `closeOverlay({ suppressControlPanelRestore: true })` is used.

const logger = log.scope('window-manager')

const MAX_CRASH_RECOVERIES = 3
const BACKGROUND_CAPTURE_WINDOW_SIZE = 100

export interface WindowManager {
  createControlPanelWindow(): BrowserWindow
  /** `visible: false` creates the overlay for BACKGROUND MODE — capture host only, never shown. */
  createOverlayWindow(options?: { visible?: boolean }): BrowserWindow
  repositionOverlay(bounds: { x: number; y: number; width: number; height: number }): void
  getControlPanelWindow(): BrowserWindow | null
  getOverlayWindow(): BrowserWindow | null
  isOverlayVisible(): boolean
  recycleBackgroundOverlay(): void
  onOverlayClosed(listener: () => void): () => void
  closeOverlay(options?: { suppressControlPanelRestore?: boolean }): void
  setOverlayMouseEvents(ignore: boolean, forward?: boolean): void
  /** Re-applies the current click-through state (see refreshOverlayMouseEvents). */
  refreshOverlayMouseEvents(): void
}

// @DEV-GUIDE: In dev mode, electron-vite serves renderers at ELECTRON_RENDERER_URL.
// In production, renderers are bundled as static HTML files in the dist output.
function loadWindowContent(
  window: BrowserWindow,
  rendererPath: string,
  query?: Record<string, string>,
): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${rendererPath}${search}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${rendererPath}`), query ? { query } : undefined)
  }
}

export function createWindowManager(): WindowManager {
  let controlPanelWindow: BrowserWindow | null = null
  let overlayWindow: BrowserWindow | null = null
  let overlayVisible = false
  let replacingOverlay = false
  let suppressRestoreOnNextClose = false
  let overlayCrashRecoveries = 0
  let controlPanelCrashRecoveries = 0
  const overlayClosedListeners = new Set<() => void>()
  // Current click-through state, mirrored so it can be re-applied after window
  // operations that silently drop it (see refreshOverlayMouseEvents).
  let mouseIgnore = true
  let mouseForward = true

  function createControlPanelWindow(): BrowserWindow {
    controlPanelCrashRecoveries = 0
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
      logger.error('Control panel renderer crashed', {
        reason: details.reason,
        exitCode: details.exitCode,
        recoveryAttempt: controlPanelCrashRecoveries + 1,
      })
      if (
        controlPanelWindow &&
        !controlPanelWindow.isDestroyed() &&
        details.reason !== 'clean-exit' &&
        controlPanelCrashRecoveries < MAX_CRASH_RECOVERIES
      ) {
        controlPanelCrashRecoveries += 1
        controlPanelWindow.webContents.reload()
      }
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

  function spawnOverlayBrowserWindow(visible: boolean): BrowserWindow {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      replacingOverlay = true
      try {
        overlayWindow.destroy()
      } finally {
        replacingOverlay = false
      }
      overlayWindow = null
    }

    overlayVisible = visible
    const webPreferences: Electron.WebPreferences = {
      preload: join(__dirname, '../preload/overlay.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    }

    let win: BrowserWindow
    let loggedWidth: number
    let loggedHeight: number

    if (visible) {
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height, x, y } = primaryDisplay.bounds
      loggedWidth = width
      loggedHeight = height

      // Shrink by 1px to prevent Windows from treating this as a true fullscreen window.
      // When a transparent overlay covers the entire display, Windows stops forwarding
      // mouse events after setIgnoreMouseEvents is toggled, breaking the click-through mechanism.
      win = new BrowserWindow({
        width: width - 1,
        height,
        x,
        y,
        show: false,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences,
      })
    } else {
      loggedWidth = BACKGROUND_CAPTURE_WINDOW_SIZE
      loggedHeight = BACKGROUND_CAPTURE_WINDOW_SIZE
      // Background Mode needs only an off-screen non-transparent capture host for
      // getUserMedia (no React overlay UI, no layered fullscreen DWM surface over taskbar).
      win = new BrowserWindow({
        width: BACKGROUND_CAPTURE_WINDOW_SIZE,
        height: BACKGROUND_CAPTURE_WINDOW_SIZE,
        show: false,
        frame: true,
        transparent: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences,
      })
    }

    overlayWindow = win

    win.webContents.on('render-process-gone', (_event, details) => {
      logger.error('Overlay renderer crashed', {
        reason: details.reason,
        exitCode: details.exitCode,
        visible: overlayVisible,
        recoveryAttempt: overlayCrashRecoveries + 1,
      })
      if (
        overlayWindow === win &&
        !win.isDestroyed() &&
        details.reason !== 'clean-exit' &&
        overlayCrashRecoveries < MAX_CRASH_RECOVERIES
      ) {
        overlayCrashRecoveries += 1
        win.webContents.reload()
      }
    })

    win.on('closed', () => {
      if (replacingOverlay || overlayWindow !== win) {
        return
      }
      const wasVisible = overlayVisible
      const skipRestore = suppressRestoreOnNextClose
      overlayWindow = null
      overlayVisible = false
      suppressRestoreOnNextClose = false

      if (wasVisible && !skipRestore && controlPanelWindow && !controlPanelWindow.isDestroyed()) {
        controlPanelWindow.show()
        controlPanelWindow.focus()
      }
      logger.info('Overlay window closed')
      for (const listener of [...overlayClosedListeners]) {
        listener()
      }
    })

    if (visible) {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true)
      applyOverlayMouseEvents(true, true)
      win.showInactive()
      loadWindowContent(win, 'overlay/index.html')

      // Detached devtools would be a visible window — never in background mode.
      if (!app.isPackaged) {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    } else {
      loadWindowContent(win, 'overlay/index.html', { background: '1' })
    }

    logger.info('Overlay window created', {
      width: loggedWidth,
      height: loggedHeight,
      visible,
    })
    return win
  }

  /**
   * `visible: false` is BACKGROUND MODE: creates a tiny non-transparent hidden capture
   * host (`?background=1`) running capture-agent.ts without React UI, DWM layered
   * surfaces, click-through forwarding hooks, or focus stealing.
   */
  function createOverlayWindow(options?: { visible?: boolean }): BrowserWindow {
    overlayCrashRecoveries = 0
    mouseIgnore = true
    mouseForward = true
    suppressRestoreOnNextClose = false
    return spawnOverlayBrowserWindow(options?.visible !== false)
  }

  function getControlPanelWindow(): BrowserWindow | null {
    return controlPanelWindow
  }

  function getOverlayWindow(): BrowserWindow | null {
    return overlayWindow
  }

  function isOverlayVisible(): boolean {
    return overlayVisible && overlayWindow !== null && !overlayWindow.isDestroyed()
  }

  function recycleBackgroundOverlay(): void {
    if (!overlayWindow || overlayWindow.isDestroyed() || overlayVisible) {
      return
    }
    overlayCrashRecoveries = 0
    spawnOverlayBrowserWindow(false)
    logger.info('Background capture window recycled')
  }

  function onOverlayClosed(listener: () => void): () => void {
    overlayClosedListeners.add(listener)
    return () => {
      overlayClosedListeners.delete(listener)
    }
  }

  function closeOverlay(options?: { suppressControlPanelRestore?: boolean }): void {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (options?.suppressControlPanelRestore) {
        suppressRestoreOnNextClose = true
      }
      overlayWindow.close()
    }
  }

  // @DEV-GUIDE: Called by window tracker polling when the Dota 2 game window moves or resizes.
  // In windowed mode, the overlay shrinks to match the game window. In fullscreen, it covers
  // the display (minus 1px). The 1px shrink is critical — see createOverlayWindow comment.
  function repositionOverlay(bounds: {
    x: number
    y: number
    width: number
    height: number
  }): void {
    if (!overlayVisible) return
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      // Prevent the overlay from covering the entire display — see createOverlayWindow comment.
      const display = screen.getPrimaryDisplay()
      const coversFullDisplay =
        bounds.x === display.bounds.x &&
        bounds.y === display.bounds.y &&
        bounds.width >= display.bounds.width &&
        bounds.height >= display.bounds.height
      const adjusted = coversFullDisplay ? { ...bounds, width: bounds.width - 1 } : bounds

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
    if (!overlayVisible) return
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(ignore, { forward })
    }
  }

  function setOverlayMouseEvents(ignore: boolean, forward = true): void {
    applyOverlayMouseEvents(ignore, forward)
  }

  /**
   * Re-arms mouse-move forwarding. Fragile on Windows — window operations can
   * silently drop it, leaving hover-only overlay elements dead. A same-state
   * re-apply demonstrably does NOT restore it (observed 2026-08-26: tooltips
   * stayed dead after the auto initial scan despite the post-scan refresh,
   * until a button hover toggled click-through off and back on) — so when the
   * overlay is in click-through mode this performs that full toggle CYCLE:
   * ignore off, then back on with forwarding. The off state lasts only between
   * the two synchronous calls. While the user is interacting (ignore already
   * false) the current state is simply re-applied — never yank click-through
   * off under the cursor.
   */
  function refreshOverlayMouseEvents(): void {
    if (!overlayVisible) return
    if (mouseIgnore) {
      applyOverlayMouseEvents(false, mouseForward)
      applyOverlayMouseEvents(true, mouseForward)
      return
    }
    applyOverlayMouseEvents(mouseIgnore, mouseForward)
  }

  return {
    createControlPanelWindow,
    createOverlayWindow,
    repositionOverlay,
    getControlPanelWindow,
    getOverlayWindow,
    isOverlayVisible,
    recycleBackgroundOverlay,
    onOverlayClosed,
    closeOverlay,
    setOverlayMouseEvents,
    refreshOverlayMouseEvents,
  }
}
