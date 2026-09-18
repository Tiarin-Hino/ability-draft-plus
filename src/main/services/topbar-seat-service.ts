import log from 'electron-log/main'
import type { GsiSnapshot } from '@core/gsi/types'
import { gsiSnapshotMode } from '@core/gsi/parser'
import { heroNameToken } from '@core/domain/own-row-detection'
import {
  topbarPortraitRects,
  assignTeamSeats,
  mergeIdentifiedSeats,
  completeSeats,
} from '@core/domain/topbar-seats'
import {
  cropPortraitVector,
  loadPortraitArtVariants,
  scorePortrait,
} from '@core/ml/topbar-portraits'
import { TOPBAR_SEAT_RETRY_MS, TOPBAR_SEAT_MAX_ATTEMPTS } from '@shared/constants/thresholds'
import type { StreamServerService } from './stream-server-service'
import type { TwitchPublisherService } from './twitch-publisher-service'
import type { IconCacheService } from './icon-cache-service'
import type { GameFrame } from './game-frame-capture'

// @DEV-GUIDE: Maps the in-game top bar to draft rows while PLAYING, so the Twitch
// extension shows each player's drafted abilities under the right portrait.
// (Spectating needs none of this: GSI reports every slot's hero and
// slot-mapping-service learns the mapping during the draft.)
// - Runs once GSI is in game (PRE_GAME / GAME_IN_PROGRESS), only while the
//   publisher is broadcasting a draft, one capture per TOPBAR_SEAT_RETRY_MS, until
//   all ten portraits are identified or TOPBAR_SEAT_MAX_ATTEMPTS.
// - The drafted models come from the publisher's last compact, not the draft
//   store: overlay auto-close has reset the draft session by now.
// - Matching, assignment, merging and the fill policy are pure — see
//   core/domain/topbar-seats.ts (the WHY: model-keyed, swap-safe, always fills)
//   and core/ml/topbar-portraits.ts (the image side).
// - The local player's seat (GSI lobby slot) pairs with the row that drafted the
//   hero they CONTROL (GSI hero in game), never their own draft row — a swap moves
//   the player, not the model's abilities.

const logger = log.scope('topbar-seats')

const IN_GAME_PHASES = new Set([
  'DOTA_GAMERULES_STATE_PRE_GAME',
  'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
])

export interface TopbarSeatService {
  start(): void
}

