// @DEV-GUIDE: Dev-time generator: builds the two custom stream-view fonts from the
// AI-generated glyph sheets in design/fonts/ and writes .otf files into
// src/renderer/stream/src/assets/fonts/ (committed; this script only reruns when
// the sheets change). Pipeline per sheet: threshold -> segment glyph cells by
// projection profiles (rows, then columns; vertically stacked parts like ':' stay
// in one cell) -> potrace each cell to an SVG path -> convert to an opentype.js
// path scaled so cap height = 700/1000em with the per-row baseline at y=0 ->
// assemble the font. Run: node scripts/build-stream-fonts.mjs
import sharp from 'sharp'
import potrace from 'potrace'
import opentype from 'opentype.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'src/renderer/stream/src/assets/fonts')

const THRESHOLD = 110
const UNITS_PER_EM = 1000
const CAP_HEIGHT = 700
const SIDE_BEARING = 42

/** Load a sheet as a binarized bitmap { data: Uint8Array(0|1), width, height }. */
async function loadBitmap(path) {
  const { data, info } = await sharp(path)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const bits = new Uint8Array(info.width * info.height)
  for (let i = 0; i < data.length; i++) bits[i] = data[i] > THRESHOLD ? 1 : 0
  return { data: bits, width: info.width, height: info.height }
}

/** Contiguous index ranges where the projection profile is non-zero. */
function bands(profile, minGap) {
  const ranges = []
  let start = null
  let gap = 0
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > 0) {
      if (start === null) start = i
      gap = 0
    } else if (start !== null) {
      gap++
      if (gap >= minGap) {
        ranges.push([start, i - gap])
        start = null
        gap = 0
      }
    }
  }
  if (start !== null) ranges.push([start, profile.length - 1 - gap])
  return ranges
}

/** Segment the sheet into per-glyph cells, row by row, left to right. */
function segment(bmp) {
  const { data, width, height } = bmp
  const rowProfile = new Array(height).fill(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rowProfile[y] += data[y * width + x]
  }
  // Rows must be separated by a real gap; glyph-internal gaps (the counter of
  // '=' etc.) never span the sheet height, so a modest minimum is enough.
  const rows = bands(rowProfile, Math.round(height * 0.02))

  const cells = []
  for (const [y0, y1] of rows) {
    const colProfile = new Array(width).fill(0)
    for (let x = 0; x < width; x++) {
      for (let y = y0; y <= y1; y++) colProfile[x] += data[y * width + x]
    }
    const cols = bands(colProfile, Math.round(width * 0.008))
    const rowCells = []
    for (const [x0, x1] of cols) {
      // Tight vertical bounds within the cell
      let top = y1
      let bottom = y0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (data[y * width + x]) {
            if (y < top) top = y
            if (y > bottom) bottom = y
          }
        }
      }
      rowCells.push({ x0, x1, y0: top, y1: bottom })
    }
    cells.push(rowCells)
  }
  return cells
}

/** Trace one glyph cell (cropped from the source PNG) into an SVG path string. */
function traceCell(png, cell) {
  const pad = 4
  return new Promise((resolve, reject) => {
    sharp(png)
      .extract({
        left: Math.max(0, cell.x0 - pad),
        top: Math.max(0, cell.y0 - pad),
        width: cell.x1 - cell.x0 + 1 + pad * 2,
        height: cell.y1 - cell.y0 + 1 + pad * 2,
      })
      // Potrace traces DARK shapes; the sheets are white-on-black, so invert
      .negate()
      .png()
      .toBuffer()
      .then((buf) => {
        const tracer = new potrace.Potrace({
          threshold: THRESHOLD,
          turdSize: 6,
          alphaMax: 0.55, // keep the chiseled corners angular
          optTolerance: 0.25,
        })
        tracer.loadImage(buf, (err) => {
          if (err) return reject(err instanceof Error ? err : new Error(String(err)))
          resolve(tracer.getPathTag().match(/d="([^"]+)"/)[1])
        })
      })
      .catch(reject)
  })
}

/** Minimal SVG path parser (potrace emits M/L/C/Q/Z absolute + relative). */
function svgPathToOpentype(d, tx) {
  const path = new opentype.Path()
  const tokens = d.match(/[MLCQZmlcqz]|-?\d*\.?\d+/g) ?? []
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    const cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case 'M': {
        const x = num() + (rel ? cx : 0)
        const y = num() + (rel ? cy : 0)
        path.moveTo(tx.x(x), tx.y(y))
        cx = x; cy = y; sx = x; sy = y
        // Subsequent implicit pairs are LineTos
        while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i])) {
          const lx = num() + (rel ? cx : 0)
          const ly = num() + (rel ? cy : 0)
          path.lineTo(tx.x(lx), tx.y(ly))
          cx = lx; cy = ly
        }
        break
      }
      case 'L': {
        do {
          const x = num() + (rel ? cx : 0)
          const y = num() + (rel ? cy : 0)
          path.lineTo(tx.x(x), tx.y(y))
          cx = x; cy = y
        } while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i]))
        break
      }
      case 'C': {
        do {
          const x1 = num() + (rel ? cx : 0)
          const y1 = num() + (rel ? cy : 0)
          const x2 = num() + (rel ? cx : 0)
          const y2 = num() + (rel ? cy : 0)
          const x = num() + (rel ? cx : 0)
          const y = num() + (rel ? cy : 0)
          path.curveTo(tx.x(x1), tx.y(y1), tx.x(x2), tx.y(y2), tx.x(x), tx.y(y))
          cx = x; cy = y
        } while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i]))
        break
      }
      case 'Q': {
        do {
          const x1 = num() + (rel ? cx : 0)
          const y1 = num() + (rel ? cy : 0)
          const x = num() + (rel ? cx : 0)
          const y = num() + (rel ? cy : 0)
          path.quadTo(tx.x(x1), tx.y(y1), tx.x(x), tx.y(y))
          cx = x; cy = y
        } while (i < tokens.length && !/[a-zA-Z]/.test(tokens[i]))
        break
      }
      case 'Z':
        path.close()
        cx = sx; cy = sy
        break
      default:
        throw new Error(`Unhandled SVG path command: ${cmd}`)
    }
  }
  return path
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/**
 * Build one font from a list of sheets. Each sheet: { png, rows: string[] } where
 * rows[r] holds the characters of row r in left-to-right order.
 */
