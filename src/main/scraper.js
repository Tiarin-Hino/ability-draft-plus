const { delay, sendStatusUpdate: genericSendStatusUpdate } = require('./utils');
const { updateLastSuccessfulScrapeDate, getLastSuccessfulScrapeDate, formatLastUpdatedDateForDisplay } = require('./dbUtils');
const { scrapeAndStoreAbilitiesAndHeroes } = require('../scraper/abilityScraper');
const { scrapeAndStoreAbilityPairs } = require('../scraper/abilityPairScraper');
const { scrapeAndStoreLiquipediaData } = require('../scraper/liquipediaScraper');
const { ABILITIES_URL, ABILITY_PAIRS_URL, IS_PACKAGED } = require('../../config');

async function performFullScrape(activeDbPath, statusCallbackWebContents) {
    const sendStatus = (msg) => genericSendStatusUpdate(statusCallbackWebContents, 'scrape-status', msg);
    try {
        sendStatus('Starting all data updates...');
        await delay(100);

        sendStatus('Phase 1/3: Updating heroes and abilities data from Windrun.io...');
        await scrapeAndStoreAbilitiesAndHeroes(activeDbPath, ABILITIES_URL, sendStatus);
        await delay(100);

        sendStatus('Phase 2/3: Updating ability pair data from Windrun.io...');
        await scrapeAndStoreAbilityPairs(activeDbPath, ABILITY_PAIRS_URL, sendStatus);
        await delay(100);

        if (!IS_PACKAGED) {
            sendStatus('Phase 3/3: Enriching ability data with order and ultimate status from Liquipedia (Dev Mode)...');
            await scrapeAndStoreLiquipediaData(activeDbPath, sendStatus, false);
            await delay(100);
        } else {
            sendStatus('Phase 3/3: Skipping Liquipedia data enrichment (Production Mode).');
            await delay(100);
        }

        const newDate = await updateLastSuccessfulScrapeDate(activeDbPath);
        const displayDate = formatLastUpdatedDateForDisplay(newDate);
        genericSendStatusUpdate(statusCallbackWebContents, 'last-updated-date', displayDate);

        sendStatus({ key: 'ipcMessages.scrapeComplete' });
        return true;
    } catch (error) {
        console.error('[MainScrape] Consolidated scraping failed:', error.message);
        sendStatus({ key: 'ipcMessages.scrapeError', params: { error: error.message } });
        const currentDate = await getLastSuccessfulScrapeDate(activeDbPath);
        const displayDate = formatLastUpdatedDateForDisplay(currentDate);
        genericSendStatusUpdate(statusCallbackWebContents, 'last-updated-date', displayDate);
        return false;
    }
}

module.exports = {
    performFullScrape,
};
