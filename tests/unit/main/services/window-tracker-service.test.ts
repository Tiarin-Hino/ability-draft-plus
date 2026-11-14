import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScreen = vi.hoisted(() => ({
  screenToDipRect: vi.fn(),
  getDisplayMatching: vi.fn(),
  getPrimaryDisplay: vi.fn(),
}))

vi.mock('electron', () => ({
  screen: mockScreen,
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

import { physicalRectToLogical } from '../../../../src/main/services/window-tracker-service'

describe('window-tracker-service physicalRectToLogical', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScreen.getPrimaryDisplay.mockReturnValue({ scaleFactor: 1 })
    mockScreen.getDisplayMatching.mockReturnValue({ scaleFactor: 1 })
  })

  it('uses Electron screenToDipRect for multi-monitor DPI scaling', () => {
    mockScreen.screenToDipRect.mockReturnValue({
      x: 1706.6,
      y: 0,
      width: 1706.6,
      height: 960,
    })

    const logical = physicalRectToLogical({
      x: 2560,
      y: 0,
      width: 2560,
      height: 1440,
    })

    expect(mockScreen.screenToDipRect).toHaveBeenCalledWith(null, {
      x: 2560,
      y: 0,
      width: 2560,
      height: 1440,
    })
    expect(logical).toEqual({ x: 1707, y: 0, width: 1707, height: 960 })
  })

  it('falls back to getDisplayMatching scaleFactor when screenToDipRect throws', () => {
    mockScreen.screenToDipRect.mockImplementation(() => {
      throw new Error('unsupported')
    })
    mockScreen.getDisplayMatching.mockReturnValue({ scaleFactor: 1.5 })

    const logical = physicalRectToLogical({
      x: 3840,
      y: 0,
      width: 1920,
      height: 1080,
    })

    expect(logical).toEqual({ x: 2560, y: 0, width: 1280, height: 720 })
  })
})