async function buildFont({ name, sheets, tabularDigits }) {
  const glyphEntries = []

  for (const sheet of sheets) {
    const bmp = await loadBitmap(sheet.png)
    const cells = segment(bmp)
    if (cells.length !== sheet.rows.length) {
      throw new Error(
        `${sheet.png}: found ${cells.length} rows, expected ${sheet.rows.length}`,
      )
    }
    const sheetEntries = []
    for (let r = 0; r < cells.length; r++) {
      const chars = [...sheet.rows[r]]
      if (cells[r].length !== chars.length) {
        throw new Error(
          `${sheet.png} row ${r}: found ${cells[r].length} cells, expected ${chars.length} (${sheet.rows[r]})`,
        )
      }
      const baseline = median(cells[r].map((c) => c.y1))
      for (let c = 0; c < chars.length; c++) {
        sheetEntries.push({ char: chars[c], cell: cells[r][c], baseline, png: sheet.png })
      }
    }
    // Sheets differ in resolution and drawn glyph size, so the em scale is
    // PER-SHEET, referenced to that sheet's own cap-height glyphs.
    const capHeights = sheetEntries
      .filter((e) => [...sheet.capChars].includes(e.char))
      .map((e) => e.cell.y1 - e.cell.y0)
    if (capHeights.length === 0) {
      throw new Error(`${sheet.png}: no capChars (${sheet.capChars}) found for scaling`)
    }
    const sheetScale = CAP_HEIGHT / median(capHeights)
    // `only`: cherry-pick a subset of the sheet's glyphs (e.g. reuse '.' and '-'
    // from the punctuation sheet in the score font)
    const wanted = sheet.only ? [...sheet.only] : null
    for (const e of sheetEntries) {
      if (wanted && !wanted.includes(e.char)) continue
      glyphEntries.push({ ...e, scale: sheetScale })
    }
  }

  const glyphs = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 500,
      path: new opentype.Path(),
    }),
    new opentype.Glyph({
      name: 'space',
      unicode: 32,
      advanceWidth: 280,
      path: new opentype.Path(),
    }),
  ]

  // Tabular digits: every 0-9 glyph gets the same advance, centered
  const digitWidths = glyphEntries
    .filter((g) => /[0-9]/.test(g.char))
    .map((g) => (g.cell.x1 - g.cell.x0 + 1) * g.scale)
  const tabularAdvance =
    digitWidths.length > 0 ? Math.round(Math.max(...digitWidths) + SIDE_BEARING * 2) : 0

  for (const entry of glyphEntries) {
    const { char, cell, baseline, png, scale } = entry
    const d = await traceCell(png, cell)
    const pad = 4
    const glyphWidth = (cell.x1 - cell.x0 + 1) * scale
    const isTabular = tabularDigits && /[0-9]/.test(char)
    const advance = isTabular
      ? tabularAdvance
      : Math.round(glyphWidth + SIDE_BEARING * 2)
    const leftBearing = isTabular ? (tabularAdvance - glyphWidth) / 2 : SIDE_BEARING
    // Trace coords are relative to the padded crop; map back into sheet space,
    // then into font space (baseline at y=0, y flipped)
    const tx = {
      x: (x) => Math.round((x - pad) * scale + leftBearing),
      y: (y) => Math.round((baseline - (cell.y0 - pad) - y) * scale),
    }
    glyphs.push(
      new opentype.Glyph({
        name: char === ' ' ? 'space' : char,
        unicode: char.codePointAt(0),
        advanceWidth: advance,
        path: svgPathToOpentype(d, tx),
      }),
    )
  }

  const font = new opentype.Font({
    familyName: name,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 780,
    descender: -220,
    glyphs,
  })
  return Buffer.from(font.toArrayBuffer())
}

await mkdir(OUT_DIR, { recursive: true })

const display = await buildFont({
  name: 'ADPlus Display',
  sheets: [
    {
      png: join(ROOT, 'design/fonts/display-caps.png'),
      rows: ['ABCDEF', 'GHIJKL', 'MNOPQR', 'STUVWX', 'YZ0123', '456789'],
      capChars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    },
    {
      png: join(ROOT, 'design/fonts/punctuation.png'),
      rows: ['.,:-!?&+'],
      capChars: '!?&',
    },
  ],
  tabularDigits: false,
})
await writeFile(join(OUT_DIR, 'adplus-display.otf'), display)
console.log(`adplus-display.otf written (${Math.round(display.length / 1024)}KB)`)

const score = await buildFont({
  name: 'ADPlus Score',
  sheets: [
    {
      png: join(ROOT, 'design/fonts/score-digits.png'),
      rows: ['012345', '6789%:'],
      capChars: '0123456789',
    },
    {
      png: join(ROOT, 'design/fonts/punctuation.png'),
      rows: ['.,:-!?&+'],
      capChars: '!?&',
      only: '.-',
    },
  ],
  tabularDigits: true,
})
await writeFile(join(OUT_DIR, 'adplus-score.otf'), score)
console.log(`adplus-score.otf written (${Math.round(score.length / 1024)}KB)`)
