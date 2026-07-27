import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useOverlayData } from './hooks/use-overlay-data'
import { ControlsPanel } from './components/ControlsPanel'
import { ConfirmModal } from './components/ConfirmModal'
import { StatusToast } from './components/StatusToast'
import { HotspotLayer } from './components/HotspotLayer'
import { CombinationPanel } from './components/CombinationPanel'
import { DynamicButtons } from './components/DynamicButtons'
import { useAppStore } from './hooks/use-app-store'
import i18n from './i18n'

// @DEV-GUIDE: Root component for the overlay renderer. Renders on a transparent, click-through
// window on top of the Dota 2 game. Body has pointer-events: none; interactive elements opt in.
//
// Component tree:
// - HotspotLayer: Invisible rects at ability/hero positions, show tooltips on hover
// - DynamicButtons: "My Spot" / "My Model" selection buttons at hero positions
// - ControlsPanel: Top-right buttons (Scan, Rescan, Reset, Report, Close)
// - CombinationPanel (x2): Scrollable OP and Trap combination lists
// - StatusToast: Scan progress/error notifications
// - ConfirmModal: Confirmation dialogs for scan and report
//
// Mouse passthrough: useMousePassthrough hook toggles setIgnoreMouseEvents via IPC
// when user hovers interactive elements. Escape key closes the overlay.

const HIDE_SCAN_CONFIRM_KEY = 'hideInitialScanConfirm'

