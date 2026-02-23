import { DEFAULT_OP_THRESHOLD, DEFAULT_TRAP_THRESHOLD } from './thresholds'
import type { AppSettings } from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  opThreshold: DEFAULT_OP_THRESHOLD,
  trapThreshold: DEFAULT_TRAP_THRESHOLD,
  language: 'en',
  themeMode: 'system',
}

export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const APP_ID = 'com.tiarinhino.dota2abilitydraftplus'
export const APP_NAME = 'Dota 2 Ability Draft Plus'
