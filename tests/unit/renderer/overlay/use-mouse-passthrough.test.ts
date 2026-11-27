// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, fireEvent } from '@testing-library/react'
import { ConfirmModal } from '../../../../src/renderer/overlay/src/components/ConfirmModal'

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
let releaseAllHoverPassthroughLocks: typeof import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough').releaseAllHoverPassthroughLocks
let resetMousePassthroughForTests: typeof import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough').resetMousePassthroughForTests

describe('useMousePassthrough', () => {
  beforeEach(async () => {
    mockSend.mockClear()
    const mod = await import('../../../../src/renderer/overlay/src/hooks/use-mouse-passthrough')
    useMousePassthrough = mod.useMousePassthrough
    acquireMousePassthroughLock = mod.acquireMousePassthroughLock
    releaseAllHoverPassthroughLocks = mod.releaseAllHoverPassthroughLocks
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

  it('releases lock immediately when enabled flips to false without unmounting', () => {
    const hook = renderHook(({ enabled }) => useMousePassthrough(enabled), {
      initialProps: { enabled: true },
    })

    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    hook.rerender({ enabled: false })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })

    // Further enters while disabled are ignored
    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('releaseAllHoverPassthroughLocks clears hover locks, preserves modal locks, and lets hooks re-acquire', () => {
    const hook = renderHook(() => useMousePassthrough())

    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    releaseAllHoverPassthroughLocks()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })

    // Same hook can re-acquire on next hover
    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    // Modal lock survives releaseAllHoverPassthroughLocks
    const releaseModal = acquireMousePassthroughLock()
    releaseAllHoverPassthroughLocks()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    releaseModal()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })

  it('ConfirmModal never leaks hover lock when open toggles true -> false while mounted', () => {
    const underlyingControl = renderHook(() => useMousePassthrough())
    underlyingControl.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    const { rerender, container, unmount } = render(
      createElement(ConfirmModal, {
        open: true,
        message: 'Confirm?',
        confirmLabel: 'Proceed',
        cancelLabel: 'Cancel',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    )

    const scrim = container.querySelector('.confirm-modal-scrim')
    expect(scrim).not.toBeNull()
    fireEvent.mouseEnter(scrim!)

    rerender(
      createElement(ConfirmModal, {
        open: false,
        message: 'Confirm?',
        confirmLabel: 'Proceed',
        cancelLabel: 'Cancel',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
    )

    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
    unmount()
  })

  it('pointermove reconciler releases stale hover locks over non-interactive areas unless dragging or modal-locked', () => {
    const interactiveEl = document.createElement('div')
    interactiveEl.className = 'overlay-interactive'
    const childEl = document.createElement('button')
    interactiveEl.appendChild(childEl)
    const emptyEl = document.createElement('div')
    document.body.append(interactiveEl, emptyEl)

    try {
      const hook = renderHook(() => useMousePassthrough())
      hook.result.current.onMouseEnter()
      expect(mockSend).toHaveBeenCalledTimes(1)

      // Moving over interactive descendant keeps capture active
      const overChild = new MouseEvent('pointermove', { bubbles: true, buttons: 0 })
      childEl.dispatchEvent(overChild)
      expect(mockSend).toHaveBeenCalledTimes(1)

      // Dragging (buttons !== 0) over empty area keeps capture active
      const draggingOverEmpty = new MouseEvent('pointermove', { bubbles: true, buttons: 1 })
      emptyEl.dispatchEvent(draggingOverEmpty)
      expect(mockSend).toHaveBeenCalledTimes(1)

      // Modal lock protects against pointermove over empty area
      const releaseModal = acquireMousePassthroughLock()
      const overEmptyWithModal = new MouseEvent('pointermove', { bubbles: true, buttons: 0 })
      emptyEl.dispatchEvent(overEmptyWithModal)
      expect(mockSend).toHaveBeenCalledTimes(1)
      releaseModal()

      // Moving with buttons=0 over non-interactive area reconciles stale hover lock
      hook.result.current.onMouseEnter()
      mockSend.mockClear()
      const overEmpty = new MouseEvent('pointermove', { bubbles: true, buttons: 0 })
      emptyEl.dispatchEvent(overEmpty)
      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
        ignore: true,
        forward: true,
      })
    } finally {
      interactiveEl.remove()
      emptyEl.remove()
    }
  })

  it('window blur releases stale hover locks when no modal lock is active', () => {
    const hook = renderHook(() => useMousePassthrough())
    hook.result.current.onMouseEnter()
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', { ignore: false })

    window.dispatchEvent(new Event('blur'))
    expect(mockSend).toHaveBeenLastCalledWith('overlay:setMouseIgnore', {
      ignore: true,
      forward: true,
    })
  })
})
