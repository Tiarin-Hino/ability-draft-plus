import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import './globals.css'

const MAX_RENDER_RETRIES = 5
const RETRY_DELAY_MS = 250

interface ErrorBoundaryState {
  failed: boolean
  retryCount: number
}

/**
 * Recovers automatically from transient multi-file Vite HMR mismatches without
 * leaving React's overlay root permanently unmounted.
 */
class OverlayErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { failed: false, retryCount: 0 }
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error('[overlay] Render error caught by boundary:', error)
    if (this.state.retryCount < MAX_RENDER_RETRIES && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.setState((prev) => ({ failed: false, retryCount: prev.retryCount + 1 }))
      }, RETRY_DELAY_MS)
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  render(): React.ReactNode {
    if (this.state.failed) return null
    return this.props.children
  }
}

/** Mounts the interactive overlay HUD (skipped in Background Mode capture hosts). */
export function mountOverlayUi(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <OverlayErrorBoundary>
        <App />
      </OverlayErrorBoundary>
    </React.StrictMode>,
  )
}
