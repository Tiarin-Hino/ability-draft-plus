import { useState, useEffect, useRef } from 'react'
import type { OverlayDataPayload } from '@shared/types'
import i18n from '../i18n'

// Safety net: if main never responds (hung enrichment, dead worker), unstick the UI.
// Generous because a scan may include a lazy ML re-init (up to ~30s worst case).
const SCAN_TIMEOUT_MS = 30_000

// @DEV-GUIDE: Central state hook for the overlay. Manages all overlay-related state:
// - overlayData: Enriched scan results (OverlayDataPayload) from main process
// - scanState: State machine (idle -> scanning -> scanned | error)
// - selectedSpotHeroOrder / selectedModelHeroOrder: User's My Spot / My Model picks
// - snapshotMessage: Feedback from screenshot submission
//
// Listens to IPC channels: overlay:data, draft:selectMySpot, draft:selectMyModel,
// ml:scanResults, feedback:snapshotStatus. Returns triggerScan() and resetOverlay() actions.
//
// On mount, requests overlay:getInitialData from main to avoid race condition
// (overlay window may mount before first overlay:data push arrives).

export type ScanState = 'idle' | 'scanning' | 'scanned' | 'error'

export interface OverlayState {
  overlayData: OverlayDataPayload | null
  selectedSpotHeroOrder: number | null
  selectedModelHeroOrder: number | null
  scanState: ScanState
  scanError: string | null
  snapshotMessage: string | null
  snapshotIsError: boolean
}

export function useOverlayData(): OverlayState & {
  triggerScan: (isInitialScan: boolean) => void
  resetOverlay: () => void
} {
  const [overlayData, setOverlayData] = useState<OverlayDataPayload | null>(null)
  const [selectedSpotHeroOrder, setSelectedSpotHeroOrder] = useState<number | null>(null)
  const [selectedModelHeroOrder, setSelectedModelHeroOrder] = useState<number | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanError, setScanError] = useState<string | null>(null)
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null)
  const [snapshotIsError, setSnapshotIsError] = useState(false)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearScanTimeout = (): void => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current)
      scanTimeoutRef.current = null
    }
  }

  useEffect(() => {
    // Request initial data from main process (avoids did-finish-load timing race)
    window.electronApi.invoke('overlay:getInitialData').then((data) => {
      if (data) setOverlayData(data)
    })

    const unsubOverlayData = window.electronApi.on('overlay:data', (data) => {
      setOverlayData(data)
      if (data.scanData) {
        clearScanTimeout()
        setScanState('scanned')
        setScanError(null)
      }
      // Sync selections from payload
      if (data.selectedHeroForDraftingDbId !== undefined) {
        // Resolve hero order from heroesForMySpotUI
        if (data.selectedHeroForDraftingDbId === null) {
          setSelectedSpotHeroOrder(null)
        } else {
          const hero = data.heroesForMySpotUI.find(
            (h) => h.dbHeroId === data.selectedHeroForDraftingDbId,
          )
          if (hero) setSelectedSpotHeroOrder(hero.heroOrder)
        }
      }
      if (data.selectedModelHeroOrder !== undefined) {
        setSelectedModelHeroOrder(data.selectedModelHeroOrder)
      }
    })

    const unsubSpot = window.electronApi.on('draft:selectMySpot', (data) => {
      setSelectedSpotHeroOrder(data.selectedHeroOrderForDrafting)
    })

    const unsubModel = window.electronApi.on('draft:selectMyModel', (data) => {
      setSelectedModelHeroOrder(data.selectedModelHeroOrder)
    })

    const unsubScanResults = window.electronApi.on('ml:scanResults', (data) => {
      if (data.error) {
        clearScanTimeout()
        setScanState('error')
        setScanError(data.error)
      }
    })

    const unsubSnapshot = window.electronApi.on('feedback:snapshotStatus', (data) => {
      setSnapshotMessage(i18n.t(data.messageKey, data.params))
      setSnapshotIsError(data.error ?? false)
    })

    return () => {
      clearScanTimeout()
      unsubOverlayData()
      unsubSpot()
      unsubModel()
      unsubScanResults()
      unsubSnapshot()
    }
  }, [])

  const triggerScan = (isInitialScan: boolean): void => {
    if (!overlayData) {
      console.warn('[overlay] triggerScan called but overlayData is null — initial data not received yet')
      return
    }
    setScanState('scanning')
    setScanError(null)
    clearScanTimeout()
    scanTimeoutRef.current = setTimeout(() => {
      scanTimeoutRef.current = null
      setScanState('error')
      setScanError(i18n.t('status.timeoutMessage'))
    }, SCAN_TIMEOUT_MS)
    // CRITICAL: the scanning state hides all overlay decorations (capture-mode CSS).
    // Wait two frames so the compositor has actually painted their removal before
    // main captures the screen — otherwise shimmer borders end up INSIDE the
    // cropped icons and borderline classes drop below the confidence threshold
    // (this made previously-recognized top-pick abilities scan as Unknown).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.electronApi.send('ml:scan', {
          heroOrder: selectedSpotHeroOrder ?? 0,
          isInitialScan,
        })
      })
    })
  }

  const resetOverlay = (): void => {
    clearScanTimeout()
    setScanState('idle')
    setScanError(null)
    setSelectedSpotHeroOrder(null)
    setSelectedModelHeroOrder(null)
    setOverlayData((prev) => prev ? { ...prev, scanData: null, opCombinations: [], trapCombinations: [], heroSynergies: [], heroTraps: [], heroModels: [], heroesForMySpotUI: [] } : null)
    // Clear the main-process draft session too, so a later Rescan doesn't diff
    // against this draft's cached pool.
    window.electronApi.send('overlay:reset')
  }

  return {
    overlayData,
    selectedSpotHeroOrder,
    selectedModelHeroOrder,
    scanState,
    scanError,
    snapshotMessage,
    snapshotIsError,
    triggerScan,
    resetOverlay,
  }
}
