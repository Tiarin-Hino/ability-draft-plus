#!/usr/bin/env node
// Joins a diagnostic_draft_cycle.py run (ground-truth lineups + final boards)
// with the app's per-scan diagnostics (userData/debug/scan-diagnostics/*.jsonl,
// written by scan-trigger-service in dev builds) into an HTML report:
//   - POOL:   last initial scan vs the lineup's slot-level expected abilities
//   - PICKS:  final full-rescan state per pick slot + rejection churn counts
//   - MODELS: model-tile reference matches vs the known 12-hero lineup
//   - OCR:    resolved hero names vs the lineup set
// Usage: node scripts/analyze-draft-diagnostics.mjs --run <dir> [--app-data <dir>] [--out <file>]

import { readdir, readFile, writeFile } from 'fs/promises'
import { join, basename } from 'path'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const runDir = arg('run')
if (!runDir) {
  console.error('Usage: node scripts/analyze-draft-diagnostics.mjs --run <dir> [--app-data <dir>] [--out <file>]')
  process.exit(1)
}
const appData = arg(
  'app-data',
  join(process.env.APPDATA ?? '', 'ability-draft-plus'),
)
const outPath = arg('out', join(runDir, 'report.html'))

// --- Load the app's scan diagnostics (all sessions; filtered per window) ---
const diagDir = join(appData, 'debug', 'scan-diagnostics')
let scanLines = []
try {
  for (const f of (await readdir(diagDir)).filter((f) => f.endsWith('.jsonl'))) {
    const raw = (await readFile(join(diagDir, f), 'utf8')).replace(/^﻿/, '')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        scanLines.push(JSON.parse(line))
      } catch {
        /* torn line (app crashed mid-write) — skip */
      }
    }
  }
} catch (e) {
  console.error(
    `No scan diagnostics at ${diagDir} (${e.message}).\n` +
      'The app never recorded a scan during the run. Causes: the app was not a dev ' +
      'build, or its overlay was never activated / auto draft tracking was off ' +
      '(the diagnostic script now activates the overlay itself and verifies scans ' +
      'land — re-run it with the dev app open and auto draft tracking enabled).',
  )
  process.exit(1)
}
scanLines.sort((a, b) => (a.ts < b.ts ? -1 : 1))
console.log(`Loaded ${scanLines.length} scan records from ${diagDir}`)

// --- Load iterations ---
const iterDirs = (await readdir(runDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && d.name.startsWith('iteration-'))
  .map((d) => d.name)
  .sort()

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)

const sections = []
const totals = { poolOk: 0, poolBad: 0, poolMiss: 0, modelOk: 0, modelBad: 0, modelMiss: 0, ocrOk: 0, ocrBad: 0, picksResolved: 0, picksUnresolved: 0 }

