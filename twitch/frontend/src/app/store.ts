import { create } from 'zustand'
import type { TwitchCompactState, TwitchLiveState, TwitchRichState } from '@shared/types/twitch'
import type { Catalog } from '../data/catalog-types'
import { DEFAULT_CONFIG, type BroadcasterConfig } from '../twitch/config-service'
import type { TwitchAuth } from '../twitch/ext'

// Single store for the overlay: writers are non-React modules (bootstrap, delay buffer,
// fetches), readers are components. `compact` is ALWAYS the delay-applied one; rich states
// are keyed by draft id so a new draft's rich never replaces the delayed board early.

export type Connection = 'init' | 'live' | 'stale' | 'offline'

export type Selection =
  | { kind: 'ability'; i: number }
  | { kind: 'hero'; heroOrder: number }
  | { kind: 'player'; playerIndex: number }
  | null

const RICH_KEEP = 2
const STORAGE_KEY = 'adplus.ui.v1'

function readUi(): { minimized: boolean } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return { minimized: JSON.parse(raw).minimized === true }
  } catch {
    // storage unavailable
  }
  return { minimized: false }
}

function writeUi(minimized: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ minimized }))
  } catch {
    // storage unavailable
  }
}

export interface OverlayState {
  auth: TwitchAuth | null
  context: {
    latencySec: number
    videoRes: { w: number; h: number } | null
    theme: 'light' | 'dark'
    language: string
  }
  config: BroadcasterConfig
  connection: Connection
  compact: TwitchCompactState | null
  /** Caster telemetry for the CURRENT draft; null while playing or pre-game. */
  live: TwitchLiveState | null
  rich: Record<string, TwitchRichState>
  richOrder: string[]
  catalog: Catalog | null
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * Demo only (?demo=<mode>). Draws the pool's own icons behind the hit regions
   * so the standalone demo shows a board instead of a blank frame. Never set in
   * production — over a real stream the board is the video underneath.
   */
  demoBoard: boolean
  ui: {
    /** Caster scoreboard open (in game, telemetry present). */
    caster: boolean
    minimized: boolean
    selection: Selection
    expandAll: boolean
    overview: boolean
  }

  setAuth(auth: TwitchAuth): void
  setContext(patch: Partial<OverlayState['context']>): void
  setConfig(config: BroadcasterConfig): void
  setConnection(connection: Connection): void
  applyCompact(compact: TwitchCompactState): void
  applyLive(live: TwitchLiveState): void
  setRich(rich: TwitchRichState): void
  setCatalog(catalog: Catalog | null, status: OverlayState['catalogStatus']): void
  select(selection: Selection): void
  toggleMinimized(): void
  setExpandAll(value: boolean): void
  setOverview(value: boolean): void
  setCaster(value: boolean): void
  setDemoBoard(value: boolean): void
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  auth: null,
  context: { latencySec: 0, videoRes: null, theme: 'dark', language: 'en' },
  config: DEFAULT_CONFIG,
  connection: 'init',
  compact: null,
  live: null,
  rich: {},
  richOrder: [],
  catalog: null,
  catalogStatus: 'idle',
  demoBoard: false,
  ui: { ...readUi(), selection: null, expandAll: false, overview: false, caster: false },

  setAuth: (auth) => set({ auth }),
  setContext: (patch) => set({ context: { ...get().context, ...patch } }),
  setConfig: (config) => set({ config }),
  setConnection: (connection) => set({ connection }),
  applyCompact: (compact) => {
    const previous = get().compact
    const draftChanged = previous?.d !== compact.d
    set({
      compact,
      // Telemetry belongs to a draft; a new one starts with none.
      ...(draftChanged ? { live: null } : {}),
      connection: 'live',
      ui: draftChanged
        ? { ...get().ui, selection: null, expandAll: false, overview: false }
        : get().ui,
    })
  },
  applyLive: (live) => {
    // Ignore telemetry for a draft the viewer is not showing (a tick that
    // arrives across a draft boundary), and never step backwards.
    const compact = get().compact
    if (compact && live.d !== compact.d) return
    const current = get().live
    if (current && current.d === live.d && live.r <= current.r) return
    set({ live })
  },
  setRich: (rich) => {
    const current = { ...get().rich, [rich.d]: rich }
    const order = [...get().richOrder.filter((d) => d !== rich.d), rich.d]
    while (order.length > RICH_KEEP) {
      const drop = order.shift()
      if (drop) delete current[drop]
    }
    set({ rich: current, richOrder: order })
  },
  setCatalog: (catalog, catalogStatus) => set({ catalog, catalogStatus }),
  select: (selection) => set({ ui: { ...get().ui, selection } }),
  toggleMinimized: () => {
    const minimized = !get().ui.minimized
    writeUi(minimized)
    set({ ui: { ...get().ui, minimized, selection: null, expandAll: false, overview: false } })
  },
  setExpandAll: (value) => set({ ui: { ...get().ui, expandAll: value } }),
  setOverview: (value) => set({ ui: { ...get().ui, overview: value } }),
  setCaster: (value) => set({ ui: { ...get().ui, caster: value } }),
  setDemoBoard: (value) => set({ demoBoard: value }),
}))

/** Rich state matching the current compact's draft id (null until fetched). */
export function selectCurrentRich(state: OverlayState): TwitchRichState | null {
  const d = state.compact?.d
  return d ? (state.rich[d] ?? null) : null
}
