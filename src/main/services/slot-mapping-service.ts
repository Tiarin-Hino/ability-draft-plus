import log from 'electron-log/main'
import type { StoreApi } from 'zustand/vanilla'
import type { DraftStore } from '../store/draft-store'
import type { StreamServerService } from './stream-server-service'
import {
  initialCardRows,
  detectCardChanges,
  correlateSlotRows,
  correlateByHeroIdentity,
  correlateByElimination,
} from '@core/domain/slot-row-correlation'
import type {
  PlayerCardCapture,
  GsiHeroEvent,
} from '@core/domain/slot-row-correlation'
import type { PickEvent } from '@shared/types/stream'

// @DEV-GUIDE: Electron-side orchestrator for the GSI slot <-> scan row correlation
// (spectate/replay player-name placement; the pure logic and the WHY live in
// core/domain/slot-row-correlation.ts).
//
// TWO correlators, tried in order:
// 1. Identity join (correlateByHeroIdentity) — GSI's slot->hero against the card
//    OCR's row->hero. Preferred: no timing window, no pixel threshold, and it
//    resolves from a single observation of each side.
// 2. Event/card correlation (correlateSlotRows) — the original pixel-change +
//    time-window matcher, still the fallback for rows the OCR cannot read.
// Responsibilities:
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
  /**
   * Spectate model picks awaiting a draft row. GSI tells us a slot drafted a
   * model the moment it happens, but a timeline marker needs the ROW, which the
   * mapping may only resolve later — so they queue here and flush on mapping.
   */
  const pendingModelMarkers = new Map<number, string>()
  /** Slots whose marker is already in the timeline (never emit twice). */
  const markerEmittedSlots = new Set<number>()

  /**
   * Emit modelSelectionMarker timeline events for spectate model picks whose row
   * is now known. The card-OCR model path (auto-rescan-service,
   * model-picks-from-ocr.ts) runs in PLAYING mode only; in spectate GSI reports
   * every player's hero and is the authoritative model source, so it drives the
   * markers instead. The two paths never both run for one draft.
   */
  function flushModelMarkers(): void {
    if (pendingModelMarkers.size === 0) return
    const state = draftStore.getState()
    const rowBySlot = new Map(
      state.slotRowMappings.map((m) => [m.gsiSlot, m.scanRow]),
    )
    const events: PickEvent[] = []
    for (const [slot, npcName] of [...pendingModelMarkers]) {
      const row = rowBySlot.get(slot)
      if (row === undefined) continue
      pendingModelMarkers.delete(slot)
      if (markerEmittedSlots.has(slot)) continue
      markerEmittedSlots.add(slot)
      events.push({
        seq: state.draftTimeline.length + events.length,
        playerIndex: row,
        abilityName: null,
        kind: 'modelSelectionMarker',
        clockTime: null,
      })
      logger.info('Model pick marked from GSI (spectate)', {
        slot,
        row,
        hero: npcName,
      })
    }
    if (events.length > 0) {
      draftStore.getState().appendPickEvents(events)
      streamService.refresh()
    }
  }

  /**
   * Identity join first (hero name on both sides — no timing window, no pixel
   * threshold), then the event/card correlation for whatever it could not
   * resolve. Returns true when new mappings committed.
   */
  function runIdentityJoin(
    gsiHeroes: ReadonlyArray<{ slot: number; npcName: string }>,
    playerNames: ReadonlyArray<{ slot: number; npcName: string }>,
    knownSlots: readonly number[],
  ): boolean {
    const state = draftStore.getState()
    // Two identity keys, tried together. The HERO name only identifies a row
    // once that player has drafted a model; the PLAYER name is on the card from
    // the start, so it is what resolves rows during the preview. Same joiner
    // either way — it just compares tokens on both sides.
    const byPlayer = correlateByHeroIdentity({
      gsiHeroes: playerNames,
      ocrHeroNamesByRow: state.ocrPlayerNamesByRow,
      mappings: state.slotRowMappings,
    })
    const identity = correlateByHeroIdentity({
      gsiHeroes,
      ocrHeroNamesByRow: state.ocrHeroNamesByRow,
      mappings: byPlayer.mappings,
    })
    identity.newMappings = [...byPlayer.newMappings, ...identity.newMappings]
    // Elimination runs on the identity result, so the two compound: mapping the
    // fourth player in a half immediately determines the fifth.
    const eliminated = correlateByElimination({
      knownSlots,
      mappings: identity.mappings,
    })
    const newMappings = [...identity.newMappings, ...eliminated.newMappings]
    if (newMappings.length === 0) return false

    // A slot resolved here no longer needs its pending pixel event
    const resolvedSlots = new Set(newMappings.map((m) => m.gsiSlot))
    draftStore.setState({
      slotRowMappings: eliminated.mappings,
      gsiHeroEvents: state.gsiHeroEvents.filter(
        (e) => !resolvedSlots.has(e.slot),
      ),
    })
    logger.info('GSI slot <-> scan row mapped', {
      byPlayerName: byPlayer.newMappings,
      byHeroName: identity.newMappings.filter(
        (m) => !byPlayer.newMappings.includes(m),
      ),
      byElimination: eliminated.newMappings,
      total: eliminated.mappings.length,
    })
    streamService.refresh()
    return true
  }

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
        pendingModelMarkers.clear()
        markerEmittedSlots.clear()
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
          // Timeline markers are queued for EVERY gained hero — unlike the
          // pixel correlation below they do not need card baselines, only a row.
          if (
            player.heroNpcName !== null &&
            !markerEmittedSlots.has(player.slotIndex)
          ) {
            pendingModelMarkers.set(player.slotIndex, player.heroNpcName)
          }
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

      // Identity join runs on EVERY spectate snapshot, not just when an event
      // fires: the OCR half arrives on its own schedule (a later scan), so a
      // pairing often becomes resolvable with no GSI change at all.
      runIdentityJoin(
        snapshot.players
          .filter((p) => p.heroNpcName !== null)
          .map((p) => ({ slot: p.slotIndex, npcName: p.heroNpcName as string })),
        snapshot.players
          .filter((p) => p.name.length > 0)
          .map((p) => ({ slot: p.slotIndex, npcName: p.name })),
        snapshot.players.map((p) => p.slotIndex),
      )
      flushModelMarkers()
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
      pendingModelMarkers.clear()
      markerEmittedSlots.clear()
      lastMatchId = null
    },
  }
}
