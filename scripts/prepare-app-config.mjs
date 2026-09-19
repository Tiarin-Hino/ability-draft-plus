import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: resolve(__dirname, '../.env') })

const config = {
  API_ENDPOINT_URL: process.env.API_ENDPOINT_URL || '',
  CLIENT_API_KEY: process.env.CLIENT_API_KEY || '',
  CLIENT_SHARED_SECRET: process.env.CLIENT_SHARED_SECRET || '',
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  CLIENT_TAG: process.env.CLIENT_TAG || '',
  // Optional override; empty => the app's DEFAULT_TWITCH_EBS_URL
  TWITCH_EBS_URL: process.env.TWITCH_EBS_URL || '',
}

const OPTIONAL_KEYS = new Set(['TWITCH_EBS_URL'])

const missing = Object.entries(config)
  .filter(([k, v]) => !v && !OPTIONAL_KEYS.has(k))
  .map(([k]) => k)

if (missing.length > 0) {
  console.warn(`Warning: Missing API config keys: ${missing.join(', ')}`)
  console.warn('The built app will run without the corresponding features.')
}

const outPath = resolve(__dirname, '../resources/app-config.json')
writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf-8')
console.log('Build: resources/app-config.json generated successfully.')
