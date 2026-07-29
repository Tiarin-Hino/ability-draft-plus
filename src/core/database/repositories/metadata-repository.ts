import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { metadata } from '../schema'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'

// @DEV-GUIDE: Key-value store backed by the Metadata table. Used for:
// - App settings (OP threshold, trap threshold, language) — getSettings/setSettings
// - Last successful scrape date — getLastScrapeDate/setLastScrapeDate
// - Any future app-level configuration
// All values stored as text strings; numeric settings parsed on read with defaults fallback.

export interface MetadataRepository {
  get(key: string): string | null
  set(key: string, value: string): void
  getSettings(): AppSettings
  setSettings(settings: Partial<AppSettings>): void
  getLastScrapeDate(): string | null
  setLastScrapeDate(date: string): void
}

export function createMetadataRepository(db: SQLJsDatabase): MetadataRepository {
  function get(key: string): string | null {
    const row = db.select().from(metadata).where(eq(metadata.key, key)).get()
    return row?.value ?? null
  }

  function set(key: string, value: string): void {
    db.insert(metadata)
      .values({ key, value })
      .onConflictDoUpdate({ target: metadata.key, set: { value } })
      .run()
  }

  return {
    get,
    set,

    getSettings(): AppSettings {
      const opThreshold = get('op_threshold')
      const trapThreshold = get('trap_threshold')
      const language = get('language')
      const themeMode = get('theme_mode')
      const overlayOpacity = get('overlay_opacity')
      const overlayAnchor = get('overlay_anchor')
      const streamPort = get('stream_port')
      const streamAutostart = get('stream_autostart')
      const autoDraftTracking = get('experimental_auto_draft_tracking')

      return {
        opThreshold:
          opThreshold !== null
            ? parseFloat(opThreshold)
            : DEFAULT_SETTINGS.opThreshold,
        trapThreshold:
          trapThreshold !== null
            ? parseFloat(trapThreshold)
            : DEFAULT_SETTINGS.trapThreshold,
        language: language ?? DEFAULT_SETTINGS.language,
        themeMode:
          themeMode === 'light' || themeMode === 'dark' || themeMode === 'system'
            ? themeMode
            : DEFAULT_SETTINGS.themeMode,
        overlayOpacity:
          overlayOpacity !== null
            ? parseFloat(overlayOpacity)
            : DEFAULT_SETTINGS.overlayOpacity,
        overlayAnchor:
          overlayAnchor === 'left' || overlayAnchor === 'right'
            ? overlayAnchor
            : DEFAULT_SETTINGS.overlayAnchor,
        streamPort:
          streamPort !== null
            ? parseInt(streamPort, 10)
            : DEFAULT_SETTINGS.streamPort,
        streamAutostart:
          streamAutostart !== null
            ? streamAutostart === 'true'
            : DEFAULT_SETTINGS.streamAutostart,
        experimentalAutoDraftTracking:
          autoDraftTracking !== null
            ? autoDraftTracking === 'true'
            : DEFAULT_SETTINGS.experimentalAutoDraftTracking,
      }
    },

    setSettings(settings: Partial<AppSettings>): void {
      if (settings.opThreshold !== undefined) {
        set('op_threshold', String(settings.opThreshold))
      }
      if (settings.trapThreshold !== undefined) {
        set('trap_threshold', String(settings.trapThreshold))
      }
      if (settings.language !== undefined) {
        set('language', settings.language)
      }
      if (settings.themeMode !== undefined) {
        set('theme_mode', settings.themeMode)
      }
      if (settings.overlayOpacity !== undefined) {
        set('overlay_opacity', String(settings.overlayOpacity))
      }
      if (settings.overlayAnchor !== undefined) {
        set('overlay_anchor', settings.overlayAnchor)
      }
      if (settings.streamPort !== undefined) {
        set('stream_port', String(settings.streamPort))
      }
      if (settings.streamAutostart !== undefined) {
        set('stream_autostart', String(settings.streamAutostart))
      }
      if (settings.experimentalAutoDraftTracking !== undefined) {
        set(
          'experimental_auto_draft_tracking',
          String(settings.experimentalAutoDraftTracking),
        )
      }
    },

    getLastScrapeDate(): string | null {
      return get('last_successful_scrape_date')
    },

    setLastScrapeDate(date: string): void {
      set('last_successful_scrape_date', date)
    },
  }
}
