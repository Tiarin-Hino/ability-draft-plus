import { useEffect } from 'react'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'

interface ConfirmModalProps {
  open: boolean
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  showDontShowAgain?: boolean
  onDontShowAgain?: () => void
}

export function ConfirmModal({
  open,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  showDontShowAgain,
  onDontShowAgain,
}: ConfirmModalProps): React.ReactElement | null {
  const { onMouseEnter, onMouseLeave } = useMousePassthrough()

  // Disable click-through when modal is open
  useEffect(() => {
    if (open) {
      window.electronApi.send('overlay:setMouseIgnore', { ignore: false })
    }
    return () => {
      if (open) {
        window.electronApi.send('overlay:setMouseIgnore', {
          ignore: true,
          forward: true,
        })
      }
    }
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
        <p id="confirm-modal-title" className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-buttons">
          <button className="overlay-btn overlay-btn-green" onClick={onConfirm}>
            {confirmLabel}
          </button>
          {showDontShowAgain && onDontShowAgain && (
            <button className="overlay-btn overlay-btn-gray" onClick={onDontShowAgain}>
              {cancelLabel}
            </button>
          )}
          {!showDontShowAgain && (
            <button className="overlay-btn overlay-btn-gray" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
