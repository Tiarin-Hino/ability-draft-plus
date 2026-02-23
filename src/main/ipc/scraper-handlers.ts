import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type { ScraperService } from '../services/scraper-service'

// @DEV-GUIDE: Scraper domain IPC handlers. Both are fire-and-forget (ipcMain.on) because
// scraping is a long-running background operation. Progress is pushed to the AppStore
// (scraperStatus/scraperMessage) which @zubridge syncs to the control panel in real-time.
//
// scraper:start → triggers Windrun.io full scrape (abilities, heroes, pairs, triplets)
// scraper:startLiquipedia → triggers Liquipedia enrichment (dev-mode only, gated in service)

const logger = log.scope('ipc:scraper')

export function registerScraperHandlers(scraperService: ScraperService): void {
  ipcMain.on('scraper:start', () => {
    logger.info('Received scraper:start request')
    scraperService.startScrape()
  })

  ipcMain.on('scraper:startLiquipedia', () => {
    logger.info('Received scraper:startLiquipedia request')
    scraperService.startLiquipedia()
  })
}
