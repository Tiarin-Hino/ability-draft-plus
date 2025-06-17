const Database = require('better-sqlite3');

/**
 * @module dbUtils
 * @description Utility functions for interacting with the application's SQLite database,
 * specifically for managing metadata like the last successful scrape date.
 */

/**
 * Updates or inserts the 'last_successful_scrape_date' in the Metadata table.
 * The date is stored in 'YYYY-MM-DD' format.
 * @param {string} dbPathToUse - The path to the SQLite database file.
 * @returns {string | null} The current date string (YYYY-MM-DD) if the update was successful, otherwise null.
 */
function updateLastSuccessfulScrapeDate(dbPathToUse) {
    const currentDate = new Date().toISOString().split('T')[0];
    let db = null;
    try {
        db = new Database(dbPathToUse);
        db.prepare("INSERT OR REPLACE INTO Metadata (key, value) VALUES ('last_successful_scrape_date', ?)").run(currentDate);
        return currentDate;
    } catch (error) {
        console.error('[MainDB] Error updating last successful scrape date:', error);
        return null;
    } finally {
        if (db && db.open) db.close();
    }
}

/**
 * Retrieves the 'last_successful_scrape_date' from the Metadata table.
 * @param {string} dbPathToUse - The path to the SQLite database file.
 * @returns {string | null} The date string (YYYY-MM-DD) of the last successful scrape,
 * or null if not found or an error occurs.
 */
function getLastSuccessfulScrapeDate(dbPathToUse) {
    let db = null;
    try {
        db = new Database(dbPathToUse, { readonly: true });
        const row = db.prepare("SELECT value FROM Metadata WHERE key = 'last_successful_scrape_date'").get();
        return row ? row.value : null;
    } catch (error) {
        console.error('[MainDB] Error fetching last successful scrape date:', error);
        return null;
    } finally {
        if (db && db.open) db.close();
    }
}

/**
 * Formats a date string from 'YYYY-MM-DD' format to 'MM/DD/YYYY' for display.
 * Handles cases where the input date string might be null, undefined, or invalid.
 * @param {string | null | undefined} dateStringYYYYMMDD - The date string in 'YYYY-MM-DD' format.
 * @returns {string} The formatted date string (e.g., "12/31/2023"),
 * or a placeholder like "Never", "Invalid Date", or "Date Error".
 */
function formatLastUpdatedDateForDisplay(dateStringYYYYMMDD) {
    let displayDate = "Never";
    if (dateStringYYYYMMDD) {
        try {
            const [year, month, day] = dateStringYYYYMMDD.split('-');
            if (year && month && day) {
                displayDate = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
            } else {
                displayDate = "Invalid Date";
            }
        } catch (e) {
            console.error("[MainDBUtils] Error formatting date for display:", e);
            displayDate = "Date Error";
        }
    }
    return displayDate;
}

module.exports = {
    updateLastSuccessfulScrapeDate,
    getLastSuccessfulScrapeDate,
    formatLastUpdatedDateForDisplay,
};