function App(): React.ReactElement {
  const { t } = useTranslation()
  const {
    overlayData,
    selectedSpotHeroOrder,
    selectedModelHeroOrder,
    scanState,
    scanError,
    snapshotMessage,
    snapshotIsError,
    triggerScan,
    resetOverlay,
  } = useOverlayData()

  const [showScanConfirm, setShowScanConfirm] = useState(false)
  const [showReportConfirm, setShowReportConfirm] = useState(false)
  const [opPanelVisible, setOpPanelVisible] = useState(true)
  const [trapPanelVisible, setTrapPanelVisible] = useState(true)

  // Escape key closes overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.electronApi.send('overlay:close')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Sync language from @zubridge appStore
  const language = useAppStore((s) => s.language)
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language)
    }
  }, [language])

  const activeResolution = useAppStore((s) => s.activeResolution)
  const activeResolutionSource = useAppStore((s) => s.activeResolutionSource)
  const overlayOpacity = useAppStore((s) => s.overlayOpacity)
  const overlayAnchor = useAppStore((s) => s.overlayAnchor)

  // Global hotkeys (registered in main while the overlay is open). Scan skips the
  // confirmation dialog — pressing the hotkey is already an explicit intent.
  useEffect(() => {
    const unsub = window.electronApi.on('overlay:hotkey', ({ action }) => {
      if (scanState === 'scanning') return
      if (action === 'scan') {
        triggerScan(true)
      } else if (scanState === 'scanned' || scanState === 'error') {
        triggerScan(false)
      }
    })
    return unsub
  })

  const handleInitialScan = useCallback((): void => {
    const hide = localStorage.getItem(HIDE_SCAN_CONFIRM_KEY) === 'true'
    if (hide) {
      triggerScan(true)
    } else {
      setShowScanConfirm(true)
    }
  }, [triggerScan])

  const handleScanConfirmProceed = useCallback((): void => {
    setShowScanConfirm(false)
    triggerScan(true)
  }, [triggerScan])

  const handleScanConfirmDontShow = useCallback((): void => {
    localStorage.setItem(HIDE_SCAN_CONFIRM_KEY, 'true')
    setShowScanConfirm(false)
    triggerScan(true)
  }, [triggerScan])

  const handleRescan = useCallback((): void => {
    triggerScan(false)
  }, [triggerScan])

  const handleClose = useCallback((): void => {
    window.electronApi.send('overlay:close')
  }, [])

  const handleReportFailed = useCallback((): void => {
    setShowReportConfirm(true)
  }, [])

  const handleReportSubmit = useCallback((): void => {
    setShowReportConfirm(false)
    window.electronApi.send('feedback:takeSnapshot')
  }, [])

  // Scan quality summary over the initial pool (ultimates + standard)
  const poolSlots = overlayData?.scanData
    ? [...overlayData.scanData.ultimates, ...overlayData.scanData.standard]
    : []
  const unknownCount = poolSlots.filter((s) => s.isUnknown).length
  const recognizedCount = poolSlots.length - unknownCount

  // Status message for scan state
  const statusMessage =
    scanState === 'scanning'
      ? t('status.scanning')
      : scanState === 'error' && scanError
        ? t('status.error', { message: scanError })
        : null

  const statusVariant =
    scanState === 'error' ? ('error' as const) : ('info' as const)

  return (
    <div className="overlay-root">
      {/* Hotspot Layer (abilities + hero models + tooltip) */}
      {overlayData?.scanData && (
        <HotspotLayer
          overlayData={overlayData}
          selectedSpotHeroOrder={selectedSpotHeroOrder}
          selectedModelHeroOrder={selectedModelHeroOrder}
        />
      )}

      {/* Dynamic buttons (My Spot + My Model) - z-index 9998 */}
      {overlayData?.scanData && (
        <DynamicButtons
          overlayData={overlayData}
          selectedSpotHeroOrder={selectedSpotHeroOrder}
          selectedModelHeroOrder={selectedModelHeroOrder}
        />
      )}

      {/* Controls + OP/Trap panels column; side and opacity are user settings */}
      <div
        className={`top-right-column${overlayAnchor === 'left' ? ' top-right-column-left' : ''}`}
        style={{
          opacity: overlayOpacity ?? 1,
          ...(overlayAnchor === 'left' ? { left: 15 } : { right: 15 }),
        }}
      >
        {/* Controls Panel - z-index 10000 */}
        <ControlsPanel
          scanState={scanState}
          onInitialScan={handleInitialScan}
          onRescan={handleRescan}
          onReset={resetOverlay}
          onClose={handleClose}
          onReportFailed={handleReportFailed}
        />

        {/* Resolution + layout source badge */}
        {activeResolution && activeResolutionSource && (
          <div
            className={`resolution-badge${activeResolutionSource === 'auto-scaled' ? ' resolution-badge-warn' : ''}`}
            title={
              activeResolutionSource === 'auto-scaled'
                ? t('resolution.autoScaledWarning')
                : undefined
            }
          >
            {activeResolution} · {t(`resolution.source.${activeResolutionSource}`)}
          </div>
        )}

        {/* Scan quality summary */}
        {overlayData?.scanData && poolSlots.length > 0 && (
          <div className={`scan-summary${unknownCount > 0 ? ' scan-summary-warn' : ''}`}>
            {t('scanSummary', { recognized: recognizedCount, total: poolSlots.length })}
          </div>
        )}

        {/* OP Combinations Panel - z-index 9999 */}
        {overlayData && (
          <CombinationPanel
            variant="op"
            abilityCombinations={overlayData.opCombinations}
            heroSynergies={overlayData.heroSynergies}
            visible={opPanelVisible}
            onToggle={() => setOpPanelVisible((v) => !v)}
          />
        )}

        {/* Trap Combinations Panel - z-index 9999 */}
        {overlayData && (
          <CombinationPanel
            variant="trap"
            abilityCombinations={overlayData.trapCombinations}
            heroSynergies={overlayData.heroTraps}
            visible={trapPanelVisible}
            onToggle={() => setTrapPanelVisible((v) => !v)}
          />
        )}
      </div>

      {/* Status Toast - z-index 10001 */}
      <StatusToast message={statusMessage} variant={statusVariant} />
      <StatusToast
        message={snapshotMessage}
        variant={snapshotIsError ? 'error' : 'success'}
      />

      {/* Scan Confirm Modal - z-index 10005 */}
      <ConfirmModal
        open={showScanConfirm}
        message={t('scanConfirm.message')}
        confirmLabel={t('scanConfirm.proceed')}
        cancelLabel={t('scanConfirm.cancel')}
        onConfirm={handleScanConfirmProceed}
        onCancel={() => setShowScanConfirm(false)}
        dontShowLabel={t('scanConfirm.dontShow')}
        onDontShowAgain={handleScanConfirmDontShow}
      />

      {/* Report Confirm Modal - z-index 10005 */}
      <ConfirmModal
        open={showReportConfirm}
        message={t('reportConfirm.message')}
        confirmLabel={t('reportConfirm.submit')}
        cancelLabel={t('reportConfirm.cancel')}
        onConfirm={handleReportSubmit}
        onCancel={() => setShowReportConfirm(false)}
      />
    </div>
  )
}

export default App
