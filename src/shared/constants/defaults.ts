import {
  DEFAULT_OP_THRESHOLD,
  DEFAULT_TRAP_THRESHOLD,
  DEFAULT_STREAM_PORT,
  AUTO_INITIAL_SCAN_DELAY_S,
} from './thresholds'
import type { AppSettings } from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  opThreshold: DEFAULT_OP_THRESHOLD,
  trapThreshold: DEFAULT_TRAP_THRESHOLD,
  language: 'en',
  themeMode: 'system',
  overlayOpacity: 1,
  overlayAnchor: 'right',
  streamPort: DEFAULT_STREAM_PORT,
  streamAutostart: false,
  experimentalAutoDraftTracking: false,
  overlayAutoCloseEnabled: true,
  autoInitialScanDelayS: AUTO_INITIAL_SCAN_DELAY_S,
  roleMode: 'off',
  roleFixedPositions: [],
}

export const SUPPORTED_LANGUAGES = [
  'en',
  'ru',
  'zh-CN',
  'es',
  'pt-BR',
  'uk',
  'fil',
  'fi',
] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/** Display data for language pickers: `short` for compact triggers, `autonym`
 *  for menus. Autonyms are the language's own name - identical in every UI
 *  language by design, so they live here rather than in locale files. */
export const LANGUAGE_META: Record<SupportedLanguage, { short: string; autonym: string }> = {
  en: { short: 'EN', autonym: 'English' },
  ru: { short: 'RU', autonym: 'Русский' },
  'zh-CN': { short: '中文', autonym: '简体中文' },
  es: { short: 'ES', autonym: 'Español' },
  'pt-BR': { short: 'PT', autonym: 'Português (BR)' },
  uk: { short: 'UA', autonym: 'Українська' },
  fil: { short: 'FIL', autonym: 'Filipino' },
  fi: { short: 'FI', autonym: 'Suomi' },
}

export const APP_ID = 'com.tiarinhino.dota2abilitydraftplus'
export const APP_NAME = 'Dota 2 Ability Draft Plus'

export const SUPPORT_URL = 'https://ko-fi.com/tiarinhino'
export const SUPPORT_DATDOTA_URL = 'https://ko-fi.com/datdota'
