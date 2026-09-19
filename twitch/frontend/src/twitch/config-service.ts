import type { GameRectCalibration } from '../geometry/types'

// Broadcaster configuration segment (<= 5 KB): where the game sits in the stream canvas,
// the in-game top-bar fine-tune, and the launcher corner. Parsed defensively — a viewer
// must never break on a malformed segment.

export type LauncherCorner = 'tl' | 'tr' | 'bl' | 'br'

export interface BroadcasterConfig {
  v: 1
  gameRect: GameRectCalibration
  ingame: { dx: number; dy: number; scale: number }
  launcherCorner: LauncherCorner
}

export const CONFIG_VERSION = '1'

export const DEFAULT_CONFIG: BroadcasterConfig = {
  v: 1,
  gameRect: { x: 0, y: 0, w: 1, h: 1 },
  ingame: { dx: 0, dy: 0, scale: 1 },
  launcherCorner: 'tl',
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function parseBroadcasterConfig(content: string | undefined | null): BroadcasterConfig {
  if (!content) return DEFAULT_CONFIG
  try {
    const raw = JSON.parse(content) as Partial<BroadcasterConfig>
    const rect = raw.gameRect ?? DEFAULT_CONFIG.gameRect
    const ingame = raw.ingame ?? DEFAULT_CONFIG.ingame
    const corner = raw.launcherCorner
    return {
      v: 1,
      gameRect: {
        x: clamp(rect.x, 0, 0.9, 0),
        y: clamp(rect.y, 0, 0.9, 0),
        w: clamp(rect.w, 0.1, 1, 1),
        h: clamp(rect.h, 0.1, 1, 1),
      },
      ingame: {
        dx: clamp(ingame.dx, -0.2, 0.2, 0),
        dy: clamp(ingame.dy, -0.2, 0.2, 0),
        scale: clamp(ingame.scale, 0.5, 1.5, 1),
      },
      launcherCorner:
        corner === 'tl' || corner === 'tr' || corner === 'bl' || corner === 'br' ? corner : 'tl',
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function serializeBroadcasterConfig(config: BroadcasterConfig): string {
  return JSON.stringify(config)
}
