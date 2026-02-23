// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OverlayDataPayload } from '@shared/types'

// --- Mock window.electronApi ---

type Listener = (data: unknown) => void
const channelListeners: Record<string, Listener[]> = {}

function mockOn(channel: string, cb: Listener): () => void {
  if (!channelListeners[channel]) channelListeners[channel] = []
  channelListeners[channel].push(cb)
  return () => {
    const arr = channelListeners[channel]
    const idx = arr.indexOf(cb)
    if (idx >= 0) arr.splice(idx, 1)
  }
}

const mockSend = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: globalThis,
  writable: true,
})

const mockInvoke = vi.fn().mockResolvedValue(null)

;(globalThis as Record<string, unknown>).electronApi = {
  on: mockOn,
  send: mockSend,
  invoke: mockInvoke,
}

// Import hook AFTER mocking window.electronApi
let useOverlayData: typeof import('../../../../src/renderer/overlay/src/hooks/use-overlay-data').useOverlayData

function emit(channel: string, data: unknown): void {
  for (const cb of channelListeners[channel] ?? []) {
    cb(data)
  }
}

function makeOverlayPayload(overrides: Partial<OverlayDataPayload> = {}): OverlayDataPayload {
  return {
    initialSetup: false,
    scanData: null,
    targetResolution: '1920x1080',
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels: [],
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedModelHeroOrder: null,
    heroesCoords: [],
    heroesParams: { width: 358, height: 170 },
    modelsCoords: [],
    ...overrides,
  }
}

