import {
  TWITCH_MODEL_PICKED_BIT,
  type TwitchCompactState,
  type TwitchPickRef,
  type TwitchPlayerRow,
  type TwitchPoolIndex,
  type TwitchRichState,
} from '@shared/types/twitch'
import type { Catalog } from './catalog-types'

// Pure derivations over compact + rich + catalog. The compact carries names and picked
// masks; rich carries the pool-internal synergy graph and numbers; everything "in the
// pool right now" is computed here from the (delay-applied) compact.

export const SLOT_LABELS = ['R', 'Q', 'W', 'E'] as const
export type Team = 'radiant' | 'dire'

export function poolIndex(heroOrder: number, k: number): TwitchPoolIndex {
  return heroOrder * 4 + k
}

export function teamOf(playerIndex: number): Team {
  return playerIndex < 5 ? 'radiant' : 'dire'
}

export interface PoolSlot {
  i: TwitchPoolIndex
  heroOrder: number
  k: number
  name: string | null
  picked: boolean
  heroCdn: string | null
}

export function poolSlots(compact: TwitchCompactState | null): PoolSlot[] {
  if (!compact?.pool) return []
  const slots: PoolSlot[] = []
  compact.pool.forEach((row, heroOrder) => {
    row[1].forEach((name, k) => {
      slots.push({
        i: poolIndex(heroOrder, k),
        heroOrder,
        k,
        name,
        picked: (row[2] & (1 << k)) !== 0,
        heroCdn: row[0],
      })
    })
  })
  return slots
}

export function slotByIndex(compact: TwitchCompactState | null, i: TwitchPoolIndex): PoolSlot | null {
  return poolSlots(compact).find((s) => s.i === i) ?? null
}

export function slotByName(compact: TwitchCompactState | null, name: string): PoolSlot | null {
  return poolSlots(compact).find((s) => s.name === name) ?? null
}

export function isModelPicked(compact: TwitchCompactState | null, heroOrder: number): boolean {
  const row = compact?.pool?.[heroOrder]
  return row ? (row[2] & TWITCH_MODEL_PICKED_BIT) !== 0 : false
}

/** Resolve a pick ref to a pool slot name (raw names pass through). */
export function refName(compact: TwitchCompactState | null, ref: TwitchPickRef | null): string | null {
  if (ref === null) return null
  if (typeof ref === 'string') return ref === '' ? null : ref
  return slotByIndex(compact, ref)?.name ?? null
}

export function playerRows(compact: TwitchCompactState | null): TwitchPlayerRow[] {
  return compact?.players ?? []
}

/** Player index who holds this ability (by pool index or raw name), or null. */
export function pickedBy(compact: TwitchCompactState | null, ref: TwitchPickRef | string): number | null {
  if (!compact?.players) return null
  const name = typeof ref === 'string' ? ref : slotByIndex(compact, ref)?.name
  for (const [playerIndex, row] of compact.players.entries()) {
    for (const pick of row[1]) {
      if (pick === null) continue
      if (pick === ref) return playerIndex
      if (name && refName(compact, pick) === name) return playerIndex
    }
  }
  return null
}

export interface PlayerModel {
  cdn: string | null
  heroOrder: number | null
}

/** The player's model as a CDN name (pool row index or GSI npc name in the compact). */
export function playerModel(compact: TwitchCompactState | null, playerIndex: number): PlayerModel {
  const row = compact?.players?.[playerIndex]
  if (!row) return { cdn: null, heroOrder: null }
  const model = row[0]
  if (typeof model === 'number') return { cdn: compact?.pool?.[model]?.[0] ?? null, heroOrder: model }
  if (typeof model === 'string') return { cdn: model, heroOrder: null }
  return { cdn: null, heroOrder: null }
}

export function playerName(
  compact: TwitchCompactState | null,
  rich: TwitchRichState | null,
  playerIndex: number,
): string | null {
  const fromCompact = compact?.players?.[playerIndex]?.[3]
  if (fromCompact) return fromCompact
  return rich?.playerNames?.[playerIndex] ?? null
}

export function displayName(
  rich: TwitchRichState | null,
  catalog: Catalog | null,
  name: string | null,
  fallbackIndex?: TwitchPoolIndex,
): string {
  if (name === null) return 'Unknown ability'
  const fromRich =
    rich?.abilities.find((a) => a.n === name || (fallbackIndex !== undefined && a.i === fallbackIndex))?.dn
  return fromRich ?? catalog?.abilities[name]?.n ?? titleCase(name)
}

export function heroDisplayName(rich: TwitchRichState | null, catalog: Catalog | null, cdn: string | null, heroOrder?: number): string {
  if (cdn === null && heroOrder === undefined) return 'Unknown hero'
  const fromRich = rich?.heroes.find((h) => (heroOrder !== undefined && h.i === heroOrder) || (cdn !== null && h.cdn === cdn))?.dn
  if (fromRich) return fromRich
  if (cdn && catalog?.heroes[cdn]) return catalog.heroes[cdn].n
  return cdn ? titleCase(cdn, false) : 'Unknown hero'
}

export function titleCase(internal: string, dropFirst = true): string {
  const parts = internal.split('_')
  const words = dropFirst && parts.length > 1 ? parts.slice(1) : parts
  return words.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}

