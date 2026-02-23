import { useState, useEffect } from 'react'
import type { OverlayDataPayload } from '@shared/types'

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

  useEffect(() => {
    // Request initial data from main process (avoids did-finish-load timing race)
    window.electronApi.invoke('overlay:getInitialData').then((data) => {
      if (data) setOverlayData(data)
    })

    const unsubOverlayData = window.electronApi.on('overlay:data', (data) => {
      setOverlayData(data)
      if (data.scanData) {
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
        setScanState('error')
        setScanError(data.error)
      }
    })

    const unsubSnapshot = window.electronApi.on('feedback:snapshotStatus', (data) => {
      setSnapshotMessage(data.message)
      setSnapshotIsError(data.error ?? false)
    })

    return () => {
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
    window.electronApi.send('ml:scan', {
      heroOrder: selectedSpotHeroOrder ?? 0,
      isInitialScan,
    })
  }

  const resetOverlay = (): void => {
    setScanState('idle')
    setScanError(null)
    setSelectedSpotHeroOrder(null)
    setSelectedModelHeroOrder(null)
    setOverlayData((prev) => prev ? { ...prev, scanData: null, opCombinations: [], trapCombinations: [], heroSynergies: [], heroTraps: [], heroModels: [], heroesForMySpotUI: [] } : null)
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
