import { useEffect } from 'react'
import { acquireMousePassthroughLock, useMousePassthrough } from '../hooks/use-mouse-passthrough'

interface ConfirmModalProps {
  open: boolean
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  dontShowLabel?: string
  onDontShowAgain?: () => void
}

export function ConfirmModal({
  open,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  dontShowLabel,
  onDontShowAgain,
}: ConfirmModalProps): React.ReactElement | null {
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()

  // Hold a ref-counted lock while modal is open so pointer exits from nested
  // controls cannot re-enable click-through until the modal closes.
  useEffect(() => {
    if (!open) return
    return acquireMousePassthroughLock()
  }, [open])

  if (!open) return null

  return (
    <div
      className="confirm-modal-scrim overlay-interactive"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="confirm-modal-card">
        <p id="confirm-modal-title" className="confirm-modal-message">
          {message}
        </p>
        <div className="confirm-modal-buttons">
          <button className="overlay-btn overlay-btn-green" onClick={onConfirm}>
            {confirmLabel}
          </button>
          {dontShowLabel && onDontShowAgain && (
            <button className="overlay-btn overlay-btn-gray" onClick={onDontShowAgain}>
              {dontShowLabel}
            </button>
          )}
          <button className="overlay-btn overlay-btn-gray" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
