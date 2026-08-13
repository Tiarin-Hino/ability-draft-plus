import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { StreamServerService } from './stream-server-service'
import {
  initialCardRows,
  detectCardChanges,
  correlateSlotRows,
} from '@core/domain/slot-row-correlation'
import type {
  PlayerCardCapture,
  GsiHeroEvent,
} from '@core/domain/slot-row-correlation'

// @DEV-GUIDE: Electron-side orchestrator for the GSI slot <-> scan row correlation
// (spectate/replay player-name placement; the pure logic and the WHY live in
// core/domain/slot-row-correlation.ts). Responsibilities:
// - Buffer "slot S gained hero H" events from spectate GSI snapshots (diffing
//   heroNpcName per slot against the previous snapshot; rewind reverts re-arm).
//   Events are only collected once card baselines exist — earlier picks are baked
//   into the baseline and could never match a card change.
// - Receive every scan's player-card crops (ml-worker captures them alongside the
//   model tiles) and advance change detection + correlation in DraftStore.
// - Re-run correlation on GSI snapshots too: commits are time-gated (a match
//   window must close), so they can become due between scans.
// All correlation state lives in DraftStore (cleared by resetSession); this
// service only keeps the per-snapshot hero diff state, reset on matchid change.

const logger = log.scope('slot-mapping')

export interface SlotMappingService {
  /** Fed by scan-processing-service with every scan's card crops. */
  onCardTiles(tiles: PlayerCardCapture[] | undefined, isInitialScan: boolean): void
  /** Clears the per-snapshot GSI diff state (overlay reset / closed). */
  onSessionReset(): void
}

export function createSlotMappingService(
  draftStore: StoreApi<DraftStore>,
  streamService: StreamServerService,
): SlotMappingService {
  /** heroNpcName last seen per GSI slot (null = no hero), for edge detection. */
  const lastHeroBySlot = new Map<number, string | null>()
  let lastMatchId: string | null = null

  function runCorrelation(nowMs: number): void {
    const state = draftStore.getState()
    if (
      state.gsiHeroEvents.length === 0 &&
      state.slotRowMappings.length === 0
    ) {
      return
    }
    const result = correlateSlotRows({
      events: state.gsiHeroEvents,
      rows: state.playerCardRows,
      mappings: state.slotRowMappings,
      nowMs,
    })
    if (
      result.newMappings.length === 0 &&
      result.prunedSlots.length === 0 &&
      result.events.length === state.gsiHeroEvents.length
    ) {
      return
    }
    draftStore.setState({
      gsiHeroEvents: result.events,
      slotRowMappings: result.mappings,
    })
    if (result.prunedSlots.length > 0) {
      logger.info('Dropped unmatchable GSI hero events', {
        slots: result.prunedSlots,
      })
    }
    if (result.newMappings.length > 0) {
      logger.info('GSI slot <-> scan row mapping committed', {
        newMappings: result.newMappings,
        total: result.mappings.length,
      })
      streamService.refresh()
    }
  }

  streamService.onGsiSnapshot((snapshot) => {
    const nowMs = Date.now()

    // A different matchid is a different draft — old hero edges, baselines,
    // events, and mappings are all meaningless for it. Detection stays inert
    // until the new draft's initial scan captures fresh baselines.
    if (snapshot.matchId !== null && snapshot.matchId !== lastMatchId) {
      if (lastMatchId !== null) {
        lastHeroBySlot.clear()
        draftStore.setState({
          playerCardBaselines: [],
          playerCardRows: [],
          gsiHeroEvents: [],
          slotRowMappings: [],
        })
        logger.info('New match — slot mapping state cleared', {
          matchId: snapshot.matchId,
        })
      }
      lastMatchId = snapshot.matchId
    }

    if (snapshot.players.length > 0) {
      const haveBaselines =
        draftStore.getState().playerCardBaselines.length > 0
      const mappedSlots = new Set(
        draftStore.getState().slotRowMappings.map((m) => m.gsiSlot),
      )
      const newEvents: GsiHeroEvent[] = []
      for (const player of snapshot.players) {
        if (player.slotIndex < 0 || player.slotIndex > 9) continue
        const prev = lastHeroBySlot.get(player.slotIndex) ?? null
        if (player.heroNpcName !== prev) {
          lastHeroBySlot.set(player.slotIndex, player.heroNpcName)
          // Only a gained hero is an event; a hero going null is a replay
          // rewind — the next re-pick fires a fresh event.
          if (
            player.heroNpcName !== null &&
            haveBaselines &&
            !mappedSlots.has(player.slotIndex)
          ) {
            newEvents.push({
              slot: player.slotIndex,
              npcName: player.heroNpcName,
              atMs: nowMs,
            })
          }
        }
      }
      if (newEvents.length > 0) {
        logger.info('GSI hero events observed', {
          events: newEvents.map((e) => `${e.slot}=${e.npcName}`),
        })
        draftStore.setState({
          gsiHeroEvents: [...draftStore.getState().gsiHeroEvents, ...newEvents],
        })
      }
    }

    runCorrelation(nowMs)
  })

  return {
    onCardTiles(tiles, isInitialScan): void {
      if (!tiles || tiles.length === 0) return
      const nowMs = Date.now()

      if (isInitialScan) {
        // Fresh reference state; row states restart, sticky mappings and
        // pending events survive (same draft — a manual re-initial-scan
        // must not forget what is already known).
        draftStore.setState({
          playerCardBaselines: tiles,
          playerCardRows: initialCardRows(tiles.map((t) => t.row)),
        })
        logger.info('Player-card baselines captured', { rows: tiles.length })
        return
      }

      const state = draftStore.getState()
      if (state.playerCardBaselines.length === 0) return

      const detection = detectCardChanges({
        baselines: state.playerCardBaselines,
        current: tiles,
        rows: state.playerCardRows,
        nowMs,
      })
      draftStore.setState({ playerCardRows: detection.rows })
      if (detection.newlyChanged.length > 0) {
        logger.info('Player cards changed (model drafted on row)', {
          rows: detection.newlyChanged.map(
            (c) => `${c.row} (diff ${Math.round(c.diff)})`,
          ),
        })
      }

      runCorrelation(nowMs)
    },

    onSessionReset(): void {
      lastHeroBySlot.clear()
      lastMatchId = null
    },
  }
}