describe('useOverlayData', () => {
  beforeEach(async () => {
    // Clear all listeners
    for (const key of Object.keys(channelListeners)) {
      channelListeners[key] = []
    }
    mockSend.mockClear()
    mockInvoke.mockClear()
    mockInvoke.mockResolvedValue(null)

    // Dynamic import to ensure mock is in place
    const mod = await import('../../../../src/renderer/overlay/src/hooks/use-overlay-data')
    useOverlayData = mod.useOverlayData
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useOverlayData())

    expect(result.current.overlayData).toBeNull()
    expect(result.current.selectedSpotHeroOrder).toBeNull()
    expect(result.current.selectedModelHeroOrder).toBeNull()
    expect(result.current.scanState).toBe('idle')
    expect(result.current.scanError).toBeNull()
    expect(result.current.snapshotMessage).toBeNull()
    expect(result.current.snapshotIsError).toBe(false)
  })

  it('requests initial data via invoke on mount', () => {
    renderHook(() => useOverlayData())

    expect(mockInvoke).toHaveBeenCalledWith('overlay:getInitialData')
  })

  it('sets overlayData from initial invoke response', async () => {
    const payload = makeOverlayPayload()
    mockInvoke.mockResolvedValue(payload)

    const { result } = renderHook(() => useOverlayData())

    // Wait for the async invoke to resolve
    await vi.waitFor(() => {
      expect(result.current.overlayData).toEqual(payload)
    })
  })

  it('subscribes to all IPC channels on mount', () => {
    renderHook(() => useOverlayData())

    expect(channelListeners['overlay:data']?.length).toBe(1)
    expect(channelListeners['draft:selectMySpot']?.length).toBe(1)
    expect(channelListeners['draft:selectMyModel']?.length).toBe(1)
    expect(channelListeners['ml:scanResults']?.length).toBe(1)
    expect(channelListeners['feedback:snapshotStatus']?.length).toBe(1)
  })

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useOverlayData())

    unmount()

    expect(channelListeners['overlay:data']?.length).toBe(0)
    expect(channelListeners['draft:selectMySpot']?.length).toBe(0)
    expect(channelListeners['draft:selectMyModel']?.length).toBe(0)
    expect(channelListeners['ml:scanResults']?.length).toBe(0)
    expect(channelListeners['feedback:snapshotStatus']?.length).toBe(0)
  })

  describe('overlay:data listener', () => {
    it('updates overlayData on overlay:data event', () => {
      const { result } = renderHook(() => useOverlayData())
      const payload = makeOverlayPayload()

      act(() => emit('overlay:data', payload))

      expect(result.current.overlayData).toEqual(payload)
    })

    it('sets scanState to scanned when scanData is present', () => {
      const { result } = renderHook(() => useOverlayData())
      const payload = makeOverlayPayload({
        scanData: {
          ultimates: [],
          standard: [],
          selectedAbilities: [],
        },
      })

      act(() => emit('overlay:data', payload))

      expect(result.current.scanState).toBe('scanned')
      expect(result.current.scanError).toBeNull()
    })

    it('does not change scanState when scanData is null (initial setup)', () => {
      const { result } = renderHook(() => useOverlayData())
      const payload = makeOverlayPayload({ initialSetup: true, scanData: null })

      act(() => emit('overlay:data', payload))

      expect(result.current.scanState).toBe('idle')
    })

    it('syncs selectedSpotHeroOrder from payload hero match', () => {
      const { result } = renderHook(() => useOverlayData())
      const payload = makeOverlayPayload({
        selectedHeroForDraftingDbId: 42,
        heroesForMySpotUI: [
          { heroOrder: 3, heroName: 'npc_dota_hero_axe', dbHeroId: 42 },
          { heroOrder: 7, heroName: 'npc_dota_hero_lina', dbHeroId: 55 },
        ],
      })

      act(() => emit('overlay:data', payload))

      expect(result.current.selectedSpotHeroOrder).toBe(3)
    })

    it('clears selectedSpotHeroOrder when selectedHeroForDraftingDbId is null', () => {
      const { result } = renderHook(() => useOverlayData())

      // First select a hero
      act(() =>
        emit(
          'overlay:data',
          makeOverlayPayload({
            selectedHeroForDraftingDbId: 42,
            heroesForMySpotUI: [
              { heroOrder: 3, heroName: 'npc_dota_hero_axe', dbHeroId: 42 },
            ],
          }),
        ),
      )
      expect(result.current.selectedSpotHeroOrder).toBe(3)

      // Then clear it
      act(() =>
        emit(
          'overlay:data',
          makeOverlayPayload({
            selectedHeroForDraftingDbId: null,
            heroesForMySpotUI: [],
          }),
        ),
      )
      expect(result.current.selectedSpotHeroOrder).toBeNull()
    })

    it('syncs selectedModelHeroOrder from payload', () => {
      const { result } = renderHook(() => useOverlayData())
      const payload = makeOverlayPayload({ selectedModelHeroOrder: 5 })

      act(() => emit('overlay:data', payload))

      expect(result.current.selectedModelHeroOrder).toBe(5)
    })
  })

  describe('draft:selectMySpot listener', () => {
    it('updates selectedSpotHeroOrder', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() =>
        emit('draft:selectMySpot', { selectedHeroOrderForDrafting: 7 }),
      )

      expect(result.current.selectedSpotHeroOrder).toBe(7)
    })

    it('clears selectedSpotHeroOrder with null', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() =>
        emit('draft:selectMySpot', { selectedHeroOrderForDrafting: 5 }),
      )
      act(() =>
        emit('draft:selectMySpot', { selectedHeroOrderForDrafting: null }),
      )

      expect(result.current.selectedSpotHeroOrder).toBeNull()
    })
  })

  describe('draft:selectMyModel listener', () => {
    it('updates selectedModelHeroOrder', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() =>
        emit('draft:selectMyModel', { selectedModelHeroOrder: 10 }),
      )

      expect(result.current.selectedModelHeroOrder).toBe(10)
    })
  })

  describe('ml:scanResults listener', () => {
    it('sets scanState to error on error message', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() => emit('ml:scanResults', { error: 'ML model failed' }))

      expect(result.current.scanState).toBe('error')
      expect(result.current.scanError).toBe('ML model failed')
    })

    it('does not change state when no error', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() => emit('ml:scanResults', { results: [], isInitialScan: true }))

      expect(result.current.scanState).toBe('idle')
      expect(result.current.scanError).toBeNull()
    })
  })

  describe('feedback:snapshotStatus listener', () => {
    it('updates snapshot message', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() =>
        emit('feedback:snapshotStatus', { message: 'Snapshot saved!' }),
      )

      expect(result.current.snapshotMessage).toBe('Snapshot saved!')
      expect(result.current.snapshotIsError).toBe(false)
    })

    it('updates snapshot error state', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() =>
        emit('feedback:snapshotStatus', {
          message: 'Failed to save',
          error: true,
        }),
      )

      expect(result.current.snapshotMessage).toBe('Failed to save')
      expect(result.current.snapshotIsError).toBe(true)
    })
  })

  describe('triggerScan', () => {
    it('sends ml:scan IPC and sets scanState to scanning', () => {
      const { result } = renderHook(() => useOverlayData())

      // Must have overlayData first
      act(() => emit('overlay:data', makeOverlayPayload()))

      act(() => result.current.triggerScan(true))

      expect(result.current.scanState).toBe('scanning')
      expect(mockSend).toHaveBeenCalledWith('ml:scan', {
        heroOrder: 0,
        isInitialScan: true,
      })
    })

    it('uses selectedSpotHeroOrder in scan request', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() => emit('overlay:data', makeOverlayPayload()))
      act(() =>
        emit('draft:selectMySpot', { selectedHeroOrderForDrafting: 4 }),
      )

      act(() => result.current.triggerScan(false))

      expect(mockSend).toHaveBeenCalledWith('ml:scan', {
        heroOrder: 4,
        isInitialScan: false,
      })
    })

    it('does nothing when overlayData is null', () => {
      const { result } = renderHook(() => useOverlayData())

      act(() => result.current.triggerScan(true))

      expect(result.current.scanState).toBe('idle')
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('resetOverlay', () => {
    it('resets scan state and selections', () => {
      const { result } = renderHook(() => useOverlayData())

      // Set up some state
      act(() =>
        emit(
          'overlay:data',
          makeOverlayPayload({
            scanData: { ultimates: [], standard: [], selectedAbilities: [] },
          }),
        ),
      )
      act(() =>
        emit('draft:selectMySpot', { selectedHeroOrderForDrafting: 3 }),
      )
      act(() =>
        emit('draft:selectMyModel', { selectedModelHeroOrder: 7 }),
      )

      // Now reset
      act(() => result.current.resetOverlay())

      expect(result.current.scanState).toBe('idle')
      expect(result.current.scanError).toBeNull()
      expect(result.current.selectedSpotHeroOrder).toBeNull()
      expect(result.current.selectedModelHeroOrder).toBeNull()
      expect(result.current.overlayData?.scanData).toBeNull()
      expect(result.current.overlayData?.opCombinations).toEqual([])
    })
  })
})
