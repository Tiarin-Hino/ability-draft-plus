import { createStore } from 'zustand/vanilla'
import type { Handler } from '@zubridge/types'
import type { AppStoreState } from '@shared/types/app-store'
import { APP_ACTIONS } from '@shared/types/app-store'
import type { MlModelGaps } from '@core/ml/staleness-detector'

// @DEV-GUIDE: AppStore is the @zubridge-synced Zustand store shared between main and renderers.
// Shape defined in @shared/types/app-store.ts (AppStoreState). Covers:
// - Theme (mode + resolved dark boolean)
// - Language (en/ru)
// - Overlay state (active flag, resolution, source)
// - ML status (idle/initializing/scanning/ready/error, model gaps)
// - Scraper/Liquipedia status and progress
// - Auto-updater status and progress
//
// createAppStoreHandlers() maps APP_ACTIONS string constants to handler functions.
// When a renderer calls dispatch(ACTION, payload), @zubridge routes it to the matching handler.
// Handlers call store.setState() which triggers the bridge to push deltas to all windows.
//
// Main process also calls appStore.setState() directly for internal state changes
// (e.g. ML init result, scraper progress). Both paths produce the same @zubridge sync.

export function createAppStore() {
  return createStore<AppStoreState>(() => ({
    themeMode: 'system',
    resolvedDarkMode: true,
    language: 'en',
    overlayActive: false,
    activeResolution: null,
    activeResolutionSource: null,
    mlStatus: 'idle',
    mlError: null,
    mlModelGaps: null,
    scraperStatus: 'idle',
    scraperMessage: null,
    scraperLastUpdated: null,
    liquipediaStatus: 'idle',
    liquipediaMessage: null,
    liquipediaLastUpdated: null,
    updateStatus: 'idle',
    updateProgress: null,
    updateVersion: null,
    updateError: null,
  }))
}

export type AppStore = ReturnType<typeof createAppStore>

export function createAppStoreHandlers(store: AppStore): Record<string, Handler> {
  return {
    [APP_ACTIONS.THEME_SET_MODE]: (payload) => {
      const mode = payload as AppStoreState['themeMode']
      store.setState({ themeMode: mode })
    },
    [APP_ACTIONS.THEME_SET_RESOLVED]: (payload) => {
      store.setState({ resolvedDarkMode: payload as boolean })
    },
    [APP_ACTIONS.LANGUAGE_SET]: (payload) => {
      store.setState({ language: payload as AppStoreState['language'] })
    },
    [APP_ACTIONS.OVERLAY_SET_ACTIVE]: (payload) => {
      const data = payload as { active: boolean; resolution?: string }
      store.setState({
        overlayActive: data.active,
        activeResolution: data.resolution ?? null,
      })
    },
    [APP_ACTIONS.ML_SET_STATUS]: (payload) => {
      const data = payload as { status: AppStoreState['mlStatus']; error?: string }
      store.setState({ mlStatus: data.status, mlError: data.error ?? null })
    },
    [APP_ACTIONS.SCRAPER_SET_STATUS]: (payload) => {
      const data = payload as {
        status: AppStoreState['scraperStatus']
        message?: string
      }
      store.setState({
        scraperStatus: data.status,
        scraperMessage: data.message ?? null,
      })
    },
    [APP_ACTIONS.SCRAPER_SET_LAST_UPDATED]: (payload) => {
      store.setState({ scraperLastUpdated: (payload as string) ?? null })
    },
    [APP_ACTIONS.ML_SET_MODEL_GAPS]: (payload) => {
      store.setState({ mlModelGaps: (payload as MlModelGaps | null) ?? null })
    },
    [APP_ACTIONS.LIQUIPEDIA_SET_STATUS]: (payload) => {
      const data = payload as {
        status: AppStoreState['liquipediaStatus']
        message?: string
      }
      store.setState({
        liquipediaStatus: data.status,
        liquipediaMessage: data.message ?? null,
      })
    },
    [APP_ACTIONS.LIQUIPEDIA_SET_LAST_UPDATED]: (payload) => {
      store.setState({ liquipediaLastUpdated: (payload as string) ?? null })
    },
    [APP_ACTIONS.UPDATE_SET_STATUS]: (payload) => {
      const data = payload as Partial<
        Pick<AppStoreState, 'updateStatus' | 'updateProgress' | 'updateVersion' | 'updateError'>
      >
      store.setState(data)
    },
  }
}
