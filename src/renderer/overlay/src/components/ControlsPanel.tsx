import { useTranslation } from 'react-i18next'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import type { ScanState } from '../hooks/use-overlay-data'

interface ControlsPanelProps {
  scanState: ScanState
  onInitialScan: () => void
  onRescan: () => void
  onReset: () => void
  onClose: () => void
  onReportFailed: () => void
}

export function ControlsPanel({
  scanState,
  onInitialScan,
  onRescan,
  onReset,
  onClose,
  onReportFailed,
}: ControlsPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()

  const isScanning = scanState === 'scanning'
  const hasScanned = scanState === 'scanned' || scanState === 'error'

  return (
    <div
      className="controls-panel overlay-interactive"
      role="toolbar"
      aria-label="Overlay Controls"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="controls-button-group">
        {!hasScanned && (
          <button
            className="overlay-btn overlay-btn-purple"
            onClick={onInitialScan}
            disabled={isScanning}
          >
            {t('initialScan')}
          </button>
        )}

        {hasScanned && (
          <>
            <button
              className="overlay-btn overlay-btn-green"
              onClick={onRescan}
              disabled={isScanning}
            >
              {t('rescan')}
            </button>
            <button
              className="overlay-btn overlay-btn-yellow"
              onClick={onReset}
            >
              {t('reset')}
            </button>
          </>
        )}

        <button className="overlay-btn overlay-btn-red" onClick={onClose}>
          {t('close')}
        </button>
      </div>

      {hasScanned && (
        <button
          className="overlay-btn overlay-btn-orange"
          onClick={onReportFailed}
          disabled={isScanning}
        >
          {t('reportFailed')}
        </button>
      )}
    </div>
  )
}