export function createTopbarSeatService(
  streamService: Pick<StreamServerService, 'onGsiSnapshot'>,
  publisher: Pick<TwitchPublisherService, 'getDraftedModels' | 'setSeats'>,
  iconCache: Pick<IconCacheService, 'getIcon'>,
  captureGameFrame: () => Promise<GameFrame>,
): TopbarSeatService {
  let started = false
  let matchId: string | null = null
  let draftId: string | null = null
  let identified: (number | null)[] = Array.from({ length: 10 }, () => null)
  let attempts = 0
  let done = false
  let running = false
  let nextAttemptAt = 0
  /** Portrait variants per hero CDN name; null = no usable art. */
  const artVariants = new Map<string, Uint8Array[] | null>()

  function resetForDraft(nextDraftId: string | null): void {
    draftId = nextDraftId
    identified = Array.from({ length: 10 }, () => null)
    attempts = 0
    done = false
  }

  async function variantsFor(cdnName: string): Promise<Uint8Array[] | null> {
    const cached = artVariants.get(cdnName)
    if (cached !== undefined) return cached
    let variants: Uint8Array[] | null = null
    try {
      const icon = await iconCache.getIcon('heroes', cdnName)
      if (!icon.isPlaceholder) variants = await loadPortraitArtVariants(icon.data)
    } catch (error) {
      logger.warn('Hero portrait art unusable', {
        hero: cdnName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    artVariants.set(cdnName, variants)
    return variants
  }

  async function attempt(snapshot: GsiSnapshot): Promise<void> {
    const draft = publisher.getDraftedModels()
    if (!draft) return // not broadcasting, or no draft to place
    if (draft.draftId !== draftId) resetForDraft(draft.draftId)
    if (done) return
    attempts += 1

    const { screenshot } = await captureGameFrame()
    const portraits = await Promise.all(
      topbarPortraitRects(screenshot).map((rect) => cropPortraitVector(screenshot, rect)),
    )

    const thisAttempt: (number | null)[] = []
    const noArt: string[] = []
    const scores: string[] = []
    for (const first of [0, 5]) {
      const rows: number[] = []
      const arts: Uint8Array[][] = []
      for (let row = first; row < first + 5; row++) {
        const model = draft.models[row]
        if (!model) continue
        const variants = await variantsFor(model)
        if (!variants) {
          noArt.push(model)
          continue
        }
        rows.push(row)
        arts.push(variants)
      }
      const seatScores = [0, 1, 2, 3, 4].map((i) =>
        arts.map((variants) => scorePortrait(portraits[first + i], variants)),
      )
      const assigned =
        rows.length > 0 ? assignTeamSeats(seatScores, rows) : [null, null, null, null, null]
      assigned.forEach((row, i) => {
        if (row === null) return
        scores.push(`${first + i}:${draft.models[row]} ${seatScores[i][rows.indexOf(row)].toFixed(2)}`)
      })
      thisAttempt.push(...assigned)
    }

    const before = identified.filter((row) => row !== null).length
    identified = mergeIdentifiedSeats(identified, thisAttempt)
    const count = identified.filter((row) => row !== null).length

    // Nothing recognised, ever: the top bar is not on screen yet (loading, or a
    // capture before the HUD draws — live 2026-09-16, attempt 1 matched 0/10).
    // Publishing now would be all guesses, which in a shuffled game puts wrong
    // abilities under every portrait until the next attempt. Send nothing.
    if (count === 0) {
      logger.debug('Top-bar seats: nothing recognised yet (bar not on screen?)', {
        attempt: attempts,
      })
      if (attempts >= TOPBAR_SEAT_MAX_ATTEMPTS) done = true
      return
    }

    const localHero = snapshot.localHeroNpcName
    const localSeat = snapshot.localPlayer?.slotIndex ?? null
    const localRow = localHero
      ? draft.models.findIndex((m) => m !== null && heroNameToken(m) === heroNameToken(localHero))
      : -1
    const { seats, guessed } = completeSeats({
      identified,
      local: localSeat !== null && localRow >= 0 ? { seat: localSeat, row: localRow } : null,
    })
    publisher.setSeats(draft.draftId, seats)

    if (count > before) {
      logger.info('Top-bar seats', {
        attempt: attempts,
        identified: `${count}/10`,
        seats,
        ...(guessed.length > 0 ? { guessed } : {}),
        matched: scores,
        ...(noArt.length > 0 ? { noArt } : {}),
      })
    }
    if (count === 10) {
      done = true
    } else if (attempts >= TOPBAR_SEAT_MAX_ATTEMPTS) {
      done = true
      logger.warn('Top-bar seats incomplete after max attempts — keeping best + fill', {
        identified: `${count}/10`,
        seats,
        guessed,
      })
    }
  }

  return {
    start(): void {
      if (started) return
      started = true
      streamService.onGsiSnapshot((snapshot) => {
        if (gsiSnapshotMode(snapshot) !== 'playing') return
        if (snapshot.gamePhase === null || !IN_GAME_PHASES.has(snapshot.gamePhase)) return
        if (snapshot.matchId !== matchId) {
          matchId = snapshot.matchId
          resetForDraft(null)
        }
        const now = Date.now()
        if (done || running || now < nextAttemptAt) return
        running = true
        nextAttemptAt = now + TOPBAR_SEAT_RETRY_MS
        void attempt(snapshot)
          .catch((error: unknown) => {
            logger.warn('Top-bar seat attempt failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            running = false
          })
      })
    },
  }
}
