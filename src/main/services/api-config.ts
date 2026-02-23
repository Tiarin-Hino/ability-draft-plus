import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import { createHmac, randomBytes } from 'crypto'
import log from 'electron-log/main'

const logger = log.scope('api-config')

export interface ApiConfig {
  endpointUrl: string
  apiKey: string
  sharedSecret: string
}

/**
 * Load API configuration.
 * - Dev: reads from `.env` at project root via dotenv
 * - Production: reads from `resources/app-config.json` (generated at build time)
 * Returns null if any required key is missing.
 */
export function loadApiConfig(): ApiConfig | null {
  let endpointUrl: string | undefined
  let apiKey: string | undefined
  let sharedSecret: string | undefined

  if (app.isPackaged) {
    // Production: read from bundled app-config.json
    const configPath = join(process.resourcesPath, 'app-config.json')
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'))
      endpointUrl = data.API_ENDPOINT_URL
      apiKey = data.CLIENT_API_KEY
      sharedSecret = data.CLIENT_SHARED_SECRET
    } catch (err) {
      logger.error('Failed to load app-config.json', { error: String(err) })
    }
  } else {
    // Development: load from .env at project root
    const envPath = resolve(app.getAppPath(), '.env')
    if (existsSync(envPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('dotenv').config({ path: envPath })
    }
    endpointUrl = process.env.API_ENDPOINT_URL
    apiKey = process.env.CLIENT_API_KEY
    sharedSecret = process.env.CLIENT_SHARED_SECRET
  }

  if (!endpointUrl || !apiKey || !sharedSecret) {
    logger.warn('API configuration incomplete — screenshot submission disabled', {
      endpointUrl: endpointUrl ? 'OK' : 'MISSING',
      apiKey: apiKey ? 'OK' : 'MISSING',
      sharedSecret: sharedSecret ? 'OK' : 'MISSING',
    })
    return null
  }

  logger.info('API configuration loaded')
  return { endpointUrl, apiKey, sharedSecret }
}

/**
 * Load Sentry DSN for crash reporting.
 * Returns undefined if not configured (crash reporting will be disabled).
 */
export function loadSentryDsn(): string | undefined {
  if (app.isPackaged) {
    const configPath = join(process.resourcesPath, 'app-config.json')
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'))
      return data.SENTRY_DSN || undefined
    } catch {
      return undefined
    }
  } else {
    const envPath = resolve(app.getAppPath(), '.env')
    if (existsSync(envPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('dotenv').config({ path: envPath })
    }
    return process.env.SENTRY_DSN || undefined
  }
}

/**
 * Generate HMAC SHA256 signature for API authentication.
 * String to sign: "{METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{API_KEY}"
 */
export function generateHmacSignature(
  sharedSecret: string,
  httpMethod: string,
  requestPath: string,
  timestamp: string,
  nonce: string,
  apiKey: string,
): string {
  const stringToSign = `${httpMethod}\n${requestPath}\n${timestamp}\n${nonce}\n${apiKey}`
  return createHmac('sha256', sharedSecret).update(stringToSign).digest('hex')
}

/** Generate a random 32-char hex nonce. */
export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}
