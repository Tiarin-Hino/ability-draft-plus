import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigPage } from '../components/config/ConfigPage'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ConfigPage />
  </StrictMode>,
)
