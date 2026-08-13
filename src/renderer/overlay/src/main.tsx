import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import App from './App'
import './globals.css'
import { initCaptureAgent } from './capture-agent'

// Cached-source scan capture lives outside React — main drives it over IPC
initCaptureAgent()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
