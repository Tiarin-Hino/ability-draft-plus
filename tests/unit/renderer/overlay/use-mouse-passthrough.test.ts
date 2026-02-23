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

describe('useMousePassthrough', () => {
  beforeEach(async () => {
    mockSend.mockClear()
    const mod = await import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough')
    useMousePassthrough = mod.useMousePassthrough
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
})
