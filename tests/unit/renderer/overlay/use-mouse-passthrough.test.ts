// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockSend = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  writable: true,
})
;(globalThis as Record<string, unknown>).electronApi = {
  on: vi.fn(() => vi.fn()),
  send: mockSend,
  invoke: vi.fn(),
}

// Import hook AFTER mocking window.electronApi
let useMousePassthrough: typeof import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough').useMousePassthrough
let acquireMousePassthroughLock: typeof import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough').acquireMousePassthroughLock
let resetMousePassthroughForTests: typeof import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough').resetMousePassthroughForTests

describe('useMousePassthrough', () => {
  beforeEach(async () => {
    mockSend.mockClear()
    const mod = await import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough')
    useMousePassthrough = mod.useMousePassthrough
    acquireMousePassthroughLock = mod.acquireMousePassthroughLock
    resetMousePassthroughForTests = mod.resetMousePassthroughForTests
    resetMousePassthroughForTests()
  })

  it('returns onMouseEnter and onMouseLeave callbacks', () => {
    const { result } = renderHook(() => useMousePassthrough())

    expect(typeof result.current.onMouseEnter).toBe('function')
    expect(typeof result.current.onMouseLeave).toBe('function')
  })

  it('onMouseEnter sends overlay:setMouseIgnore with ignore=false', () => {
    const { result } = renderHook(() => useMousePassthrough())

    result.current.onMouseEnter()

    expect(mockSend).toHaveBeenCalledWith('overlay:setMouseIgnore', {
      ignore: false,
    })
  })

  it('onMouseLeave sends overlay:setMouseIgnore with ignore=true + forward=true', () => {
    const { result } = renderHook(() => useMousePassthrough())

    result.current.onMouseLeave()

    expect(mockSend).toHaveBeenCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })

  it('returns stable references across rerenders', () => {
    const { result, rerender } = renderHook(() => useMousePassthrough())
    const { onMouseEnter: enter1, onMouseLeave: leave1 } = result.current

    rerender()
    const { onMouseEnter: enter2, onMouseLeave: leave2 } = result.current

    expect(enter1).toBe(enter2)
    expect(leave1).toBe(leave2)
  })

  it('keeps click-through disabled while overlapping interactive elements are hovered', () => {
    const first = renderHook(() => useMousePassthrough())
    const second = renderHook(() => useMousePassthrough())

    first.result.current.onMouseEnter()
    second.result.current.onMouseEnter()

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    // Leaving only the first element must NOT re-enable click-through
    first.result.current.onMouseLeave()
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Leaving the last active element re-enables click-through
    second.result.current.onMouseLeave()
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })

  it('releases active lock automatically when hook unmounts', () => {
    const hook = renderHook(() => useMousePassthrough())

    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    hook.unmount()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })

  it('coordinates acquireMousePassthroughLock with hook hovers cleanly', () => {
    const hook = renderHook(() => useMousePassthrough())

    const releaseModal = acquireMousePassthroughLock()
    hook.result.current.onMouseEnter()
    hook.result.current.onMouseLeave()

    // Modal lock still active -> still capturing mouse
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    // Releasing modal twice is idempotent and restores passthrough once
    releaseModal()
    releaseModal()
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })
})
