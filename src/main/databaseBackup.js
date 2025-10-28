/**
 * @file Database backup and restore functionality
 * Provides automatic and manual database backup/restore capabilities
 * to protect against data corruption and provide recovery options
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { DB_BACKUP_RETENTION } = require('../constants');
const { createLogger } = require('./logger');

const logger = createLogger('DatabaseBackup');

const BACKUP_DIR_NAME = 'backups';

/**
 * Get the backup directory path
 * @returns {string} Path to backup directory
 */
function getBackupDirectory() {
    return path.join(app.getPath('userData'), BACKUP_DIR_NAME);
}

/**
 * Ensure backup directory exists
 * @returns {Promise<void>}
 */
async function ensureBackupDirectory() {
    const backupDir = getBackupDirectory();
    try {
        await fs.access(backupDir);
    } catch (error) {
        logger.info('Creating backup directory', { path: backupDir });
        await fs.mkdir(backupDir, { recursive: true });
    }
}

/**
 * Generate backup filename with timestamp
 * @param {string} originalDbPath - Original database file path
 * @returns {string} Backup filename
 */
function generateBackupFilename(originalDbPath) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const basename = path.basename(originalDbPath, '.db');
    return `${basename}_backup_${timestamp}.db`;
}

/**
 * Get list of existing backup files sorted by modification time (newest first)
 * @returns {Promise<Array<{name: string, path: string, mtime: Date, size: number}>>}
 */
async function getBackupFiles() {
    await ensureBackupDirectory();
    const backupDir = getBackupDirectory();

    try {
        const files = await fs.readdir(backupDir);
        const dbFiles = files.filter((f) => f.endsWith('.db'));

        const fileStats = await Promise.all(
            dbFiles.map(async (filename) => {
                const filepath = path.join(backupDir, filename);
                const stats = await fs.stat(filepath);
                return {
                    name: filename,
                    path: filepath,
                    mtime: stats.mtime,
                    size: stats.size
                };
            })
        );

        // Sort by modification time, newest first
        return fileStats.sort((a, b) => b.mtime - a.mtime);
    } catch (error) {
        logger.error('Failed to get backup files', { error: error.message });
        return [];
    }
}

/**
 * Clean old backups, keeping only the most recent N backups
 * @param {number} keepCount - Number of backups to keep
 * @returns {Promise<number>} Number of backups deleted
 */
async function cleanOldBackups(keepCount = MAX_BACKUPS) {
    const backups = await getBackupFiles();

    if (backups.length <= keepCount) {
        return 0;
    }

    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;

    for (const backup of toDelete) {
        try {
            await fs.unlink(backup.path);
            logger.debug('Deleted old backup', { filename: backup.name });
            deletedCount++;
        } catch (error) {
            logger.error('Failed to delete old backup', {
                filename: backup.name,
                error: error.message
            });
        }
    }

    if (deletedCount > 0) {
        logger.info('Cleaned old backups', { deleted: deletedCount, kept: keepCount });
    }

    return deletedCount;
}

/**
 * Create a backup of the database
 * @param {string} dbPath - Path to the database file to backup
 * @param {string} reason - Reason for backup (e.g., 'before-update', 'manual')
 * @returns {Promise<{success: boolean, backupPath?: string, error?: string}>}
 */
async function createBackup(dbPath, reason = 'manual') {
    try {
        // Verify source database exists
        await fs.access(dbPath);

        await ensureBackupDirectory();
        const backupDir = getBackupDirectory();

        const backupFilename = generateBackupFilename(dbPath);
        const backupPath = path.join(backupDir, backupFilename);

        logger.info('Creating database backup', { source: dbPath, reason });

        // Copy the database file
        await fs.copyFile(dbPath, backupPath);

        // Verify backup was created
        const stats = await fs.stat(backupPath);

        logger.info('Database backup created successfully', {
            backupPath,
            size: stats.size,
            reason
        });

        // Clean old backups
        await cleanOldBackups();

        return {
            success: true,
            backupPath
        };
    } catch (error) {
        logger.error('Failed to create database backup', {
            dbPath,
            reason,
            error: error.message
        });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Restore database from a backup
 * @param {string} backupPath - Path to the backup file
 * @param {string} targetDbPath - Path where to restore the database
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function restoreBackup(backupPath, targetDbPath) {
    try {
        // Verify backup exists
        await fs.access(backupPath);

        logger.info('Restoring database from backup', { backupPath, targetDbPath });

        // Create backup of current database before restoring (in case restore fails)
        const tempBackup = targetDbPath + '.restore-temp';
        try {
            await fs.copyFile(targetDbPath, tempBackup);
            logger.debug('Created temporary backup of current database');
        } catch (error) {
            // Current database might not exist (first restore), that's ok
            logger.debug('No existing database to backup before restore');
        }

        try {
            // Restore the backup
            await fs.copyFile(backupPath, targetDbPath);

            // Verify restored database
            const stats = await fs.stat(targetDbPath);

            logger.info('Database restored successfully', {
                backupPath,
                targetDbPath,
                size: stats.size
            });

            // Remove temporary backup
            try {
                await fs.unlink(tempBackup);
            } catch (error) {
                // Ignore if temp backup doesn't exist
            }

            return { success: true };
        } catch (restoreError) {
            // Restore failed, try to recover original database
            logger.error('Database restore failed, attempting to recover', {
                error: restoreError.message
            });

            try {
                await fs.copyFile(tempBackup, targetDbPath);
                logger.info('Original database recovered after failed restore');
            } catch (recoverError) {
                logger.error('Failed to recover original database', {
                    error: recoverError.message
                });
            }

            throw restoreError;
        }
    } catch (error) {
        logger.error('Failed to restore database backup', {
            backupPath,
            targetDbPath,
            error: error.message
        });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Check database integrity (basic check - file exists and has size)
 * @param {string} dbPath - Path to database file
 * @returns {Promise<{valid: boolean, size?: number, error?: string}>}
 */
async function checkDatabaseIntegrity(dbPath) {
    try {
        await fs.access(dbPath);
        const stats = await fs.stat(dbPath);

        // Basic check: file should be larger than 0 bytes
        if (stats.size === 0) {
            logger.warn('Database file is empty', { dbPath });
            return {
                valid: false,
                size: 0,
                error: 'Database file is empty'
            };
        }

        logger.debug('Database integrity check passed', {
            dbPath,
            size: stats.size
        });

        return {
            valid: true,
            size: stats.size
        };
    } catch (error) {
        logger.error('Database integrity check failed', {
            dbPath,
            error: error.message
        });

        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Get backup statistics
 * @returns {Promise<{count: number, totalSize: number, oldestBackup?: Date, newestBackup?: Date}>}
 */
async function getBackupStats() {
    const backups = await getBackupFiles();

    if (backups.length === 0) {
        return { count: 0, totalSize: 0 };
    }

    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);

    return {
        count: backups.length,
        totalSize,
        oldestBackup: backups[backups.length - 1].mtime,
        newestBackup: backups[0].mtime
    };
}

module.exports = {
    createBackup,
    restoreBackup,
    getBackupFiles,
    cleanOldBackups,
    checkDatabaseIntegrity,
    getBackupStats,
    getBackupDirectory
};
