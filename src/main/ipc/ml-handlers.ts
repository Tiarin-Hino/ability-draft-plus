import { ipcMain, dialog, app } from 'electron'
import { writeFile } from 'fs/promises'
import log from 'electron-log/main'
import type { MlService } from '../services/ml-service'
import type { DatabaseService } from '../services/database-service'
import type { WindowManager } from '../services/window-manager'
import type { ScanTriggerService } from '../services/scan-trigger-service'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: ML domain IPC handlers. Two channels:
// - ml:init (handle): Explicit re-init from UI retry button. Sets mlStatus in AppStore.
// - ml:scan (on/fire-and-forget): Delegates to ScanTriggerService (the full scan
//   pipeline lives there so the experimental auto-rescan service can share it).

const logger = log.scope('ipc-ml')

export interface ModelGapsPayload {
  generatedAt: string
  appVersion: string
  staleInModel: string[]
  missing: Array<{
    ability: string
    hero: string | null
    heroDisplayName: string | null
    isUltimate: boolean | null
    abilityOrder: number | null
  }>
}

/** Gap list + hero mapping from the DB, or null when the model has no gaps. */
export function buildModelGapsPayload(
  appStore: AppStore,
  dbService: DatabaseService,
): ModelGapsPayload | null {
  const gaps = appStore.getState().mlModelGaps
  if (!gaps || gaps.missingFromModel.length === 0) {
    return null
  }

  const abilityByName = new Map(dbService.abilities.getAll().map((a) => [a.name, a]))
  const heroes = dbService.heroes.getAll()
  const heroById = new Map(heroes.map((h) => [h.heroId, h]))
  // Longest-first so 'dragon_knight_...' matches dragon_knight, never a shorter hero
  const heroesByNameLength = [...heroes].sort((a, b) => b.name.length - a.name.length)

  const missing = gaps.missingFromModel.map((abilityName) => {
    const ability = abilityByName.get(abilityName)
    // Fresh Windrun data for brand-new abilities may lack the hero_id linkage —
    // fall back to prefix matching, since ability internal names are always
    // prefixed with the hero's internal name.
    const hero =
      (ability ? heroById.get(ability.heroId) : undefined) ??
      heroesByNameLength.find((h) => abilityName.startsWith(h.name + '_'))
    // Windrun-scraped rows default to abilityOrder 0 / isUltimate false, which is
    // NOT real slot data (0 is the ultimate slot; standard slots are 1-3). Only
    // export the combo when it is internally consistent, so the gather script
    // falls back to Liquipedia instead of trusting junk defaults.
    const order = ability?.abilityOrder ?? null
    const isUlt = ability?.isUltimate ?? null
    const slotValid =
      isUlt !== null &&
      order !== null &&
      ((isUlt && order === 0) || (!isUlt && order >= 1 && order <= 3))
    return {
      ability: abilityName,
      hero: hero?.name ?? null,
      heroDisplayName: hero?.displayName ?? null,
      isUltimate: slotValid ? isUlt : null,
      abilityOrder: slotValid ? order : null,
    }
  })

  return {
    generatedAt: gaps.detectedAt,
    appVersion: app.getVersion(),
    staleInModel: gaps.staleInModel,
    missing,
  }
}

export function registerMlHandlers(
  mlService: MlService,
  windowManager: WindowManager,
  scanTrigger: ScanTriggerService,
  appStore: AppStore,
  dbService: DatabaseService,
): void {
  ipcMain.handle('ml:getModelGaps', () => {
    return appStore.getState().mlModelGaps
  })

  // Exports the staleness-detector gap list (with hero mapping from the DB) as JSON
  // for the training-data gather script — closes the loop between "the app knows
  // which abilities the model can't recognize" and "collect data for exactly those".
  ipcMain.handle('ml:exportModelGaps', async () => {
    const payload = buildModelGapsPayload(appStore, dbService)
    if (!payload) {
      return { success: false, error: 'no-gaps' }
    }

    try {
      const cp = windowManager.getControlPanelWindow()
      const options: Electron.SaveDialogOptions = {
        defaultPath: 'model-gaps.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
      const result = cp && !cp.isDestroyed()
        ? await dialog.showSaveDialog(cp, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' }
      }

      await writeFile(result.filePath, JSON.stringify(payload, null, 2))

      const count = payload.missing.length
      logger.info('Model gaps exported', { path: result.filePath, count })
      return { success: true, path: result.filePath, count }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Model gaps export failed', { error: message })
      return { success: false, error: message }
    }
  })

  ipcMain.handle('ml:init', async () => {
    try {
      appStore.setState({ mlStatus: 'initializing', mlError: null })
      await mlService.initialize()
      appStore.setState({ mlStatus: 'ready', mlError: null })
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('ML init failed', { error: message })
      appStore.setState({ mlStatus: 'error', mlError: message })
      return { success: false, error: message }
    }
  })

  ipcMain.on(
    'ml:scan',
    (
      _event,
      data: { heroOrder: number; isInitialScan: boolean },
    ) => {
      void scanTrigger.performScan(data.isInitialScan)
    },
  )
}
