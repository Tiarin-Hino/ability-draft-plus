/**
 * @file Registers IPC handlers for database backup and restore operations
 * Allows manual backup/restore from the UI
 */

const { ipcMain } = require('electron');
const { createLogger } = require('../logger');
const {
    createBackup,
    restoreBackup,
    getBackupFiles,
    getBackupStats
} = require('../databaseBackup');
const stateManager = require('../stateManager');

const logger = createLogger('BackupHandlers');

/**
 * Registers all backup-related IPC handlers
 */
function registerBackupHandlers() {
    /**
     * Handles manual database backup request
     * @returns {Promise<{success: boolean, backupPath?: string, error?: string}>}
     */
    ipcMain.handle('create-manual-backup', async () => {
        logger.info('Manual backup requested');
        const dbPath = stateManager.getActiveDbPath();
        const result = await createBackup(dbPath, 'manual');

        if (result.success) {
            logger.info('Manual backup created successfully', { path: result.backupPath });
        } else {
            logger.error('Manual backup failed', { error: result.error });
        }

        return result;
    });

    /**
     * Handles request to get list of available backups
     * @returns {Promise<Array<{name: string, date: Date, size: number}>>}
     */
    ipcMain.handle('get-backup-list', async () => {
        logger.debug('Backup list requested');
        const backups = await getBackupFiles();

        return backups.map((backup) => ({
            name: backup.name,
            path: backup.path,
            date: backup.mtime,
            size: backup.size
        }));
    });

    /**
     * Handles database restore from backup
     * @param {string} backupPath - Path to backup file
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    ipcMain.handle('restore-from-backup', async (event, backupPath) => {
        logger.info('Database restore requested', { backupPath });

        const targetDbPath = stateManager.getActiveDbPath();
        const result = await restoreBackup(backupPath, targetDbPath);

        if (result.success) {
            logger.info('Database restored successfully', { backupPath });
        } else {
            logger.error('Database restore failed', {
                backupPath,
                error: result.error
            });
        }

        return result;
    });

    /**
     * Handles request for backup statistics
     * @returns {Promise<{count: number, totalSize: number, oldestBackup?: Date, newestBackup?: Date}>}
     */
    ipcMain.handle('get-backup-stats', async () => {
        logger.debug('Backup stats requested');
        return await getBackupStats();
    });
}

module.exports = { registerBackupHandlers };
