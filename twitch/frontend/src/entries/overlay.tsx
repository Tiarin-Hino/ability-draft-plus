import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayApp } from '../app/OverlayApp'
import { startOverlay } from '../app/bootstrap'

startOverlay()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
)
