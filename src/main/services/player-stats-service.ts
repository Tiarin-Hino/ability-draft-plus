import log from 'electron-log/main'
import { createWindrunApiClient, parsePlayerIdInput } from '@core/scraper'
import type { WindrunApiClient } from '@core/scraper'
import type { PlayerStatsUpsert } from '@core/database/repositories/player-stats-repository'
import type { PlayerProfileInfo } from '@shared/types'
import type { DatabaseService } from './database-service'
import { loadClientTag } from './api-config'

// @DEV-GUIDE: Personalization — linked Windrun profile management + stats refresh.
// The profile is linked/unlinked via dedicated IPC (player-handlers.ts), NOT via
// settings:set, so the id is always validated against the live profile endpoint
// before it is stored. Profile identity + fetch bookkeeping live as Metadata keys
// (below); the stats snapshots live in PlayerAbilityStats/PlayerHeroStats.
//
// refreshIfStale() runs on every overlay activation (fire-and-forget): one ~38KB
// request when the snapshot is older than the TTL or belongs to a different
// profile. A failed refresh is NON-FATAL by design — the previous snapshot stays
// in place and the overlay works exactly as before (stale personal data beats no
// overlay; the draft won't wait for windrun.io).
//
// Windrun caveat baked into the data model: /players/{id}/stats caps spellStats
// at the top 200 abilities by games. Missing abilities simply have no personal
// row and score globally — that's the designed fallback, not an error.

const logger = log.scope('player-stats')

/** Metadata keys (Metadata table, all values TEXT). */
const KEY_PROFILE_ID = 'player_profile_id'
const KEY_PROFILE_NICKNAME = 'player_profile_nickname'
const KEY_PROFILE_AVATAR = 'player_profile_avatar'
const KEY_FETCHED_AT = 'player_stats_fetched_at'
const KEY_FETCHED_FOR = 'player_stats_fetched_for'

const STATS_TTL_MS = 60 * 60 * 1000 // 1h

export interface RefreshStatsResult {
  success: boolean
  /** Rows fetched from Windrun (spellStats cap: top 200 by games). */
  abilityCount?: number
  heroCount?: number
  /** Fetched ability rows that joined onto an Abilities.windrun_id. 0 with a
   * non-zero abilityCount means the DB predates windrun_id — the settings card
   * tells the user to run a Windrun data update once. */
  matchedAbilityCount?: number
  errorKey?: string
}

export interface LinkProfileResult {
  success: boolean
  profile?: PlayerProfileInfo
  /** Result of the initial stats fetch (absent when that fetch failed). */
  stats?: RefreshStatsResult
  /** i18n key under the settings namespace (translated in the renderer). */
  errorKey?: string
}

export interface PlayerStatsService {
  getProfile(): PlayerProfileInfo | null
  linkProfile(input: string): Promise<LinkProfileResult>
  unlinkProfile(): void
  /** Force-refresh the stats snapshot for the linked profile. */
  refreshStats(): Promise<RefreshStatsResult>
  /** Refresh on overlay activation when the snapshot is stale. Never throws. */
  refreshIfStale(): Promise<void>
}

