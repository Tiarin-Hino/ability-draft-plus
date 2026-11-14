import {
  TWITCH_MODEL_PICKED_BIT,
  type TwitchCompactState,
  type TwitchPickRef,
  type TwitchPlayerRow,
  type TwitchPoolIndex,
  type TwitchRichAbility,
  type TwitchRichHero,
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

interface CompactIndex {
  slots: PoolSlot[]
  byIndex: Map<TwitchPoolIndex, PoolSlot>
  byName: Map<string, PoolSlot>
  pickedByIndex: Map<TwitchPoolIndex, number>
  pickedByName: Map<string, number>
  pickedByRaw: Map<string, number>
}

interface RichIndex {
  abilityByIndex: Map<TwitchPoolIndex, TwitchRichAbility>
  abilityByName: Map<string, TwitchRichAbility>
  heroByOrder: Map<number, TwitchRichHero>
  heroByCdn: Map<string, TwitchRichHero>
}

const compactIndexCache = new WeakMap<TwitchCompactState, CompactIndex>()
const richIndexCache = new WeakMap<TwitchRichState, RichIndex>()

function getCompactIndex(compact: TwitchCompactState): CompactIndex {
  const cached = compactIndexCache.get(compact)
  if (cached) return cached

  const slots: PoolSlot[] = []
  const byIndex = new Map<TwitchPoolIndex, PoolSlot>()
  const byName = new Map<string, PoolSlot>()

  compact.pool?.forEach((row, heroOrder) => {
    row[1].forEach((name, k) => {
      const slot: PoolSlot = {
        i: poolIndex(heroOrder, k),
        heroOrder,
        k,
        name,
        picked: (row[2] & (1 << k)) !== 0,
        heroCdn: row[0],
      }
      slots.push(slot)
      byIndex.set(slot.i, slot)
      if (name && !byName.has(name)) byName.set(name, slot)
    })
  })

  const pickedByIndex = new Map<TwitchPoolIndex, number>()
  const pickedByName = new Map<string, number>()
  const pickedByRaw = new Map<string, number>()

  compact.players?.forEach((row, playerIndex) => {
    for (const pick of row[1]) {
      if (pick === null) continue
      if (typeof pick === 'number') {
        if (!pickedByIndex.has(pick)) pickedByIndex.set(pick, playerIndex)
        const resolved = byIndex.get(pick)?.name
        if (resolved && !pickedByName.has(resolved)) pickedByName.set(resolved, playerIndex)
      } else {
        if (!pickedByRaw.has(pick)) pickedByRaw.set(pick, playerIndex)
        if (pick !== '' && !pickedByName.has(pick)) pickedByName.set(pick, playerIndex)
      }
    }
  })

  const idx: CompactIndex = { slots, byIndex, byName, pickedByIndex, pickedByName, pickedByRaw }
  compactIndexCache.set(compact, idx)
  return idx
}

function getRichIndex(rich: TwitchRichState): RichIndex {
  const cached = richIndexCache.get(rich)
  if (cached) return cached

  const abilityByIndex = new Map<TwitchPoolIndex, TwitchRichAbility>()
  const abilityByName = new Map<string, TwitchRichAbility>()
  for (const a of rich.abilities) {
    if (!abilityByIndex.has(a.i)) abilityByIndex.set(a.i, a)
    if (!abilityByName.has(a.n)) abilityByName.set(a.n, a)
  }

  const heroByOrder = new Map<number, TwitchRichHero>()
  const heroByCdn = new Map<string, TwitchRichHero>()
  for (const h of rich.heroes) {
    if (!heroByOrder.has(h.i)) heroByOrder.set(h.i, h)
    if (h.cdn !== null && !heroByCdn.has(h.cdn)) heroByCdn.set(h.cdn, h)
  }

  const idx: RichIndex = { abilityByIndex, abilityByName, heroByOrder, heroByCdn }
  richIndexCache.set(rich, idx)
  return idx
}

export function poolSlots(compact: TwitchCompactState | null): PoolSlot[] {
  if (!compact?.pool) return []
  return getCompactIndex(compact).slots
}

export function slotByIndex(compact: TwitchCompactState | null, i: TwitchPoolIndex): PoolSlot | null {
  if (!compact?.pool) return null
  return getCompactIndex(compact).byIndex.get(i) ?? null
}

export function slotByName(compact: TwitchCompactState | null, name: string): PoolSlot | null {
  if (!compact?.pool) return null
  return getCompactIndex(compact).byName.get(name) ?? null
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
  const idx = getCompactIndex(compact)
  if (typeof ref === 'string') {
    if (ref === '') return idx.pickedByRaw.get('') ?? null
    return idx.pickedByName.get(ref) ?? null
  }
  const name = idx.byIndex.get(ref)?.name
  if (name) return idx.pickedByName.get(name) ?? idx.pickedByIndex.get(ref) ?? null
  return idx.pickedByIndex.get(ref) ?? null
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
  let fromRich: string | undefined
  if (rich) {
    const idx = getRichIndex(rich)
    fromRich =
      idx.abilityByName.get(name)?.dn ??
      (fallbackIndex !== undefined ? idx.abilityByIndex.get(fallbackIndex)?.dn : undefined)
  }
  return fromRich ?? catalog?.abilities[name]?.n ?? titleCase(name)
}

export function heroDisplayName(rich: TwitchRichState | null, catalog: Catalog | null, cdn: string | null, heroOrder?: number): string {
  if (cdn === null && heroOrder === undefined) return 'Unknown hero'
  let fromRich: string | null | undefined
  if (rich) {
    const idx = getRichIndex(rich)
    fromRich =
      (heroOrder !== undefined ? idx.heroByOrder.get(heroOrder)?.dn : undefined) ??
      (cdn !== null ? idx.heroByCdn.get(cdn)?.dn : undefined)
  }
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
  const richIdx = getRichIndex(rich)
  for (const [a, b, wr, inc] of rich.pairs) {
    if (a !== i && b !== i) continue
    const partnerIndex = a === i ? b : a
    const slot = slotByIndex(compact, partnerIndex)
    const entry: Partner = {
      i: partnerIndex,
      name: slot?.name ?? richIdx.abilityByIndex.get(partnerIndex)?.n ?? null,
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
  const richIdx = getRichIndex(rich)
  return rich.heroPairs
    .filter(([, ability]) => ability === i)
    .map(([heroOrder, , wr, inc]) => ({
      heroOrder,
      cdn: compact?.pool?.[heroOrder]?.[0] ?? richIdx.heroByOrder.get(heroOrder)?.cdn ?? null,
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
  const richIdx = getRichIndex(rich)
  return rich.heroPairs
    .filter(([row]) => row === heroOrder)
    .map(([, i, wr, inc]) => {
      const slot = slotByIndex(compact, i)
      return {
        i,
        name: slot?.name ?? richIdx.abilityByIndex.get(i)?.n ?? null,
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