export interface Partner {
  i: TwitchPoolIndex
  name: string | null
  wr: number
  increase: number | null
  inPool: boolean
  pickedBy: number | null
}

/** Pool-internal partners of an ability, strong first. */
export function partnersInPool(
  rich: TwitchRichState | null,
  compact: TwitchCompactState | null,
  i: TwitchPoolIndex,
): { strong: Partner[]; weak: Partner[] } {
  const strong: Partner[] = []
  const weak: Partner[] = []
  if (!rich) return { strong, weak }
  for (const [a, b, wr, inc] of rich.pairs) {
    if (a !== i && b !== i) continue
    const partnerIndex = a === i ? b : a
    const slot = slotByIndex(compact, partnerIndex)
    const entry: Partner = {
      i: partnerIndex,
      name: slot?.name ?? rich.abilities.find((x) => x.i === partnerIndex)?.n ?? null,
      wr,
      increase: inc,
      inPool: slot ? !slot.picked : false,
      pickedBy: slot ? pickedBy(compact, partnerIndex) : null,
    }
    const positive = inc !== null ? inc >= 0 : wr >= 0.5
    ;(positive ? strong : weak).push(entry)
  }
  strong.sort((x, y) => y.wr - x.wr)
  weak.sort((x, y) => x.wr - y.wr)
  return { strong, weak }
}

export interface HeroPartner {
  heroOrder: number
  cdn: string | null
  wr: number
  increase: number | null
  modelPicked: boolean
}

/** Hero models in the pool that synergize with an ability. */
export function heroPartnersForAbility(
  rich: TwitchRichState | null,
  compact: TwitchCompactState | null,
  i: TwitchPoolIndex,
): HeroPartner[] {
  if (!rich) return []
  return rich.heroPairs
    .filter(([, ability]) => ability === i)
    .map(([heroOrder, , wr, inc]) => ({
      heroOrder,
      cdn: compact?.pool?.[heroOrder]?.[0] ?? rich.heroes.find((h) => h.i === heroOrder)?.cdn ?? null,
      wr,
      increase: inc,
      modelPicked: isModelPicked(compact, heroOrder),
    }))
    .sort((a, b) => b.wr - a.wr)
}

/** Abilities in the pool that synergize with a hero model. */
export function abilityPartnersForHero(
  rich: TwitchRichState | null,
  compact: TwitchCompactState | null,
  heroOrder: number,
): Partner[] {
  if (!rich) return []
  return rich.heroPairs
    .filter(([row]) => row === heroOrder)
    .map(([, i, wr, inc]) => {
      const slot = slotByIndex(compact, i)
      return {
        i,
        name: slot?.name ?? rich.abilities.find((x) => x.i === i)?.n ?? null,
        wr,
        increase: inc,
        inPool: slot ? !slot.picked : false,
        pickedBy: slot ? pickedBy(compact, i) : null,
      }
    })
    .sort((a, b) => b.wr - a.wr)
}

export interface ComboRow {
  a: TwitchPoolIndex
  b: TwitchPoolIndex
  wr: number
  increase: number
}

/** OP / trap combinations still fully available in the pool. */
export function combosInPool(
  rich: TwitchRichState | null,
  compact: TwitchCompactState | null,
): { op: ComboRow[]; trap: ComboRow[] } {
  const op: ComboRow[] = []
  const trap: ComboRow[] = []
  if (!rich) return { op, trap }
  const available = new Set(poolSlots(compact).filter((s) => !s.picked && s.name).map((s) => s.i))
  for (const [a, b, wr, inc] of rich.pairs) {
    if (inc === null || !available.has(a) || !available.has(b)) continue
    if (inc >= rich.thresholds.op) op.push({ a, b, wr, increase: inc })
    else if (inc <= -rich.thresholds.trap) trap.push({ a, b, wr, increase: inc })
  }
  op.sort((x, y) => y.wr - x.wr)
  trap.sort((x, y) => x.wr - y.wr)
  return { op, trap }
}

/**
 * Draft row for a top-bar seat. The in-game top bar is ordered by GSI slot and
 * `players` is keyed by draft row; the two differ (a live game had seat 0 =
 * row 4), so every in-game render goes through this. Returns null for a seat the
 * app has not resolved yet — better an empty column than another player's draft.
 * Without a mapping (playing sessions) seat and row are treated as the same, the
 * behaviour that predates the mapping.
 */
export function rowForSeat(
  compact: TwitchCompactState | null,
  seat: number,
): number | null {
  if (!compact?.seats) return seat
  return compact.seats[seat] ?? null
}

export interface PickOrderEntry {
  seq: number
  playerIndex: number
  team: Team
  /** null = model selection marker; '' = unknown ability. */
  name: string | null
  isModelMarker: boolean
}

export function pickOrder(compact: TwitchCompactState | null): PickOrderEntry[] {
  if (!compact?.f) return []
  return compact.f.map(([playerIndex, ref], seq) => ({
    seq,
    playerIndex,
    team: teamOf(playerIndex),
    name: ref === -1 ? null : (refName(compact, ref) ?? ''),
    isModelMarker: ref === -1,
  }))
}
