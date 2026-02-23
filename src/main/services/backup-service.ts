import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import { DB_BACKUP_RETENTION, BACKUP_DIR_NAME } from '@shared/constants/database'

// @DEV-GUIDE: Manages database backup lifecycle in %APPDATA%/ability-draft-plus/backups/.
// Retention policy: keeps the newest DB_BACKUP_RETENTION (3) backups, deletes older ones.
// Backups are named with reason + ISO timestamp (e.g. dota_ad_data_backup_startup_2026-02-23...).
//
// Restore safety pattern: before overwriting the active DB, creates a .restore-temp copy.
// If restore fails (corrupt backup), automatically recovers from the temp copy.
// After restore, calls onRestored(data) which triggers DatabaseService.reload() to swap
// the in-memory sql.js database without restarting the app.
//
// createBackup is called automatically on startup (skip on first run) and manually from UI.

const logger = log.scope('backup')

export interface BackupInfo {
  name: string
  path: string
  date: string
  size: number
}

export interface BackupStats {
  count: number
  totalSize: number
  oldestBackup?: string
  newestBackup?: string
}

export interface BackupService {
  createBackup(reason?: string): Promise<{
    success: boolean
    backupPath?: string
    error?: string
  }>
  restoreBackup(backupPath: string): Promise<{
    success: boolean
    error?: string
  }>
  listBackups(): Promise<BackupInfo[]>
  getStats(): Promise<BackupStats>
}

export function createBackupService(
  getDbPath: () => string,
  onRestored: (data: Uint8Array) => void,
): BackupService {
  function getBackupDir(): string {
    return path.join(app.getPath('userData'), BACKUP_DIR_NAME)
  }

  function ensureBackupDir(): void {
    const dir = getBackupDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  async function cleanOldBackups(keepCount: number = DB_BACKUP_RETENTION): Promise<void> {
    try {
      const backups = await listBackups()
      if (backups.length <= keepCount) return

      const toDelete = backups.slice(keepCount) // backups are sorted newest-first
      for (const backup of toDelete) {
        fs.unlinkSync(backup.path)
        logger.debug('Deleted old backup', { path: backup.path })
      }
    } catch (err) {
      logger.error('Error cleaning old backups', { error: err })
    }
  }

  async function createBackup(
    reason: string = 'manual',
  ): Promise<{ success: boolean; backupPath?: string; error?: string }> {
    try {
      const dbPath = getDbPath()

      if (!fs.existsSync(dbPath)) {
        return { success: false, error: 'Database file does not exist' }
      }

      // Check file size (skip if empty/corrupt)
      const stats = fs.statSync(dbPath)
      if (stats.size === 0) {
        return { success: false, error: 'Database file is empty' }
      }

      ensureBackupDir()

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dbName = path.basename(dbPath, '.db')
      const backupName = `${dbName}_backup_${reason}_${timestamp}.db`
      const backupPath = path.join(getBackupDir(), backupName)

      fs.copyFileSync(dbPath, backupPath)
      logger.info('Backup created', { path: backupPath, reason })

      await cleanOldBackups()

      return { success: true, backupPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Backup creation failed', { error: message })
      return { success: false, error: message }
    }
  }

  async function restoreBackup(
    backupPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    const dbPath = getDbPath()
    const tempPath = dbPath + '.restore-temp'

    try {
      if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup file does not exist' }
      }

      // Create safety copy of current DB
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, tempPath)
      }

      // Copy backup to active DB path
      fs.copyFileSync(backupPath, dbPath)

      // Read the restored file and notify the database service
      const data = fs.readFileSync(dbPath)
      onRestored(new Uint8Array(data))

      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }

      logger.info('Backup restored', { from: backupPath })
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Backup restore failed, attempting recovery', { error: message })

      // Try to recover from safety copy
      try {
        if (fs.existsSync(tempPath)) {
          fs.copyFileSync(tempPath, dbPath)
          const data = fs.readFileSync(dbPath)
          onRestored(new Uint8Array(data))
          fs.unlinkSync(tempPath)
          logger.info('Recovery successful, original database restored')
        }
      } catch (recoveryErr) {
        logger.error('Recovery also failed', { error: recoveryErr })
      }

      return { success: false, error: message }
    }
  }

  async function listBackups(): Promise<BackupInfo[]> {
    try {
      const backupDir = getBackupDir()
      if (!fs.existsSync(backupDir)) return []

      const files = fs.readdirSync(backupDir)
      const backups: BackupInfo[] = []

      for (const file of files) {
        if (!file.endsWith('.db')) continue

        const filePath = path.join(backupDir, file)
        const stats = fs.statSync(filePath)
        backups.push({
          name: file,
          path: filePath,
          date: stats.mtime.toISOString(),
          size: stats.size,
        })
      }

      // Sort newest-first
      backups.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )

      return backups
    } catch (err) {
      logger.error('Error listing backups', { error: err })
      return []
    }
  }

  async function getStats(): Promise<BackupStats> {
    const backups = await listBackups()
    const totalSize = backups.reduce((sum, b) => sum + b.size, 0)

    return {
      count: backups.length,
      totalSize,
      oldestBackup: backups.length > 0 ? backups[backups.length - 1].date : undefined,
      newestBackup: backups.length > 0 ? backups[0].date : undefined,
    }
  }

  return {
    createBackup,
    restoreBackup,
    listBackups,
    getStats,
  }
}
