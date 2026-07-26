import { ipcMain, app } from 'electron'
import { spawn, execFile } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import log from 'electron-log/main'
import type { AppStore } from '../store/app-store'
import type { DatabaseService } from '../services/database-service'
import { buildModelGapsPayload } from './ml-handlers'

// @DEV-GUIDE: Dev-only ML-pipeline cockpit (registered ONLY when !app.isPackaged;
// each handler double-checks). Shells out to the developer's local tooling — no
// credentials or cloud logic live in the app:
//
// - dev:runGatherScript  — auto-exports model-gaps.json into the sibling
//   ad_data_gather_script repo, then either captures a --dry-run's output for
//   in-app display, or launches the real run in its own console window (it takes
//   over the mouse/keyboard for ~40 min, so it must be visible and killable).
// - dev:uploadDataset    — launches upload_dataset.py in its own console window.
// - dev:triggerRetrain   — dispatches the train-model.yml GitHub workflow via the
//   locally-authenticated `gh` CLI.
//
// The gather repo is resolved as a sibling checkout: ../ad_data_gather_script.

const logger = log.scope('ipc-dev')

const GATHER_SCRIPT = 'gather_missing_data.py'
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

/** Launch a console-visible, detached process the user can watch and Ctrl+C. */
function launchInConsole(exe: string, args: string[], cwd: string): void {
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      AD_DATASET_BUCKET: process.env.AD_DATASET_BUCKET ?? DEFAULT_DATASET_BUCKET,
    },
  })
  child.unref()
}

export function registerDevHandlers(
  appStore: AppStore,
  dbService: DatabaseService,
): void {
  ipcMain.handle(
    'dev:runGatherScript',
    async (_event, data: { dryRun: boolean }) => {
      if (app.isPackaged) return { success: false, error: 'dev-only' }

      const gatherDir = getGatherDir()
      if (!existsSync(join(gatherDir, GATHER_SCRIPT))) {
        return { success: false, error: `Gather script not found at ${gatherDir}` }
      }

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

      const python = getPython(gatherDir)
      const args = [GATHER_SCRIPT, '--gaps-file', 'model-gaps.json']

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
      logger.info('Gather script launched in console')
      return {
        success: true,
        output: `Launched in a separate console window (${payload.missing.length} target abilities). The script controls mouse and keyboard until it finishes.`,
      }
    },
  )

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