export function createPlayerStatsService(
  dbService: DatabaseService,
  apiClientOverride?: WindrunApiClient,
): PlayerStatsService {
  const apiClient = apiClientOverride ?? createWindrunApiClient(undefined, loadClientTag())
  let refreshInFlight = false

  function getLinkedPlayerId(): number | null {
    const raw = dbService.metadata.get(KEY_PROFILE_ID)
    if (raw === null) return null
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  function getProfile(): PlayerProfileInfo | null {
    const playerId = getLinkedPlayerId()
    if (playerId === null) return null
    // Unlink stores '' (Metadata has no delete) — coerce empties to null
    return {
      playerId,
      nickname: dbService.metadata.get(KEY_PROFILE_NICKNAME) || null,
      avatarUrl: dbService.metadata.get(KEY_PROFILE_AVATAR) || null,
      lastFetchedAt: dbService.metadata.get(KEY_FETCHED_AT) || null,
    }
  }

  async function fetchAndStoreStats(playerId: number): Promise<RefreshStatsResult> {
    const response = await apiClient.fetchPlayerStats(playerId)

    const spellStats = response.stats?.spellStats ?? {}
    const heroStats = response.stats?.heroStats ?? {}

    const abilityEntries: PlayerStatsUpsert[] = []
    for (const [id, stat] of Object.entries(spellStats)) {
      const windrunId = parseInt(id, 10)
      if (!Number.isFinite(windrunId) || windrunId <= 0) continue
      abilityEntries.push({
        windrunId,
        wins: stat.wins,
        losses: stat.losses,
        winrate: stat.winrate,
        avgPickPosition: stat.avgPickPosition ?? null,
      })
    }

    const heroEntries: PlayerStatsUpsert[] = []
    for (const [id, stat] of Object.entries(heroStats)) {
      const windrunId = parseInt(id, 10)
      if (!Number.isFinite(windrunId) || windrunId <= 0) continue
      heroEntries.push({
        windrunId,
        wins: stat.wins,
        losses: stat.losses,
        winrate: stat.winrate,
      })
    }

    dbService.playerStats.replaceAbilityStats(abilityEntries)
    dbService.playerStats.replaceHeroStats(heroEntries)
    dbService.metadata.set(KEY_FETCHED_AT, new Date().toISOString())
    dbService.metadata.set(KEY_FETCHED_FOR, String(playerId))
    dbService.persist()

    const matchedAbilityCount = dbService.playerStats.getAbilityStatsByName().size
    logger.info('Personal stats refreshed', {
      playerId,
      abilities: abilityEntries.length,
      heroes: heroEntries.length,
      matchedAbilities: matchedAbilityCount,
    })
    if (abilityEntries.length > 0 && matchedAbilityCount === 0) {
      logger.warn(
        'No fetched ability stats joined an Abilities.windrun_id — a Windrun data update is needed to enable ability personalization',
      )
    }
    return {
      success: true,
      abilityCount: abilityEntries.length,
      heroCount: heroEntries.length,
      matchedAbilityCount,
    }
  }

  return {
    getProfile,

    async linkProfile(input: string): Promise<LinkProfileResult> {
      const playerId = parsePlayerIdInput(input)
      if (playerId === null) {
        return { success: false, errorKey: 'personalStats.errorInvalidInput' }
      }

      let nickname: string
      let avatar: string | null
      try {
        const profile = await apiClient.fetchPlayerProfile(playerId)
        nickname = profile.data.nickname
        avatar = profile.data.avatar
      } catch (err) {
        logger.warn('Profile validation failed', { playerId, error: String(err) })
        return { success: false, errorKey: 'personalStats.errorProfileNotFound' }
      }

      dbService.metadata.set(KEY_PROFILE_ID, String(playerId))
      dbService.metadata.set(KEY_PROFILE_NICKNAME, nickname)
      if (avatar) {
        dbService.metadata.set(KEY_PROFILE_AVATAR, avatar)
      }

      let stats: RefreshStatsResult | undefined
      try {
        stats = await fetchAndStoreStats(playerId)
      } catch (err) {
        // Profile is linked; stats will retry on the next overlay activation
        logger.warn('Initial stats fetch failed after linking', {
          playerId,
          error: String(err),
        })
        dbService.persist()
      }

      return { success: true, profile: getProfile() ?? undefined, stats }
    },

    unlinkProfile(): void {
      dbService.playerStats.clear()
      for (const key of [
        KEY_PROFILE_ID,
        KEY_PROFILE_NICKNAME,
        KEY_PROFILE_AVATAR,
        KEY_FETCHED_AT,
        KEY_FETCHED_FOR,
      ]) {
        dbService.metadata.set(key, '')
      }
      dbService.persist()
      logger.info('Profile unlinked; personal stats cleared')
    },

    async refreshStats(): Promise<RefreshStatsResult> {
      const playerId = getLinkedPlayerId()
      if (playerId === null) {
        return { success: false, errorKey: 'personalStats.errorNotLinked' }
      }
      try {
        return await fetchAndStoreStats(playerId)
      } catch (err) {
        logger.warn('Stats refresh failed', { playerId, error: String(err) })
        return { success: false, errorKey: 'personalStats.errorFetchFailed' }
      }
    },

    async refreshIfStale(): Promise<void> {
      const playerId = getLinkedPlayerId()
      if (playerId === null || refreshInFlight) return

      const fetchedFor = dbService.metadata.get(KEY_FETCHED_FOR)
      const fetchedAt = dbService.metadata.get(KEY_FETCHED_AT)
      if (fetchedFor === String(playerId) && fetchedAt) {
        const age = Date.now() - Date.parse(fetchedAt)
        if (Number.isFinite(age) && age >= 0 && age < STATS_TTL_MS) {
          logger.debug('Personal stats fresh; skipping refresh', {
            ageMinutes: Math.round(age / 60_000),
          })
          return
        }
      }

      refreshInFlight = true
      try {
        await fetchAndStoreStats(playerId)
      } catch (err) {
        // Non-fatal: keep the previous snapshot, the overlay must never wait on this
        logger.warn('Background stats refresh failed (keeping previous snapshot)', {
          playerId,
          error: String(err),
        })
      } finally {
        refreshInFlight = false
      }
    },
  }
}
