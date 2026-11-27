import { useEffect } from 'react'
import {
  acquireMousePassthroughLock,
  releaseAllHoverPassthroughLocks,
} from '../hooks/use-mouse-passthrough'

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
  // Hold a ref-counted modal lock while open and clear any underlying hover locks
  // so dismissing the modal always restores click-through immediately.
  useEffect(() => {
    if (!open) return
    const releaseModal = acquireMousePassthroughLock()
    releaseAllHoverPassthroughLocks()
    return releaseModal
  }, [open])

  if (!open) return null

  return (
    <div
      className="confirm-modal-scrim overlay-interactive"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
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