for (const dirName of iterDirs) {
  const iterDir = join(runDir, dirName)
  let record
  try {
    record = JSON.parse(
      (await readFile(join(iterDir, 'iteration.json'), 'utf8')).replace(/^﻿/, ''),
    )
  } catch (e) {
    console.warn(`Skipping ${dirName}: ${e.message}`)
    continue
  }

  const winStart = new Date(new Date(record.draftReachedAt).getTime() - 90_000).toISOString()
  const winEnd = new Date(new Date(record.endedAt).getTime() + 15_000).toISOString()
  const lines = scanLines.filter((l) => l.ts >= winStart && l.ts <= winEnd)

  const lineupByOrder = new Map(record.lineup.map((h) => [h.heroOrder, h]))
  // The app's DB carries Windrun-style hero names ('abyssalunderlord') while the
  // harness's ground truth uses engine console names ('abyssal_underlord').
  // Compare on a punctuation-free form or every such hero reads as a false miss
  // (that bug alone reported OCR at 63.9% when it was actually 94.4%).
  // ...plus the one genuine ALIAS (not a punctuation difference): the app/Windrun
  // call Zeus 'zeus' while the engine console name is 'zuus' (refresh_db.py maps
  // it). Without this a correct Zeus read reports as "NOT IN LINEUP".
  const HERO_ALIASES = { zeus: 'zuus' }
  const heroKey = (n) => {
    const k = n.replace(/[^a-z0-9]/gi, '').toLowerCase()
    return HERO_ALIASES[k] ?? k
  }
  const heroSet = new Set(record.lineup.map((h) => heroKey(h.hero)))

  // --- POOL: last initial scan in window ---
  const initial = [...lines].reverse().find((l) => l.isInitialScan)
  const poolRows = []
  let poolOk = 0, poolBad = 0, poolMiss = 0
  if (initial && initial.results && !Array.isArray(initial.results)) {
    const slots = [...(initial.results.ultimates ?? []), ...(initial.results.standard ?? [])]
    for (const slot of slots) {
      const hero = lineupByOrder.get(slot.hero_order)
      // A slot can legitimately hold one of SEVERAL abilities: facets are gone
      // from the game, but Jakiro's E, Troll's W and the Invoker/Kez pools are
      // still randomised per draft. Accept any candidate for that slot —
      // matching only the first would report the other variant as a misread.
      const expected = (hero?.abilities ?? []).filter(
        (a) => a.isUltimate === slot.is_ultimate && (slot.is_ultimate || a.abilityOrder === slot.ability_order),
      )
      if (expected.length === 0) continue // no ground truth for this slot
      const expectedNames = expected.map((a) => a.name)
      let verdict
      if (slot.name !== null && expectedNames.includes(slot.name)) { verdict = 'OK'; poolOk++ }
      else if (slot.name === null) { verdict = 'MISS'; poolMiss++ }
      else { verdict = 'MISREAD'; poolBad++ }
      if (verdict !== 'OK') {
        poolRows.push(
          `<tr class="${verdict === 'MISREAD' ? 'bad' : 'miss'}"><td>${slot.hero_order}</td><td>${esc(expectedNames.join(' | '))}</td><td>${esc(slot.name ?? '∅')}</td><td>${slot.confidence?.toFixed(3) ?? ''}</td><td>${verdict}</td></tr>`,
        )
      }
    }
  }

  // --- PICKS: final per-slot state + rejection churn ---
  // The app MERGES targeted rescans into its baseline (see scan-processor), so a
  // slot's final state is whatever the LATEST scan covering that slot said — not
  // whatever the last *full* rescan said. Reading only full rescans reports slots
  // that a later targeted rescan already resolved as unresolved (it flagged a
  // Freezing Field read at 0.994 confidence as a miss).
  const finalBySlot = new Map()
  const rejectionCounts = new Map()
  for (const l of lines) {
    if (l.isInitialScan || !Array.isArray(l.results)) continue
    for (const s of l.results) {
      const key = `${s.hero_order}@${s.coord.x},${s.coord.y}`
      finalBySlot.set(key, s)
      if (s.rejectedMatch) {
        rejectionCounts.set(key, (rejectionCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const pickRows = []
  let picksResolved = 0, picksUnresolved = 0
  {
    for (const s of finalBySlot.values()) {
      const key = `${s.hero_order}@${s.coord.x},${s.coord.y}`
      const churn = rejectionCounts.get(key) ?? 0
      if (s.name !== null) {
        picksResolved++
        if (churn > 0) {
          pickRows.push(`<tr><td>${key}</td><td>${esc(s.name)}</td><td>${s.confidence.toFixed(3)}</td><td>${churn}</td><td>resolved (after churn)</td></tr>`)
        }
      } else if (s.rejectedMatch) {
        picksUnresolved++
        pickRows.push(
          `<tr class="bad"><td>${key}</td><td>∅</td><td>${s.confidence.toFixed(3)}</td><td>${churn}</td><td>UNRESOLVED — best ${esc(s.rejectedMatch.bestName ?? '?')}${s.rejectedMatch.secondName ? `, 2nd ${esc(s.rejectedMatch.secondName)}` : ''}${s.rejectedMatch.margin !== null ? `, margin ${s.rejectedMatch.margin.toFixed(3)}` : ''}</td></tr>`,
        )
      }
      // name===null without rejectedMatch = empty box: not counted
    }
  }

  // --- MODELS: last non-null tile match per heroOrder ---
  const modelFinal = new Map()
  for (const l of lines) {
    for (const m of l.modelTileMatches ?? []) {
      if (m.name !== null) modelFinal.set(m.heroOrder, m)
    }
  }
  const modelRows = []
  let modelOk = 0, modelBad = 0, modelMiss = 0
  for (const h of record.lineup) {
    const m = modelFinal.get(h.heroOrder)
    if (!m) { modelMiss++; modelRows.push(`<tr class="miss"><td>${h.heroOrder}</td><td>${esc(h.hero)}</td><td>∅</td><td></td><td>UNRESOLVED</td></tr>`); continue }
    if (m.name === h.hero) { modelOk++ }
    else { modelBad++; modelRows.push(`<tr class="bad"><td>${h.heroOrder}</td><td>${esc(h.hero)}</td><td>${esc(m.name)}</td><td>${m.score.toFixed(3)}</td><td>WRONG</td></tr>`) }
  }

  // --- OCR: final reads vs lineup set ---
  const lastLine = lines[lines.length - 1]
  const ocrRows = []
  let ocrOk = 0, ocrBad = 0
  for (const [row, read] of Object.entries(lastLine?.ocrHeroNamesByRow ?? {})) {
    const ok = heroSet.has(heroKey(read.name))
    if (ok) ocrOk++
    else ocrBad++
    ocrRows.push(`<tr class="${ok ? '' : 'bad'}"><td>${row}</td><td>${esc(read.name)}</td><td>${read.similarity.toFixed(3)}</td><td>${ok ? 'in lineup' : 'NOT IN LINEUP'}</td></tr>`)
  }

  totals.poolOk += poolOk; totals.poolBad += poolBad; totals.poolMiss += poolMiss
  totals.modelOk += modelOk; totals.modelBad += modelBad; totals.modelMiss += modelMiss
  totals.ocrOk += ocrOk; totals.ocrBad += ocrBad
  totals.picksResolved += picksResolved; totals.picksUnresolved += picksUnresolved

  const poolTotal = poolOk + poolBad + poolMiss
  sections.push(`
<details>
<summary><b>${esc(dirName)}</b> — pool ${poolOk}/${poolTotal} (${pct(poolOk, poolTotal)}), picks ${picksResolved} resolved / ${picksUnresolved} unresolved, models ${modelOk}/${record.lineup.length}, OCR ${ocrOk} ok${ocrBad ? ` / ${ocrBad} BAD` : ''} — ${lines.length} scans${initial ? '' : ' — <b class="bad">NO INITIAL SCAN FOUND</b>'}</summary>
<p>Lineup: ${record.lineup.map((h) => esc(h.hero)).join(', ')}</p>
${poolRows.length ? `<h4>Pool anomalies</h4><table><tr><th>row</th><th>expected</th><th>recognized</th><th>conf</th><th>verdict</th></tr>${poolRows.join('')}</table>` : '<p>Pool: no anomalies.</p>'}
${pickRows.length ? `<h4>Pick slots (churned or unresolved)</h4><table><tr><th>slot</th><th>final</th><th>score</th><th>rejections</th><th>detail</th></tr>${pickRows.join('')}</table>` : '<p>Picks: all clean.</p>'}
${modelRows.length ? `<h4>Model tiles (anomalies)</h4><table><tr><th>order</th><th>expected</th><th>matched</th><th>score</th><th>verdict</th></tr>${modelRows.join('')}</table>` : '<p>Models: all identified correctly.</p>'}
${ocrRows.length ? `<h4>OCR reads</h4><table><tr><th>row</th><th>hero</th><th>similarity</th><th>check</th></tr>${ocrRows.join('')}</table>` : '<p>OCR: no reads (strips unresolved or feature idle).</p>'}
${record.finalBoard ? `<h4>Final board (ground truth for picks)</h4><img src="${esc(join(dirName, record.finalBoard).replace(/\\/g, '/'))}" style="max-width:100%">` : ''}
</details>`)
}

const html = `<!doctype html><meta charset="utf-8"><title>Draft recognition diagnostics</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}
table{border-collapse:collapse;margin:.5rem 0}td,th{border:1px solid #ccc;padding:.2rem .5rem;font-size:.85rem}
.bad{background:#fdd}.miss{background:#ffd}details{margin:1rem 0;border:1px solid #ddd;border-radius:6px;padding:.5rem 1rem}
summary{cursor:pointer}
</style>
<h1>Draft recognition diagnostics</h1>
<p>Run: <code>${esc(runDir)}</code> — ${iterDirs.length} iterations, ${scanLines.length} scan records.</p>
<h2>Totals</h2>
<table>
<tr><th></th><th>OK</th><th>misread</th><th>missed</th><th>accuracy</th></tr>
<tr><td>Pool slots</td><td>${totals.poolOk}</td><td>${totals.poolBad}</td><td>${totals.poolMiss}</td><td>${pct(totals.poolOk, totals.poolOk + totals.poolBad + totals.poolMiss)}</td></tr>
<tr><td>Model tiles</td><td>${totals.modelOk}</td><td>${totals.modelBad}</td><td>${totals.modelMiss}</td><td>${pct(totals.modelOk, totals.modelOk + totals.modelBad + totals.modelMiss)}</td></tr>
<tr><td>OCR reads</td><td>${totals.ocrOk}</td><td>${totals.ocrBad}</td><td></td><td>${pct(totals.ocrOk, totals.ocrOk + totals.ocrBad)}</td></tr>
<tr><td>Pick slots (final)</td><td>${totals.picksResolved}</td><td></td><td>${totals.picksUnresolved}</td><td>${pct(totals.picksResolved, totals.picksResolved + totals.picksUnresolved)}</td></tr>
</table>
<p>Pick-slot ground truth is the final-board image in each iteration — compare
unresolved slots against it visually; rejected-crop dumps live in
<code>${esc(join(appData, 'debug', 'rejected-picks'))}</code>.</p>
${sections.join('\n')}
`

await writeFile(outPath, html)
console.log(`Report written: ${outPath}`)
