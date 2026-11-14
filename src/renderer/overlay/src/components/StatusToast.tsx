import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react'

interface StatusToastProps {
  message: string | null
  variant?: 'info' | 'success' | 'error'
  duration?: number
}

export function StatusToast({
  message,
  variant = 'info',
  duration = 5000,
}: StatusToastProps): React.ReactElement | null {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissedRef = useRef<string | null>(null)

  // Track "dismissed" state via a ref + external store pattern to avoid setState in effect
  const subscribersRef = useRef(new Set<() => void>())
  const subscribe = useCallback((cb: () => void) => {
    subscribersRef.current.add(cb)
    return () => {
      subscribersRef.current.delete(cb)
    }
  }, [])
  const getSnapshot = useCallback(() => dismissedRef.current, [])

  const dismissed = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (message) {
      // Reset dismissed for new messages
      dismissedRef.current = null
      subscribersRef.current.forEach((cb) => cb())

      timerRef.current = setTimeout(() => {
        dismissedRef.current = message
        subscribersRef.current.forEach((cb) => cb())
      }, duration)
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [message, duration])

  if (!message || dismissed === message) return null

  const borderColor =
    variant === 'error'
      ? 'rgba(219, 76, 76, 0.95)'
      : variant === 'success'
        ? 'rgba(46, 185, 146, 0.95)'
        : 'rgba(201, 162, 77, 0.95)'

  return (
    <div
      className="status-toast"
      role="status"
      aria-live="polite"
      style={{ borderLeftColor: borderColor }}
    >
      {message}
    </div>
  )
}
