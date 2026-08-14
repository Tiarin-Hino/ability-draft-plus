// @DEV-GUIDE: Dev-time generator: cuts the AI-generated UI sheets in design/ into
// the individual sprites bundled with the stream renderer
// (src/renderer/stream/src/assets/ui/). Committed outputs; rerun when sheets
// change. Run: node scripts/build-stream-ui-assets.mjs
//
// - design/ui/tile-frames.png    -> 5 tile frame sprites (empty/normal/toptier/picked/unknown)
// - design/sigils/sigils-mono.png -> white team sigils with alpha (radiant, dire)
// - design/sigils/sigils-color.png -> colored team crests with alpha
// - design/ui/topbar-medallion.png -> clock medallion + one green + one red gem sprite
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/renderer/stream/src/assets/ui')
await mkdir(OUT, { recursive: true })

async function loadRaw(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

/** Horizontal content bands: column ranges where any pixel exceeds `threshold`. */
function columnBands({ data, width, height }, threshold, minGapFrac = 0.01) {
  const profile = new Array(width).fill(0)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (lum(data, (y * width + x) * 4) > threshold) profile[x]++
    }
  }
  const minGap = Math.round(width * minGapFrac)
  const bands = []
  let start = null
  let gap = 0
  for (let x = 0; x < width; x++) {
    if (profile[x] > 0) {
      if (start === null) start = x
      gap = 0
    } else if (start !== null) {
      gap++
      if (gap >= minGap) {
        bands.push([start, x - gap])
        start = null
        gap = 0
      }
    }
  }
  if (start !== null) bands.push([start, width - 1 - gap])
  return bands
}

/** Tight vertical bounds of content within a column range. */
function rowBounds({ data, width, height }, x0, x1, threshold) {
  let top = height
  let bottom = 0
  for (let y = 0; y < height; y++) {
    for (let x = x0; x <= x1; x++) {
      if (lum(data, (y * width + x) * 4) > threshold) {
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  return [top, bottom]
}

async function extractCell(src, raw, [x0, x1], threshold, out, { alphaFromBlack } = {}) {
  const [y0, y1] = rowBounds(raw, x0, x1, threshold)
  const pad = 3
  const region = {
    left: Math.max(0, x0 - pad),
    top: Math.max(0, y0 - pad),
    width: Math.min(raw.width, x1 + pad + 1) - Math.max(0, x0 - pad),
    height: Math.min(raw.height, y1 + pad + 1) - Math.max(0, y0 - pad),
  }
  let img = sharp(src).extract(region)
  if (alphaFromBlack) {
    // Turn the black backdrop transparent: alpha = max(r,g,b) per pixel
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2])
    }
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  }
  await img.png().toFile(out)
  return region
}

// ── Tile frames: 5 cells left to right ─────────────────────────────────────
{
  const src = join(ROOT, 'design/ui/tile-frames.png')
  const raw = await loadRaw(src)
  const bands = columnBands(raw, 18)
  if (bands.length !== 5) {
    throw new Error(`tile-frames.png: found ${bands.length} frames, expected 5`)
  }
  const names = ['empty', 'normal', 'toptier', 'picked', 'unknown']
  for (let i = 0; i < 5; i++) {
    await extractCell(src, raw, bands[i], 18, join(OUT, `tile-frame-${names[i]}.png`))
  }
  console.log('tile frames: 5 sprites')
}

// ── Mono sigils: white radiant, white dire (grey duplicates skipped) ───────
{
  const src = join(ROOT, 'design/sigils/sigils-mono.png')
  const raw = await loadRaw(src)
  const bands = columnBands(raw, 60)
  if (bands.length < 2) {
    throw new Error(`sigils-mono.png: found ${bands.length} sigils, expected >= 2`)
  }
  await extractCell(src, raw, bands[0], 60, join(OUT, 'sigil-radiant.png'), { alphaFromBlack: true })
  await extractCell(src, raw, bands[1], 60, join(OUT, 'sigil-dire.png'), { alphaFromBlack: true })
  console.log('mono sigils: 2 sprites')
}

// ── Colored crests ─────────────────────────────────────────────────────────
{
  const src = join(ROOT, 'design/sigils/sigils-color.png')
  const raw = await loadRaw(src)
  const bands = columnBands(raw, 30)
  if (bands.length !== 2) {
    throw new Error(`sigils-color.png: found ${bands.length} crests, expected 2`)
  }
  await extractCell(src, raw, bands[0], 30, join(OUT, 'crest-radiant.png'), { alphaFromBlack: true })
  await extractCell(src, raw, bands[1], 30, join(OUT, 'crest-dire.png'), { alphaFromBlack: true })
  console.log('colored crests: 2 sprites')
}

// ── Clock medallion from the top bar sheet ─────────────────────────────────
// The bar connects everything horizontally, so column bands see one blob.
// The medallion is the only structure whose vertical extent far exceeds the
// bar's — but the ring's outermost side arcs sit INSIDE the bar's y-band, so
// the extent test alone clips the circle. Expand the detected span by 20% per
// side to recover the full ring (the sliver of bar hairline that rides along
// is invisible at display size).
{
  const src = join(ROOT, 'design/ui/topbar-medallion.png')
  const raw = await loadRaw(src)
  const { data, width, height } = raw

  const extents = new Array(width).fill(0).map((_, x) => {
    let top = height
    let bottom = -1
    for (let y = 0; y < height; y++) {
      if (lum(data, (y * width + x) * 4) > 18) {
        if (y < top) top = y
        bottom = y
      }
    }
    return bottom < 0 ? 0 : bottom - top + 1
  })
  const barHeight = [...extents].filter((e) => e > 0).sort((a, b) => a - b)[
    Math.floor(extents.filter((e) => e > 0).length / 2)
  ]
  const medCols = extents
    .map((e, x) => (e > barHeight * 1.35 ? x : -1))
    .filter((x) => x >= 0)
  const pad = Math.round((Math.max(...medCols) - Math.min(...medCols)) * 0.2)
  const mx0 = Math.max(0, Math.min(...medCols) - pad)
  const mx1 = Math.min(width - 1, Math.max(...medCols) + pad)
  const [my0, my1] = rowBounds(raw, mx0, mx1, 18)
  await extractCell(src, raw, [mx0, mx1], 18, join(OUT, 'clock-medallion.png'), {
    alphaFromBlack: true,
  })
  console.log(`medallion: ${mx1 - mx0}x${my1 - my0}`)
}

console.log('done ->', OUT)
