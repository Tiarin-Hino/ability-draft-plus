import { ipcMain, app, shell } from 'electron'
import { spawn, execFile } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import log from 'electron-log/main'
import type { AppStore } from '../store/app-store'
import type { DatabaseService } from '../services/database-service'
import { buildModelGapsPayload } from './ml-handlers'

// @DEV-GUIDE: Dev-only ML-pipeline cockpit (registered ONLY when !app.isPackaged;
// each handler double-checks). Shells out to the developer's local tooling — no
// credentials or cloud logic live in the app:
//
// - dev:runGatherScript  — two modes. Gaps mode (default): auto-exports
//   model-gaps.json into the sibling ad_data_gather_script repo and runs
//   --gaps-file. Targeted mode (heroes[] set): runs --heroes a,b to re-collect
//   ALL abilities of the named heroes (icon reworks keep class names), with
//   optional --purge-existing to archive the stale images first. Either mode
//   captures a --dry-run's output for in-app display, or launches the real run
//   in its own console window (it takes over the mouse/keyboard for ~40 min,
//   so it must be visible and killable).
// - dev:runModelsGather  — gather_missing_data.py --mode models: hero MODEL tile
//   images for every known hero (--sets each), mirrored into the app's
//   userData/model-tiles reference library as they land.
// - dev:runDiagnosticCycle — diagnostic_draft_cycle.py: full bot drafts cycling
//   the roster while THIS app scans; writes slot-level ground truth per
//   iteration. The app must stay running with auto-rescan on.
// - dev:analyzeDiagnostics — runs scripts/analyze-draft-diagnostics.mjs on the
//   newest diagnostic run and opens the HTML report.
// - dev:uploadDataset    — launches upload_dataset.py in its own console window.
// - dev:triggerRetrain   — dispatches the train-model.yml GitHub workflow via the
//   locally-authenticated `gh` CLI.
//
// The gather repo is resolved as a sibling checkout: ../ad_data_gather_script.

const logger = log.scope('ipc-dev')

const GATHER_SCRIPT = 'gather_missing_data.py'
const DIAGNOSTIC_SCRIPT = 'diagnostic_draft_cycle.py'
const ANALYZER_SCRIPT = join('scripts', 'analyze-draft-diagnostics.mjs')
const UPLOAD_SCRIPT = 'upload_dataset.py'
// Fallback for consoles launched before AD_DATASET_BUCKET was set user-wide
const DEFAULT_DATASET_BUCKET = 'tiarinhino-ad-training-datasets'

function getGatherDir(): string {
  return resolve(app.getAppPath(), '..', 'ad_data_gather_script')
}

/** A venv whose base interpreter was uninstalled fails with a confusing
 *  "did not find executable" error — validate pyvenv.cfg's home before trusting it. */
function isVenvHealthy(venvDir: string): boolean {
  const python = join(venvDir, 'Scripts', 'python.exe')
  const cfg = join(venvDir, 'pyvenv.cfg')
  if (!existsSync(python) || !existsSync(cfg)) return false
  try {
    const home = readFileSync(cfg, 'utf-8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('home'))
      ?.split('=')[1]
      ?.trim()
    return home !== undefined && existsSync(home)
  } catch {
    return false
  }
}

function getPython(gatherDir: string): string {
  for (const venvName of ['venv', 'venv_stable']) {
    const venvDir = join(gatherDir, venvName)
    if (isVenvHealthy(venvDir)) {
      return join(venvDir, 'Scripts', 'python.exe')
    }
  }
  return 'python'
}

/** Launch a process in a VISIBLE console the user can watch and Ctrl+C.
 *
 * A detached child of a GUI app gets NO console on Windows (DETACHED_PROCESS),
 * so a plain spawn runs the script invisibly — dangerous for a script that
 * takes over the mouse. Route through `cmd /c start`, which explicitly
 * allocates a console window; the inner `cmd /k` keeps the window open after
 * the script exits so its final output stays readable. */
/** Capture a (quick) script run's output for in-app display. */
function captureRun(
  exe: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      exe,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const output = `${stdout}\n${stderr}`.trim()
          logger.error('Captured run failed', {
            args,
            error: error.message,
            outputTail: output.slice(-2000),
          })
          resolvePromise({
            success: false,
            error: error.killed ? 'Run timed out' : error.message,
            output,
          })
        } else {
          resolvePromise({ success: true, output: stdout.trim() })
        }
      },
    )
  })
}

