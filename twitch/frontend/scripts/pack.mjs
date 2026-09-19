#!/usr/bin/env node
// Zips dist/ for upload to the Twitch developer console (Files → Upload assets).
// Twitch expects the HTML entries at the zip root with relative asset paths.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
const out = resolve(root, `twitch-frontend-${pkg.version}.zip`)

if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first')
  process.exit(1)
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = walk(dist).map((f) => relative(dist, f))
console.log(`${files.length} files:`)
for (const f of files) console.log('  ' + f)

// Twitch's ingestion keeps root-level files and DROPS subdirectories: an upload
// with assets/ served both .html files fine and 404'd every asset, leaving a
// blank extension frame with no error in the console (2026-09-04). The build is
// configured to emit flat, so a nested path here means that regressed.
const nested = files.filter((f) => f.includes('/') || f.includes('\\'))
if (nested.length > 0) {
  console.error(
    `Refusing to pack: Twitch drops subdirectories, but dist/ contains nested files:\n  ${nested.join('\n  ')}\n` +
      'Check build.rollupOptions.output in vite.config.ts — the file name patterns must not contain a directory.',
  )
  process.exit(1)
}

// Prefer PowerShell's Compress-Archive on Windows, zip elsewhere — no extra dependency.
if (process.platform === 'win32') {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${dist}\\*' -DestinationPath '${out}' -Force`,
  ])
} else {
  execFileSync('zip', ['-r', out, '.'], { cwd: dist })
}
console.log(`Wrote ${out}`)
