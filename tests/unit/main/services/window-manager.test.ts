import { describe, it, expect, vi, beforeEach } from 'vitest'

type EventHandler = (...args: unknown[]) => void

interface MockBrowserWindowInstance {
  options: Record<string, unknown>
  destroyed: boolean
  bounds: { x: number; y: number; width: number; height: number }
  emit: (event: string, ...args: unknown[]) => void
  on: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  webContents: {
    emit: (event: string, ...args: unknown[]) => void
    on: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    openDevTools: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

const createdWindows: MockBrowserWindowInstance[] = []
const mockQuit = vi.fn()

function createMockWindow(options: Record<string, unknown>): MockBrowserWindowInstance {
  const winListeners = new Map<string, EventHandler[]>()
  const wcListeners = new Map<string, EventHandler[]>()

  const emitWin = (event: string, ...args: unknown[]): void => {
    for (const cb of winListeners.get(event) ?? []) {
      cb(...args)
    }
  }
  const emitWc = (event: string, ...args: unknown[]): void => {
    for (const cb of wcListeners.get(event) ?? []) {
      cb(...args)
    }
  }

  const instance: MockBrowserWindowInstance = {
    options,
    destroyed: false,
    bounds: {
      x: (options.x as number | undefined) ?? 0,
      y: (options.y as number | undefined) ?? 0,
      width: (options.width as number | undefined) ?? 800,
      height: (options.height as number | undefined) ?? 600,
    },
    emit: emitWin,
    on: vi.fn((event: string, cb: EventHandler) => {
      const list = winListeners.get(event) ?? []
      list.push(cb)
      winListeners.set(event, list)
    }),
    show: vi.fn(),
    focus: vi.fn(),
    showInactive: vi.fn(),
    close: vi.fn(() => {
      if (!instance.destroyed) {
        instance.destroyed = true
        emitWin('closed')
      }
    }),
    destroy: vi.fn(() => {
      if (!instance.destroyed) {
        instance.destroyed = true
        emitWin('closed')
      }
    }),
    isDestroyed: vi.fn(() => instance.destroyed),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    getBounds: vi.fn(() => ({ ...instance.bounds })),
    setBounds: vi.fn((next: { x: number; y: number; width: number; height: number }) => {
      instance.bounds = { ...next }
    }),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    webContents: {
      emit: emitWc,
      on: vi.fn((event: string, cb: EventHandler) => {
        const list = wcListeners.get(event) ?? []
        list.push(cb)
        wcListeners.set(event, list)
      }),
      reload: vi.fn(),
      openDevTools: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
  }

  createdWindows.push(instance)
  return instance
}

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    quit: () => mockQuit(),
  },
  BrowserWindow: class MockBrowserWindow {
    constructor(options: Record<string, unknown>) {
      return createMockWindow(options) as unknown as MockBrowserWindow
    }
  },
  screen: {
    getPrimaryDisplay: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

import { createWindowManager } from '../../../../src/main/services/window-manager'

describe('WindowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWindows.length = 0
  })

  it('creates visible fullscreen transparent overlay shrunk by 1px and re-arms click-through forwarding', () => {
    const wm = createWindowManager()
    wm.createControlPanelWindow()
    const cp = createdWindows[0]

    wm.createOverlayWindow({ visible: true })
    const overlay = createdWindows[1]

    expect(overlay.options).toMatchObject({
      width: 1919,
      height: 1080,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      skipTaskbar: true,
    })
    expect(wm.isOverlayVisible()).toBe(true)
    expect(overlay.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(overlay.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true)
    expect(overlay.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(overlay.showInactive).toHaveBeenCalledTimes(1)
    expect(overlay.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/overlay[\\/]index\.html$/),
      undefined,
    )

    overlay.setIgnoreMouseEvents.mockClear()
    wm.repositionOverlay({ x: 10, y: 20, width: 1600, height: 900 })
    expect(overlay.setBounds).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 1600,
      height: 900,
    })
    expect(overlay.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })

    overlay.setIgnoreMouseEvents.mockClear()
    wm.refreshOverlayMouseEvents()
    expect(overlay.setIgnoreMouseEvents).toHaveBeenNthCalledWith(1, false, { forward: true })
    expect(overlay.setIgnoreMouseEvents).toHaveBeenNthCalledWith(2, true, { forward: true })

    wm.closeOverlay()
    expect(cp.show).toHaveBeenCalledTimes(1)
    expect(cp.focus).toHaveBeenCalledTimes(1)
    expect(wm.isOverlayVisible()).toBe(false)
  })

  it('suppresses control panel restore when closeOverlay requests suppression', () => {
    const wm = createWindowManager()
    wm.createControlPanelWindow()
    const cp = createdWindows[0]
    wm.createOverlayWindow({ visible: true })

    wm.closeOverlay({ suppressControlPanelRestore: true })
    expect(cp.show).not.toHaveBeenCalled()
    expect(cp.focus).not.toHaveBeenCalled()
  })

  it('creates a minimal non-transparent background capture window with mouse/reposition no-ops', () => {
    const wm = createWindowManager()
    wm.createControlPanelWindow()
    const cp = createdWindows[0]

    wm.createOverlayWindow({ visible: false })
    const bg = createdWindows[1]

    expect(bg.options).toMatchObject({
      width: 100,
      height: 100,
      show: false,
      frame: true,
      transparent: false,
      focusable: false,
      skipTaskbar: true,
    })
    expect(wm.isOverlayVisible()).toBe(false)
    expect(bg.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(bg.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(bg.showInactive).not.toHaveBeenCalled()
    expect(bg.loadFile).toHaveBeenCalledWith(expect.stringMatching(/overlay[\\/]index\.html$/), {
      query: { background: '1' },
    })

    wm.repositionOverlay({ x: 0, y: 0, width: 1280, height: 720 })
    wm.setOverlayMouseEvents(false, true)
    wm.refreshOverlayMouseEvents()
    expect(bg.setBounds).not.toHaveBeenCalled()
    expect(bg.setIgnoreMouseEvents).not.toHaveBeenCalled()

    const onClosed = vi.fn()
    wm.onOverlayClosed(onClosed)
    wm.closeOverlay()
    expect(cp.show).not.toHaveBeenCalled()
    expect(cp.focus).not.toHaveBeenCalled()
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('recycles the background capture window without firing session close or restoring control panel', () => {
    const wm = createWindowManager()
    wm.createControlPanelWindow()
    const cp = createdWindows[0]
    const onClosed = vi.fn()
    wm.onOverlayClosed(onClosed)

    wm.createOverlayWindow({ visible: false })
    const firstBg = createdWindows[1]

    wm.recycleBackgroundOverlay()
    const secondBg = createdWindows[2]

    expect(firstBg.destroy).toHaveBeenCalledTimes(1)
    expect(wm.getOverlayWindow()).toBe(secondBg as unknown)
    expect(wm.isOverlayVisible()).toBe(false)
    expect(secondBg.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/overlay[\\/]index\.html$/),
      { query: { background: '1' } },
    )
    expect(onClosed).not.toHaveBeenCalled()
    expect(cp.show).not.toHaveBeenCalled()

    // No-op when a visible overlay is open
    wm.createOverlayWindow({ visible: true })
    const beforeCount = createdWindows.length
    wm.recycleBackgroundOverlay()
    expect(createdWindows.length).toBe(beforeCount)
  })

  it('auto-reloads crashed renderer processes up to 3 attempts', () => {
    const wm = createWindowManager()
    wm.createOverlayWindow({ visible: false })
    const bg = createdWindows[0]

    for (let i = 0; i < 4; i++) {
      bg.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1073807364 })
    }
    expect(bg.webContents.reload).toHaveBeenCalledTimes(3)

    // clean-exit never triggers reload
    wm.createOverlayWindow({ visible: false })
    const freshBg = createdWindows[1]
    freshBg.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    expect(freshBg.webContents.reload).not.toHaveBeenCalled()
  })
})
