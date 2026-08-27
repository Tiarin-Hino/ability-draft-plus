import type { StreamTeam } from '@shared/types/stream'

// @DEV-GUIDE: Display options for the picks strips and their URL round-trip.
// OBS browser sources do NOT share localStorage with the desktop browser where the
// streamer runs the setup page, so the URL is the ONLY reliable settings transport:
// the setup page bakes every non-default option into the two /picks?team=… URLs it
// generates, and the strip pages read them back here. Keep defaults in sync with
// buildStripUrl (an omitted param must equal its default).

export type PicksBg = 'transparent' | 'chroma' | 'dark'
export type StripAlign = 'left' | 'right'

export interface StripOptions {
  bg: PicksBg | null // null = auto: transparent inside OBS, dark in a browser
  names: boolean
  /** Which page edge the rows anchor to; 'right' also mirrors the row order
   * (portrait outermost). */
  align: StripAlign
  /** Team-colored frame around the whole strip. */
  frame: boolean
  rowGap: number
  slotGap: number
  heroGap: number
  ultGap: number
}

export const SPACING_DEFAULTS = {
  rowGap: 14,
  slotGap: 4,
  heroGap: 4,
  ultGap: 10,
} as const

export const SPACING_LIMITS = {
  rowGap: { min: 0, max: 60 },
  slotGap: { min: 0, max: 30 },
  heroGap: { min: 0, max: 30 },
  ultGap: { min: 0, max: 40 },
} as const

export function defaultAlign(team: StreamTeam): StripAlign {
  return team === 'radiant' ? 'left' : 'right'
}

function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const raw = params.get(name)
  if (raw === null) return fallback
  const value = parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(limits.max, Math.max(limits.min, value))
}

export function parseStripOptions(
  params: URLSearchParams,
  team: StreamTeam,
): StripOptions {
  const bg = params.get('bg')
  const align = params.get('align')
  return {
    bg: bg === 'transparent' || bg === 'chroma' || bg === 'dark' ? bg : null,
    names: params.get('names') !== '0',
    align: align === 'left' || align === 'right' ? align : defaultAlign(team),
    frame: params.get('frame') !== '0',
    rowGap: intParam(params, 'rowgap', SPACING_DEFAULTS.rowGap, SPACING_LIMITS.rowGap),
    slotGap: intParam(params, 'slotgap', SPACING_DEFAULTS.slotGap, SPACING_LIMITS.slotGap),
    heroGap: intParam(params, 'herogap', SPACING_DEFAULTS.heroGap, SPACING_LIMITS.heroGap),
    ultGap: intParam(params, 'ultgap', SPACING_DEFAULTS.ultGap, SPACING_LIMITS.ultGap),
  }
}

/** Build a strip URL with only the non-default options as params. */
export function buildStripUrl(
  origin: string,
  team: StreamTeam,
  options: StripOptions,
): string {
  const params = new URLSearchParams({ team })
  if (options.bg) params.set('bg', options.bg)
  if (!options.names) params.set('names', '0')
  if (options.align !== defaultAlign(team)) params.set('align', options.align)
  if (!options.frame) params.set('frame', '0')
  if (options.rowGap !== SPACING_DEFAULTS.rowGap) params.set('rowgap', String(options.rowGap))
  if (options.slotGap !== SPACING_DEFAULTS.slotGap) params.set('slotgap', String(options.slotGap))
  if (options.heroGap !== SPACING_DEFAULTS.heroGap) params.set('herogap', String(options.heroGap))
  if (options.ultGap !== SPACING_DEFAULTS.ultGap) params.set('ultgap', String(options.ultGap))
  return `${origin}/picks?${params.toString()}`
}
