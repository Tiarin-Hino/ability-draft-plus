import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import log from 'electron-log/main'

// @DEV-GUIDE: Sentry crash reporting wrapper with no-op fallback when DSN is unconfigured.
// Only the main process SDK is used. The renderer SDK (@sentry/electron/renderer) was removed
// because its sentry-ipc:// custom protocol doesn't register correctly with electron-vite +
// Electron 40 bundling. Renderer errors are caught by ErrorBoundary and logged to electron-log.
//
// When no DSN is provided (dev without .env, or user builds without Sentry), createSentryService
// returns the noopService that silently ignores all calls. This avoids conditional checks
// throughout the codebase -- callers always get a SentryService, it just might do nothing.

const logger = log.scope('sentry')

export interface SentryService {
  isEnabled(): boolean
  captureException(error: Error, context?: Record<string, unknown>): void
  addBreadcrumb(message: string, category?: string, data?: Record<string, unknown>): void
}

const noopService: SentryService = {
  isEnabled: () => false,
  captureException: () => {},
  addBreadcrumb: () => {},
}

export function createSentryService(dsn: string | undefined): SentryService {
  if (!dsn) {
    logger.info('Sentry DSN not configured — crash reporting disabled')
    return noopService
  }

  try {
    const isPackaged = app.isPackaged
    const enabled = isPackaged || process.env.SENTRY_DEV_ENABLED === 'true'

    Sentry.init({
      dsn,
      environment: isPackaged ? 'production' : 'development',
      release: `ability-draft-plus@${app.getVersion()}`,
      enabled,
    })

    logger.info('Sentry initialized for crash reporting', { enabled })

    return {
      isEnabled: () => enabled,
      captureException(error: Error, context?: Record<string, unknown>) {
        Sentry.captureException(error, { extra: context })
      },
      addBreadcrumb(message: string, category = 'app', data?: Record<string, unknown>) {
        Sentry.addBreadcrumb({ message, category, data, level: 'info' })
      },
    }
  } catch (err) {
    logger.warn('Failed to initialize Sentry', { error: String(err) })
    return noopService
  }
}
