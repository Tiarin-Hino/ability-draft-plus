import { describe, it, expect, beforeEach } from 'vitest'
import { createAppStore, createAppStoreHandlers } from '../../../../src/main/store/app-store'
import { APP_ACTIONS } from '../../../../src/shared/types/app-store'
import type { AppStoreState } from '../../../../src/shared/types/app-store'

describe('createAppStore', () => {
  it('creates store with correct default state', () => {
    const store = createAppStore()
    const state = store.getState()

    expect(state).toEqual({
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
    })
  })

  it('supports setState for direct state updates', () => {
    const store = createAppStore()
    store.setState({ overlayActive: true, activeResolution: '1920x1080' })

    const state = store.getState()
    expect(state.overlayActive).toBe(true)
    expect(state.activeResolution).toBe('1920x1080')
  })

  it('notifies subscribers on state change', () => {
    const store = createAppStore()
    const states: AppStoreState[] = []
    store.subscribe((state) => states.push(state))

    store.setState({ language: 'ru' })

    expect(states).toHaveLength(1)
    expect(states[0].language).toBe('ru')
  })
})

describe('createAppStoreHandlers', () => {
  let store: ReturnType<typeof createAppStore>
  let handlers: ReturnType<typeof createAppStoreHandlers>

  beforeEach(() => {
    store = createAppStore()
    handlers = createAppStoreHandlers(store)
  })

  it('creates handlers for all APP_ACTIONS', () => {
    for (const action of Object.values(APP_ACTIONS)) {
      expect(handlers[action]).toBeDefined()
      expect(typeof handlers[action]).toBe('function')
    }
  })

  describe('THEME_SET_MODE', () => {
    it('sets themeMode to light', () => {
      handlers[APP_ACTIONS.THEME_SET_MODE]('light')
      expect(store.getState().themeMode).toBe('light')
    })

    it('sets themeMode to dark', () => {
      handlers[APP_ACTIONS.THEME_SET_MODE]('dark')
      expect(store.getState().themeMode).toBe('dark')
    })

    it('sets themeMode to system', () => {
      handlers[APP_ACTIONS.THEME_SET_MODE]('dark')
      handlers[APP_ACTIONS.THEME_SET_MODE]('system')
      expect(store.getState().themeMode).toBe('system')
    })
  })

  describe('THEME_SET_RESOLVED', () => {
    it('sets resolvedDarkMode to false', () => {
      handlers[APP_ACTIONS.THEME_SET_RESOLVED](false)
      expect(store.getState().resolvedDarkMode).toBe(false)
    })

    it('sets resolvedDarkMode to true', () => {
      handlers[APP_ACTIONS.THEME_SET_RESOLVED](false)
      handlers[APP_ACTIONS.THEME_SET_RESOLVED](true)
      expect(store.getState().resolvedDarkMode).toBe(true)
    })
  })

  describe('LANGUAGE_SET', () => {
    it('sets language to ru', () => {
      handlers[APP_ACTIONS.LANGUAGE_SET]('ru')
      expect(store.getState().language).toBe('ru')
    })

    it('sets language to en', () => {
      handlers[APP_ACTIONS.LANGUAGE_SET]('ru')
      handlers[APP_ACTIONS.LANGUAGE_SET]('en')
      expect(store.getState().language).toBe('en')
    })
  })

  describe('OVERLAY_SET_ACTIVE', () => {
    it('activates overlay with resolution', () => {
      handlers[APP_ACTIONS.OVERLAY_SET_ACTIVE]({ active: true, resolution: '2560x1440' })
      const state = store.getState()
      expect(state.overlayActive).toBe(true)
      expect(state.activeResolution).toBe('2560x1440')
    })

    it('deactivates overlay and clears resolution', () => {
      handlers[APP_ACTIONS.OVERLAY_SET_ACTIVE]({ active: true, resolution: '1920x1080' })
      handlers[APP_ACTIONS.OVERLAY_SET_ACTIVE]({ active: false })
      const state = store.getState()
      expect(state.overlayActive).toBe(false)
      expect(state.activeResolution).toBeNull()
    })
  })

  describe('ML_SET_STATUS', () => {
    it('sets ML status to ready', () => {
      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'ready' })
      const state = store.getState()
      expect(state.mlStatus).toBe('ready')
      expect(state.mlError).toBeNull()
    })

    it('sets ML status to error with message', () => {
      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'error', error: 'Model failed to load' })
      const state = store.getState()
      expect(state.mlStatus).toBe('error')
      expect(state.mlError).toBe('Model failed to load')
    })

    it('clears error when transitioning to non-error status', () => {
      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'error', error: 'fail' })
      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'initializing' })
      const state = store.getState()
      expect(state.mlStatus).toBe('initializing')
      expect(state.mlError).toBeNull()
    })

    it('transitions through full lifecycle: idle → initializing → ready → scanning → ready', () => {
      expect(store.getState().mlStatus).toBe('idle')

      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'initializing' })
      expect(store.getState().mlStatus).toBe('initializing')

      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'ready' })
      expect(store.getState().mlStatus).toBe('ready')

      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'scanning' })
      expect(store.getState().mlStatus).toBe('scanning')

      handlers[APP_ACTIONS.ML_SET_STATUS]({ status: 'ready' })
      expect(store.getState().mlStatus).toBe('ready')
    })
  })

  describe('SCRAPER_SET_STATUS', () => {
    it('sets scraper to running with message', () => {
      handlers[APP_ACTIONS.SCRAPER_SET_STATUS]({ status: 'running', message: 'Fetching data...' })
      const state = store.getState()
      expect(state.scraperStatus).toBe('running')
      expect(state.scraperMessage).toBe('Fetching data...')
    })

    it('sets scraper to idle without message', () => {
      handlers[APP_ACTIONS.SCRAPER_SET_STATUS]({ status: 'running', message: 'Working' })
      handlers[APP_ACTIONS.SCRAPER_SET_STATUS]({ status: 'idle' })
      const state = store.getState()
      expect(state.scraperStatus).toBe('idle')
      expect(state.scraperMessage).toBeNull()
    })
  })

  describe('SCRAPER_SET_LAST_UPDATED', () => {
    it('sets last updated timestamp', () => {
      const timestamp = '2025-01-15T10:30:00Z'
      handlers[APP_ACTIONS.SCRAPER_SET_LAST_UPDATED](timestamp)
      expect(store.getState().scraperLastUpdated).toBe(timestamp)
    })
  })

  describe('UPDATE_SET_STATUS', () => {
    it('sets update available with version', () => {
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'available', updateVersion: '2.1.0' })
      const state = store.getState()
      expect(state.updateStatus).toBe('available')
      expect(state.updateVersion).toBe('2.1.0')
    })

    it('sets download progress', () => {
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'downloading', updateProgress: 45 })
      const state = store.getState()
      expect(state.updateStatus).toBe('downloading')
      expect(state.updateProgress).toBe(45)
    })

    it('sets update error', () => {
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'error', updateError: 'Network failed' })
      const state = store.getState()
      expect(state.updateStatus).toBe('error')
      expect(state.updateError).toBe('Network failed')
    })

    it('sets downloaded status', () => {
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'downloaded', updateVersion: '2.1.0' })
      const state = store.getState()
      expect(state.updateStatus).toBe('downloaded')
      expect(state.updateVersion).toBe('2.1.0')
    })

    it('performs partial update (only changes specified fields)', () => {
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'available', updateVersion: '2.1.0' })
      handlers[APP_ACTIONS.UPDATE_SET_STATUS]({ updateStatus: 'downloading', updateProgress: 10 })
      const state = store.getState()
      expect(state.updateStatus).toBe('downloading')
      expect(state.updateProgress).toBe(10)
      // Version should still be set from previous update
      expect(state.updateVersion).toBe('2.1.0')
    })
  })
})
