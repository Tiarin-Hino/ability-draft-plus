import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import './globals.css'

/** Mounts the interactive overlay HUD (skipped in Background Mode capture hosts). */
export function mountOverlayUi(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
