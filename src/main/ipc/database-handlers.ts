import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { DatabaseService } from '../services/database-service'
import type { BackupService } from '../services/backup-service'
import type { AppSettings } from '@shared/types'

// @DEV-GUIDE: Database domain IPC handlers. Exposes repository methods to renderers as typed
// invoke channels. All are synchronous reads from the in-memory sql.js database (fast).
//
// Channels:
// - hero:getAll, hero:getById — Hero table lookups
// - ability:getAll, ability:getDetails, ability:getByHeroId — Ability table lookups
// - settings:get, settings:set — App settings in metadata table (persist to disk on write)
// - backup:create, backup:list, backup:restore, backup:stats — Database backup management
//
// settings:set calls persist() immediately to flush the in-memory DB to disk.
// backup:create also calls persist() first to ensure the backup captures latest state.

const logger = log.scope('ipc:database')

export function registerDatabaseHandlers(
  dbService: DatabaseService,
  backupService: BackupService,
): void {
  // Hero domain
  ipcMain.handle('hero:getAll', () => {
    return dbService.heroes.getAll()
  })

  ipcMain.handle('hero:getById', (_event, data: { id: number }) => {
    return dbService.heroes.getById(data.id)
  })

  // Ability domain
  ipcMain.handle('ability:getAll', () => {
    return dbService.abilities.getAll()
  })

  ipcMain.handle('ability:getDetails', (_event, data: { names: string[] }) => {
    const map = dbService.abilities.getDetails(data.names)
    return Array.from(map.values())
  })

  ipcMain.handle('ability:getByHeroId', (_event, data: { heroId: number }) => {
    return dbService.abilities.getByHeroId(data.heroId)
  })

  // Settings domain
  ipcMain.handle('settings:get', () => {
    return dbService.metadata.getSettings()
  })

  ipcMain.handle('settings:set', (_event, data: Partial<AppSettings>) => {
    dbService.metadata.setSettings(data)
    dbService.persist()
  })

  // Backup domain
  ipcMain.handle('backup:create', async () => {
    dbService.persist()
    return backupService.createBackup('manual')
  })

  ipcMain.handle('backup:list', () => {
    return backupService.listBackups()
  })

  ipcMain.handle('backup:restore', async (_event, data: { backupPath: string }) => {
    return backupService.restoreBackup(data.backupPath)
  })

  ipcMain.handle('backup:stats', () => {
    return backupService.getStats()
  })

  logger.info('Database IPC handlers registered')
}