function launchInConsole(exe: string, args: string[], cwd: string): void {
  const quotedArgs = args.map((a) => `"${a}"`).join(' ')
  const child = spawn(
    'cmd.exe',
    ['/d', '/s', '/c', `start "ADP ML pipeline" cmd /d /k ""${exe}" ${quotedArgs}"`],
    {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
      env: {
        ...process.env,
        AD_DATASET_BUCKET: process.env.AD_DATASET_BUCKET ?? DEFAULT_DATASET_BUCKET,
      },
    },
  )
  child.unref()
}

export function registerDevHandlers(
  appStore: AppStore,
  dbService: DatabaseService,
): void {
  ipcMain.handle(
    'dev:runGatherScript',
    async (
      _event,
      data: { dryRun: boolean; heroes?: string[]; purgeExisting?: boolean },
    ) => {
      if (app.isPackaged) return { success: false, error: 'dev-only' }

      const gatherDir = getGatherDir()
      if (!existsSync(join(gatherDir, GATHER_SCRIPT))) {
        return { success: false, error: `Gather script not found at ${gatherDir}` }
      }

      const python = getPython(gatherDir)
      let args: string[]
      let launchedNote: string

      if (data.heroes && data.heroes.length > 0) {
        // Targeted mode: the script re-validates against its own DB, but reject
        // anything that isn't a plain engine name before it reaches a cmd line.
        const invalid = data.heroes.filter((h) => !/^[a-z0-9_]+$/.test(h))
        if (invalid.length > 0) {
          return {
            success: false,
            error: `Invalid hero name(s): ${invalid.join(', ')}`,
          }
        }
        args = [GATHER_SCRIPT, '--heroes', data.heroes.join(',')]
        if (data.purgeExisting) args.push('--purge-existing')
        launchedNote = `${data.heroes.length} targeted heroes${
          data.purgeExisting ? ', stale images will be purged' : ''
        }`
      } else {
        const payload = buildModelGapsPayload(appStore, dbService)
        if (!payload) {
          return { success: false, error: 'No model gaps detected — nothing to gather.' }
        }

        const gapsPath = join(gatherDir, 'model-gaps.json')
        await writeFile(gapsPath, JSON.stringify(payload, null, 2))
        logger.info('Gaps file written for gather script', {
          gapsPath,
          missing: payload.missing.length,
        })
        args = [GATHER_SCRIPT, '--gaps-file', 'model-gaps.json']
        launchedNote = `${payload.missing.length} target abilities`
      }

      if (data.dryRun) {
        // Capture dry-run output for in-app display (a console would close instantly).
        // Generous timeout: unresolved abilities trigger a Liquipedia scrape at
        // 31s per hero page, so a legitimate dry run can take several minutes.
        return new Promise((resolvePromise) => {
          execFile(
            python,
            [...args, '--dry-run'],
            { cwd: gatherDir, timeout: 600_000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                const output = `${stdout}\n${stderr}`.trim()
                logger.error('Gather dry run failed', {
                  error: error.message,
                  outputTail: output.slice(-2000),
                })
                resolvePromise({
                  success: false,
                  error: error.killed
                    ? 'Dry run timed out after 10 minutes'
                    : error.message,
                  output,
                })
              } else {
                resolvePromise({ success: true, output: stdout.trim() })
              }
            },
          )
        })
      }

      launchInConsole(python, args, gatherDir)
      logger.info('Gather script launched in console', { args: args.slice(1) })
      return {
        success: true,
        output: `Launched in a separate console window (${launchedNote}). The script controls mouse and keyboard until it finishes.`,
      }
    },
  )

  ipcMain.handle(
    'dev:runModelsGather',
    async (_event, data: { dryRun: boolean; sets?: number }) => {
      if (app.isPackaged) return { success: false, error: 'dev-only' }

      const gatherDir = getGatherDir()
      if (!existsSync(join(gatherDir, GATHER_SCRIPT))) {
        return { success: false, error: `Gather script not found at ${gatherDir}` }
      }
      const sets = data.sets ?? 24
      if (!Number.isInteger(sets) || sets < 1 || sets > 100) {
        return { success: false, error: 'Sets must be an integer between 1 and 100.' }
      }

      const args = [
        GATHER_SCRIPT,
        '--mode', 'models',
        '--sets', String(sets),
        // Mirror crops straight into the reference library the ML worker reads
        '--models-export-dir', join(app.getPath('userData'), 'model-tiles'),
      ]

      if (data.dryRun) {
        // No Liquipedia scraping in models mode — a dry run is quick
        return captureRun(getPython(gatherDir), [...args, '--dry-run'], gatherDir, 60_000)
      }

      launchInConsole(getPython(gatherDir), args, gatherDir)
      logger.info('Models gather launched in console', { sets })
      return {
        success: true,
        output:
          `Launched in a separate console window (target ${sets} images per hero; ` +
          'resumable — Ctrl+C loses nothing). The script controls mouse and keyboard until it finishes.',
      }
    },
  )

  ipcMain.handle(
    'dev:runDiagnosticCycle',
    async (
      _event,
      data: { dryRun: boolean; iterations?: number; pickTimeS?: number },
    ) => {
      if (app.isPackaged) return { success: false, error: 'dev-only' }

      const gatherDir = getGatherDir()
      if (!existsSync(join(gatherDir, DIAGNOSTIC_SCRIPT))) {
        return {
          success: false,
          error: `Diagnostic script not found at ${gatherDir}`,
        }
      }
      const iterations = data.iterations ?? 3
      if (!Number.isInteger(iterations) || iterations < 0 || iterations > 50) {
        return {
          success: false,
          error: 'Iterations must be an integer between 0 (full pass) and 50.',
        }
      }
      // 0 = no timer commands: the lobby runs the game's own defaults
      // (60s prep / 7s pick / 5s round break) — the real-match cadence
      const pickTimeS = data.pickTimeS ?? 0
      if (
        !Number.isInteger(pickTimeS) ||
        pickTimeS < 0 ||
        (pickTimeS > 0 && pickTimeS < 3) ||
        pickTimeS > 120
      ) {
        return {
          success: false,
          error: 'Pick time must be 0 (game defaults) or 3-120 seconds.',
        }
      }

      const args = [
        DIAGNOSTIC_SCRIPT,
        '--iterations', String(iterations),
        '--pick-time', String(pickTimeS),
      ]
      if (data.dryRun) {
        return captureRun(getPython(gatherDir), [...args, '--dry-run'], gatherDir, 60_000)
      }

      launchInConsole(getPython(gatherDir), args, gatherDir)
      logger.info('Diagnostic draft cycle launched in console', { iterations })
      return {
        success: true,
        output:
          'Launched in a separate console window. KEEP THIS APP RUNNING with the ' +
          'overlay activated and experimental auto-rescan enabled — it records the ' +
          'scan diagnostics the analyzer needs. Analyze when the run finishes.',
      }
    },
  )

  ipcMain.handle('dev:analyzeDiagnostics', async () => {
    if (app.isPackaged) return { success: false, error: 'dev-only' }

    const runsDir = join(getGatherDir(), 'diagnostic_runs')
    let latest: string | null = null
    try {
      const runs = readdirSync(runsDir)
        .filter((d) => d.startsWith('run-'))
        .sort()
      latest = runs.length > 0 ? join(runsDir, runs[runs.length - 1]) : null
    } catch {
      latest = null
    }
    if (!latest) {
      return { success: false, error: `No diagnostic runs found in ${runsDir}` }
    }

    const result = await captureRun(
      'node',
      [ANALYZER_SCRIPT, '--run', latest],
      app.getAppPath(),
      120_000,
    )
    if (result.success) {
      const report = join(latest, 'report.html')
      if (existsSync(report)) void shell.openPath(report)
      logger.info('Diagnostics analyzed', { run: latest })
      return { success: true, output: `${result.output ?? ''}\nOpened ${report}`.trim() }
    }
    return result
  })

  ipcMain.handle('dev:uploadDataset', async () => {
    if (app.isPackaged) return { success: false, error: 'dev-only' }

    const gatherDir = getGatherDir()
    if (!existsSync(join(gatherDir, UPLOAD_SCRIPT))) {
      return { success: false, error: `Upload script not found at ${gatherDir}` }
    }

    launchInConsole(getPython(gatherDir), [UPLOAD_SCRIPT], gatherDir)
    logger.info('Dataset upload launched in console')
    return { success: true }
  })

  ipcMain.handle(
    'dev:triggerRetrain',
    async (_event, data: { datasetVersion: string; fineTune: boolean }) => {
      if (app.isPackaged) return { success: false, error: 'dev-only' }

      const version = data.datasetVersion.trim()
      if (!/^\d+$/.test(version)) {
        return { success: false, error: 'Dataset version must be a number.' }
      }

      return new Promise((resolvePromise) => {
        execFile(
          'gh',
          [
            'workflow', 'run', 'train-model.yml',
            '-f', `dataset_version=${version}`,
            '-f', `fine_tune=${data.fineTune}`,
          ],
          { cwd: app.getAppPath(), timeout: 30_000 },
          (error, stdout, stderr) => {
            if (error) {
              logger.error('Workflow dispatch failed', { error: error.message, stderr })
              resolvePromise({
                success: false,
                error: stderr.trim() || error.message,
              })
            } else {
              logger.info('Retrain workflow dispatched', { version })
              resolvePromise({ success: true, output: stdout.trim() })
            }
          },
        )
      })
    },
  )
}
