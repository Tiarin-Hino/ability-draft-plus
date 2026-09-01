import type { MlModelGaps } from '@core/ml/staleness-detector'
import type { LayoutSource } from '@shared/ipc/api'

// @DEV-GUIDE: AppStore state shape and action constants for @zubridge dispatch.
// Shared between main process (appStore.setState) and renderers (useAppStore hook).
// APP_ACTIONS constants are string identifiers for dispatch:
//   dispatch({ type: APP_ACTIONS.THEME_SET_MODE, payload: 'dark' })
// Each action maps to a handler in the main process app-store.ts that calls setState().
// @zubridge automatically syncs this state across all renderer windows in real time.

export interface AppStoreState {
  // Theme
  themeMode: 'light' | 'dark' | 'system'
  resolvedDarkMode: boolean

  // Language
  language: 'en' | 'ru' | 'zh-CN'

  // Overlay
  overlayActive: boolean
  activeResolution: string | null
  activeResolutionSource: LayoutSource | null
  overlayOpacity: number
  overlayAnchor: 'left' | 'right'

  // ML Worker Status
  mlStatus: 'idle' | 'initializing' | 'ready' | 'scanning' | 'error'
  mlError: string | null

  // ML Model Gaps (staleness detection)
  mlModelGaps: MlModelGaps | null

  // Scraper Status
  scraperStatus: 'idle' | 'running' | 'error'
  scraperMessage: string | null
  scraperLastUpdated: string | null

  // Liquipedia Status (separate from Windrun scraper)
  liquipediaStatus: 'idle' | 'running' | 'error'
  liquipediaMessage: string | null
  liquipediaLastUpdated: string | null

  // Update Status
  updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  updateProgress: number | null
  updateVersion: string | null
  updateError: string | null

  // Stream server (streamer view). streamServerError carries an i18n key from the
  // 'streaming' namespace — translated in the renderer (FeedbackStatus pattern).
  streamServerStatus: 'stopped' | 'running' | 'error'
  streamServerPort: number | null
  streamServerError: string | null
  streamClientCount: number

  // Dota GSI: true while the stream server has received a POST in the last 30s
  gsiConnected: boolean
}

// Action types for @zubridge dispatch
export const APP_ACTIONS = {
  THEME_SET_MODE: 'THEME:SET_MODE',
  THEME_SET_RESOLVED: 'THEME:SET_RESOLVED',
  LANGUAGE_SET: 'LANGUAGE:SET',
  OVERLAY_SET_ACTIVE: 'OVERLAY:SET_ACTIVE',
  OVERLAY_SET_APPEARANCE: 'OVERLAY:SET_APPEARANCE',
  ML_SET_STATUS: 'ML:SET_STATUS',
  ML_SET_MODEL_GAPS: 'ML:SET_MODEL_GAPS',
  SCRAPER_SET_STATUS: 'SCRAPER:SET_STATUS',
  SCRAPER_SET_LAST_UPDATED: 'SCRAPER:SET_LAST_UPDATED',
  LIQUIPEDIA_SET_STATUS: 'LIQUIPEDIA:SET_STATUS',
  LIQUIPEDIA_SET_LAST_UPDATED: 'LIQUIPEDIA:SET_LAST_UPDATED',
  UPDATE_SET_STATUS: 'UPDATE:SET_STATUS',
} as const
