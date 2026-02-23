import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import log from 'electron-log/main'
import { performFullScrape, performLiquipediaEnrichment, createWindrunApiClient } from '@core/scraper'
import type { ScraperDeps, LiquipediaDeps } from '@core/scraper'
import type { MlModelGaps } from '@core/ml/staleness-detector'
import type { DatabaseService } from './database-service'
import type { AppStore } from '../store/app-store'

// @DEV-GUIDE: Orchestrates data scraping from Windrun.io (ability/hero stats, synergy pairs,
// triplets) and Liquipedia (ability_order, is_ultimate enrichment).
//
// Windrun scrape: Uses the JSON API at api.windrun.io/api/v2/ (not HTML scraping).
// The pure scraping logic lives in src/core/scraper/ -- this service is the Electron adapter
// that wires it to the DB repositories, AppStore progress/status, and class_names.json for
// ML model staleness detection (finds abilities in DB that the model can't recognize).
//
// Liquipedia enrichment: Dev-mode only (gated by app.isPackaged). Scrapes hero pages from
// liquipedia.net to fill in ability_order and is_ultimate fields that Windrun doesn't provide.
//
// Both operations are fire-and-forget (started via IPC, progress pushed to AppStore).
// Guards prevent double-runs (isWindrunRunning / isLiquipediaRunning flags).

const logger = log.scope('scraper')

export interface ScraperService {
  startScrape(): void
  startLiquipedia(): void
  restorePersistedState(): void
}

// @DEV-GUIDE: Loads the ONNX model's class_names.json to compare against scraped abilities.
// This enables staleness detection: if Windrun has abilities the model doesn't know about,
// the UI shows a warning (mlModelGaps). The gaps are persisted in the metadata table.
function loadClassNames(): string[] {
  try {
    const basePath = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    const classNamesPath = join(basePath, 'model', 'class_names.json')
    const raw = readFileSync(classNamesPath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, string> | string[]
    // class_names.json is { "0": "name", "1": "name", ... } — extract values in order
    if (Array.isArray(parsed)) {
      return parsed
    }
    const keys = Object.keys(parsed).sort((a, b) => Number(a) - Number(b))
    return keys.map((k) => parsed[k])
  } catch (err) {
    logger.warn('Could not load class_names.json for staleness detection', { error: err })
    return []
  }
}

export function createScraperService(
  dbService: DatabaseService,
  appStore: AppStore,
): ScraperService {
  let isWindrunRunning = false
  let isLiquipediaRunning = false

  return {
    restorePersistedState() {
      // Restore persisted model gaps from metadata table
      const persistedGaps = dbService.metadata.get('ml_model_gaps')
      if (persistedGaps) {
        try {
          const gaps = JSON.parse(persistedGaps) as MlModelGaps
          appStore.setState({ mlModelGaps: gaps })
        } catch {
          logger.warn('Could not parse persisted ml_model_gaps')
        }
      }

      // Restore persisted liquipedia last updated date
      const liquipediaDate = dbService.metadata.get('liquipedia_last_updated')
      if (liquipediaDate) {
        appStore.setState({ liquipediaLastUpdated: liquipediaDate })
      }
    },

    startScrape() {
      if (isWindrunRunning) {
        logger.warn('Scrape already in progress, ignoring request')
        return
      }

      isWindrunRunning = true
      appStore.setState({
        scraperStatus: 'running',
        scraperMessage: 'Starting scrape...',
      })

      const apiClient = createWindrunApiClient()
      const classNames = loadClassNames()

      const deps: ScraperDeps = {
        apiClient,
        heroes: dbService.heroes,
        abilities: dbService.abilities,
        synergies: dbService.synergies,
        triplets: dbService.triplets,
        metadata: dbService.metadata,
        persist: () => dbService.persist(),
        classNames,
      }

      performFullScrape(deps, (progress) => {
        logger.info(`Scraper [${progress.phase}]: ${progress.message}`)
        appStore.setState({ scraperMessage: progress.message })
      })
        .then((result) => {
          if (result.success) {
            const lastUpdated = dbService.metadata.getLastScrapeDate()
            appStore.setState({
              scraperStatus: 'idle',
              scraperMessage: 'Scrape completed successfully!',
              scraperLastUpdated: lastUpdated,
            })

            // Handle model gaps
            if (result.modelGaps !== undefined) {
              appStore.setState({ mlModelGaps: result.modelGaps })
              dbService.metadata.set('ml_model_gaps', JSON.stringify(result.modelGaps))
              dbService.persist()

              if (result.modelGaps) {
                logger.info('ML model staleness detected', {
                  missingFromModel: result.modelGaps.missingFromModel.length,
                  staleInModel: result.modelGaps.staleInModel.length,
                  missingList: result.modelGaps.missingFromModel,
                  staleList: result.modelGaps.staleInModel,
                })
              } else {
                logger.info('ML model class names are in sync with scraped abilities')
              }
            }
          } else {
            appStore.setState({
              scraperStatus: 'error',
              scraperMessage: result.error ?? 'Unknown error',
            })
          }
        })
        .catch((err) => {
          logger.error('Scrape failed unexpectedly', { error: err })
          appStore.setState({
            scraperStatus: 'error',
            scraperMessage: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          isWindrunRunning = false
        })
    },

    startLiquipedia() {
      if (app.isPackaged) {
        logger.warn('Liquipedia enrichment is only available in dev mode')
        return
      }

      if (isLiquipediaRunning) {
        logger.warn('Liquipedia enrichment already in progress, ignoring request')
        return
      }

      isLiquipediaRunning = true
      appStore.setState({
        liquipediaStatus: 'running',
        liquipediaMessage: 'Starting Liquipedia enrichment...',
      })

      // Get hero display names from DB
      const heroes = dbService.heroes.getAll()
      if (heroes.length === 0) {
        appStore.setState({
          liquipediaStatus: 'error',
          liquipediaMessage: 'No heroes in database. Run Windrun scrape first.',
        })
        isLiquipediaRunning = false
        return
      }

      const heroDisplayNames = heroes.map((h) => h.displayName)

      const deps: LiquipediaDeps = {
        abilities: dbService.abilities,
        persist: () => dbService.persist(),
        enrichFromLiquipedia: async (heroNames, onProgress) => {
          const { enrichFromLiquipedia } = await import('@core/scraper/liquipedia-scraper')
          return enrichFromLiquipedia(heroNames, onProgress)
        },
      }

      performLiquipediaEnrichment(deps, heroDisplayNames, (progress) => {
        logger.info(`Liquipedia [${progress.phase}]: ${progress.message}`)
        appStore.setState({ liquipediaMessage: progress.message })
      })
        .then((result) => {
          if (result.success) {
            const now = new Date().toISOString()
            dbService.metadata.set('liquipedia_last_updated', now)
            dbService.persist()
            appStore.setState({
              liquipediaStatus: 'idle',
              liquipediaMessage: 'Liquipedia enrichment completed!',
              liquipediaLastUpdated: now,
            })
          } else {
            appStore.setState({
              liquipediaStatus: 'error',
              liquipediaMessage: result.error ?? 'Unknown error',
            })
          }
        })
        .catch((err) => {
          logger.error('Liquipedia enrichment failed unexpectedly', { error: err })
          appStore.setState({
            liquipediaStatus: 'error',
            liquipediaMessage: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          isLiquipediaRunning = false
        })
    },
  }
}
