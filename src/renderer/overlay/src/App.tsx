import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOverlayData } from './hooks/use-overlay-data'
import { ControlsPanel } from './components/ControlsPanel'
import { ConfirmModal } from './components/ConfirmModal'
import { StatusToast } from './components/StatusToast'
import { HotspotLayer } from './components/HotspotLayer'
import { CombinationPanel } from './components/CombinationPanel'
import { DynamicButtons } from './components/DynamicButtons'
import { RolePanel } from './components/RolePanel'
import { useAppStore } from './hooks/use-app-store'
import { releaseAllHoverPassthroughLocks } from './hooks/use-mouse-passthrough'
import i18n from './i18n'

// @DEV-GUIDE: Root component for the overlay renderer. Renders on a transparent, click-through
// window on top of the Dota 2 game. Body has pointer-events: none; interactive elements opt in.
//
// Component tree:
// - HotspotLayer: Invisible rects at ability/hero positions, show tooltips on hover
// - DynamicButtons: "My Spot" / "My Model" selection buttons at hero positions
// - ControlsPanel + RolePanel + Info Chips: Horizontal top header cluster above hero cards
// - CombinationPanel (x2): Scrollable OP and Trap combination lists below the header row
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
  const [opPanelVisible, setOpPanelVisible] = useState(false)
  const [trapPanelVisible, setTrapPanelVisible] = useState(false)

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

  const escapeStateRef = useRef({
    showScanConfirm,
    showReportConfirm,
    opPanelVisible,
    trapPanelVisible,
  })
  useEffect(() => {
    escapeStateRef.current = {
      showScanConfirm,
      showReportConfirm,
      opPanelVisible,
      trapPanelVisible,
    }
  }, [showScanConfirm, showReportConfirm, opPanelVisible, trapPanelVisible])

  // Layered Escape key: close open modal -> collapse open drawer -> close overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const cur = escapeStateRef.current
      if (cur.showScanConfirm) {
        setShowScanConfirm(false)
      } else if (cur.showReportConfirm) {
        setShowReportConfirm(false)
      } else if (cur.opPanelVisible || cur.trapPanelVisible) {
        setOpPanelVisible(false)
        setTrapPanelVisible(false)
      } else {
        window.electronApi.send('overlay:close')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const hotkeyStateRef = useRef({ scanState, triggerScan })
  useEffect(() => {
    hotkeyStateRef.current = { scanState, triggerScan }
  }, [scanState, triggerScan])

  // .capture-mode hides interactive panels with visibility: hidden during scans,
  // which suppresses onMouseLeave; release any hover locks so clicks never stick.
  useEffect(() => {
    if (scanState === 'scanning') {
      releaseAllHoverPassthroughLocks()
    }
  }, [scanState])

  // Global hotkeys (subscribed once; refs avoid IPC listener churn per render).
  useEffect(() => {
    const unsub = window.electronApi.on('overlay:hotkey', ({ action }) => {
      const { scanState: currentScanState, triggerScan: runScan } = hotkeyStateRef.current
      if (currentScanState === 'scanning') return
      if (action === 'scan') {
        runScan(true)
      } else if (currentScanState === 'scanned' || currentScanState === 'error') {
        runScan(false)
      }
    })
    return unsub
  }, [])

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

  const statusVariant = scanState === 'error' ? ('error' as const) : ('info' as const)

  return (
    <div className={`overlay-root${scanState === 'scanning' ? ' capture-mode' : ''}`}>
      {/* Hotspot Layer (abilities + hero models + tooltip) */}
      {overlayData?.scanData && (
        <HotspotLayer
          overlayData={overlayData}
          selectedSpotHeroOrder={selectedSpotHeroOrder}
          selectedModelHeroOrder={selectedModelHeroOrder}
          layoutSource={activeResolutionSource}
        />
      )}

      {/* Dynamic buttons (My Spot + My Model) - z-index 9998 */}
      {overlayData?.scanData && (
        <DynamicButtons
          overlayData={overlayData}
          selectedSpotHeroOrder={selectedSpotHeroOrder}
          selectedModelHeroOrder={selectedModelHeroOrder}
          layoutSource={activeResolutionSource}
        />
      )}

      {/* Top HUD dock stacked vertically within <= 268px right/left gutter so topbar picks & Row 0/5 cards stay clear */}
      <div
        className={`top-right-column${overlayAnchor === 'left' ? ' top-right-column-left' : ''}`}
        style={{
          opacity: overlayOpacity ?? 1,
          ...(overlayAnchor === 'left' ? { left: 12 } : { right: 12 }),
        }}
      >
        <div
          className={`overlay-header-row${overlayAnchor === 'left' ? ' overlay-header-row-left' : ''}`}
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

          <div
            className={`overlay-status-cluster${overlayAnchor === 'left' ? ' overlay-status-cluster-left' : ''}`}
          >
            {/* Role-aware suggestions quick pill */}
            <RolePanel
              roleContext={overlayData?.roleContext}
              hasScanData={overlayData?.scanData != null}
              mySpotSelected={selectedSpotHeroOrder !== null}
              autoTracking={overlayData?.autoDraftTrackingEnabled ?? false}
            />

            {(activeResolution ||
              (overlayData?.scanData && poolSlots.length > 0) ||
              (overlayData && (!opPanelVisible || !trapPanelVisible))) && (
              <div className="overlay-meta-row">
                {((activeResolution && activeResolutionSource) ||
                  (overlayData?.scanData && poolSlots.length > 0)) && (
                  <div className="overlay-info-chips">
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

                    {overlayData?.scanData && poolSlots.length > 0 && (
                      <div
                        className={`scan-summary${unknownCount > 0 ? ' scan-summary-warn' : ''}`}
                      >
                        {t('scanSummary', {
                          recognized: recognizedCount,
                          total: poolSlots.length,
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsed OP / Trap toggle pills sit inline on the compact meta row */}
                {overlayData && (!opPanelVisible || !trapPanelVisible) && (
                  <div className="overlay-combo-pills">
                    {!opPanelVisible && (
                      <CombinationPanel
                        variant="op"
                        abilityCombinations={overlayData.opCombinations}
                        heroSynergies={overlayData.heroSynergies}
                        visible={false}
                        onToggle={() => {
                          setOpPanelVisible(true)
                          setTrapPanelVisible(false)
                        }}
                      />
                    )}
                    {!trapPanelVisible && (
                      <CombinationPanel
                        variant="trap"
                        abilityCombinations={overlayData.trapCombinations}
                        heroSynergies={overlayData.heroTraps}
                        visible={false}
                        onToggle={() => {
                          setTrapPanelVisible(true)
                          setOpPanelVisible(false)
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expanded combination drawer offset inward so outer Row 0/5 My Spot gutter stays clear */}
        {overlayData && (opPanelVisible || trapPanelVisible) && (
          <div className="overlay-combo-drawers">
            {opPanelVisible && (
              <CombinationPanel
                variant="op"
                abilityCombinations={overlayData.opCombinations}
                heroSynergies={overlayData.heroSynergies}
                visible={true}
                onToggle={() => setOpPanelVisible(false)}
              />
            )}
            {trapPanelVisible && (
              <CombinationPanel
                variant="trap"
                abilityCombinations={overlayData.trapCombinations}
                heroSynergies={overlayData.heroTraps}
                visible={true}
                onToggle={() => setTrapPanelVisible(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Status Toast - z-index 10001 */}
      <StatusToast message={statusMessage} variant={statusVariant} />
      <StatusToast message={snapshotMessage} variant={snapshotIsError ? 'error' : 'success'} />

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
