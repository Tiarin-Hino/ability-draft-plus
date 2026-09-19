import sharp from 'sharp'
import type { DecodedScreenshot } from './preprocessing'
import type { PxRect } from '@core/domain/topbar-seats'
import { computePixelStats, makeIconTemplate, scoreTemplates } from './template-matcher'

// @DEV-GUIDE: Image side of top-bar seat identification (core/domain/topbar-seats.ts).
// Both the in-game portrait and the hero's CDN art (userData/stream-icons/heroes,
// 256x144) are normalized to PORTRAIT_COMPARE, and only the UPPER band is compared:
// the lower corners of a top-bar portrait carry HUD overlays (rank triangle,
// Aghanim's shard icon) that no art contains.
// The HUD shows the portrait art at a slightly different framing than the CDN
// image, so each hero is expanded into zoomed/offset VARIANTS and a portrait's
// score for a hero is its best variant. Parameters are the ones validated
// offline 2026-09-16 (10/10 per team on a live 2560x1440 frame).

export const PORTRAIT_COMPARE = { width: 64, height: 36, bandRows: 22 } as const

const ZOOMS = [1, 1.08, 1.16, 1.25] as const

function upperBand(raw: Buffer): Uint8Array {
  const { width, bandRows } = PORTRAIT_COMPARE
  const bytes = width * bandRows * 3
  return new Uint8Array(raw.buffer, raw.byteOffset, bytes).slice()
}

/** Crop one portrait from a raw RGB frame into a comparison vector. */
export async function cropPortraitVector(
  frame: DecodedScreenshot,
  rect: PxRect,
): Promise<Uint8Array> {
  const left = Math.max(0, Math.min(rect.x, frame.width - 1))
  const top = Math.max(0, Math.min(rect.y, frame.height - 1))
  const width = Math.max(1, Math.min(rect.w, frame.width - left))
  const height = Math.max(1, Math.min(rect.h, frame.height - top))
  const raw = await sharp(frame.data, {
    raw: { width: frame.width, height: frame.height, channels: 3 },
  })
    .extract({ left, top, width, height })
    .resize(PORTRAIT_COMPARE.width, PORTRAIT_COMPARE.height, { fit: 'fill', kernel: 'linear' })
    .raw()
    .toBuffer()
  return upperBand(raw)
}

/** A hero's portrait art (file path or encoded image bytes) expanded into its comparison variants. */
export async function loadPortraitArtVariants(art: string | Buffer): Promise<Uint8Array[]> {
  const { width, height } = PORTRAIT_COMPARE
  const variants: Uint8Array[] = []
  for (const zoom of ZOOMS) {
    const zw = Math.round(width * zoom)
    const zh = Math.round(height * zoom)
    const resized = await sharp(art)
      .removeAlpha()
      .resize(zw, zh, { fit: 'fill', kernel: 'linear' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const xs = [...new Set([0, Math.floor((zw - width) / 2), zw - width])]
    const ys = [...new Set([0, Math.floor((zh - height) / 2), zh - height])]
    for (const left of xs) {
      for (const top of ys) {
        const raw = await sharp(resized.data, {
          raw: { width: resized.info.width, height: resized.info.height, channels: 3 },
        })
          .extract({ left, top, width, height })
          .raw()
          .toBuffer()
        variants.push(upperBand(raw))
      }
    }
  }
  return variants
}

/** NCC of a portrait against a hero: the best of the hero's variants. */
export function scorePortrait(portrait: Uint8Array, variants: readonly Uint8Array[]): number {
  const stats = computePixelStats(portrait)
  if (stats.std === 0) return -1
  const templates = variants.map((vec, i) => makeIconTemplate(String(i), vec))
  const { best } = scoreTemplates(portrait, stats, templates)
  return best === -Infinity ? -1 : best
}
