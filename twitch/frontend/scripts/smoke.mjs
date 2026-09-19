#!/usr/bin/env node
// Browser smoke test of the BUILT overlay against `vite preview` (demo mode, no Twitch,
// no backend). Uses the app repo's Playwright install:
//   node scripts/smoke.mjs [baseUrl]   (default https://localhost:8080)
// Writes screenshots to smoke-out/.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(__dirname, '../../../package.json'))
const { chromium } = require('playwright')

const base = process.argv[2] ?? 'https://localhost:8080'
const out = resolve(__dirname, '../smoke-out')
mkdirSync(out, { recursive: true })

function check(condition, message) {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`)
  console.log(`ok - ${message}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

try {
  // Draft phase
  await page.goto(`${base}/video_overlay.html?demo=1`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.hit-ability', { timeout: 15_000 })
  check((await page.locator('.hit-ability').count()) === 48, '48 ability hit regions')
  check((await page.locator('.hit-hero').count()) === 12, '12 hero model hit regions')
  check((await page.locator('.hit-ability.is-picked').count()) > 0, 'picked abilities are marked')
  await page.locator('.hit-ability:not(.is-picked)').first().click()
  await page.waitForSelector('.details-title')
  const title = await page.locator('.details-title').textContent()
  check(Boolean(title && title.length > 0), `details panel opened: ${title}`)
  check((await page.locator('.dota-desc').count()) === 1, 'Dota description rendered from the catalog')
  check((await page.locator('.stat-grid').count()) >= 1, 'Windrun stats rendered')
  check((await page.locator('.hit-ability.is-partner-strong, .hit-ability.is-partner-weak').count()) > 0, 'partner outlines highlighted')
  await page.screenshot({ path: resolve(out, 'draft.png') })
  await page.locator('.hit-hero').first().click()
  await page.waitForSelector('.talent-tree')
  check((await page.locator('.talent-row').count()) === 4, 'hero talents rendered')
  await page.screenshot({ path: resolve(out, 'hero.png') })

  // Overview
  await page.getByRole('button', { name: 'Draft overview' }).click()
  await page.waitForSelector('.ov-modal')
  check((await page.locator('.ov-tile').count()) === 48, 'overview shows the full pool')
  check((await page.locator('.order-row').count()) > 0, 'pick order listed')
  await page.screenshot({ path: resolve(out, 'overview.png') })
  await page.keyboard.press('Escape')

  // In-game phase
  await page.goto(`${base}/video_overlay.html?demo=ingame`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.hit-portrait', { timeout: 15_000 })
  check((await page.locator('.hit-portrait').count()) === 10, '10 portrait hit regions')
  await page.locator('.hit-portrait').first().click()
  await page.waitForSelector('.pick-col')
  check((await page.locator('.pick-col .pick-tile').count()) === 4, 'pick column with 4 pick boxes')
  await page.getByRole('button', { name: 'Show all picks' }).click()
  check((await page.locator('.pick-col').count()) === 10, 'expand-all shows 10 pick columns')

  // Caster edition: telemetry panel (spectator-only in production; the demo
  // fixture supplies a live state so the layout is covered here).
  await page.getByRole('button', { name: 'Scoreboard' }).click()
  await page.waitForSelector('.caster-panel')
  check((await page.locator('.caster-row').count()) === 10, 'scoreboard lists 10 players')
  check((await page.locator('.caster-total').count()) === 2, 'scoreboard shows both team net worths')
  check((await page.locator('.pip-buyback').count()) >= 1, 'buyback state is surfaced')
  await page.screenshot({ path: resolve(out, 'caster.png') })
  await page.getByRole('button', { name: 'Hide stats' }).click()
  await page.screenshot({ path: resolve(out, 'ingame.png') })

  // Waiting phase + minimize
  await page.goto(`${base}/video_overlay.html?demo=waiting`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.launcher-pill')
  check((await page.locator('.hit').count()) === 0, 'waiting shows the launcher only')

  // Config page
  await page.goto(`${base}/config.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.calib-preview')
  check((await page.locator('.preview-slot').count()) === 48, 'config preview draws the pool')
  // Twitch shows the config page in a short iframe: it MUST scroll. A merged
  // stylesheet once leaked the overlay's html/body{overflow:hidden} onto it.
  await page.setViewportSize({ width: 1000, height: 600 })
  const scrollable = await page.evaluate(() => {
    const doc = document.documentElement
    return getComputedStyle(doc).overflow !== 'hidden' && doc.scrollHeight > doc.clientHeight
  })
  check(scrollable, 'config page scrolls in a short viewport')
  await page.screenshot({ path: resolve(out, 'config.png') })

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
  console.log(`\nAll smoke checks passed. Screenshots in ${out}`)
} finally {
  await browser.close()
}
