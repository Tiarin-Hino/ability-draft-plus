import { join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import log from 'electron-log/main'
import { createWorker } from 'tesseract.js'
import type { Worker as TesseractWorker } from 'tesseract.js'
import type { StoreApi } from 'zustand/vanilla'
import { matchHeroName } from '@core/ocr/hero-name-matcher'
import type { HeroNameCandidate } from '@core/ocr/hero-name-matcher'
import { OCR_MIN_SIMILARITY } from '@shared/constants/thresholds'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'

// @DEV-GUIDE: OCRs the hero-name strips the ML worker crops from the 10 player
// cards each scan (names are ALWAYS English regardless of client language —
// see core/ocr/hero-name-matcher.ts). Design constraints:
// - One tesseract.js worker, lazily spawned on the first strip batch; strip
//   recognition is serialized through a queue (tesseract is not reentrant).
// - Per-row gating keeps the steady-state cost near zero: a row whose strip
//   bytes are unchanged since the last attempt is skipped, and a row that
//   already resolved to a confident hero is never OCR'd again this session
//   (names never change once a model is picked; reset() clears on new drafts).
// - CANDIDATE SCOPING (same trick as pick-slot template matching): a drafted
//   model can only be one of the draft's 12 pool heroes, so once the initial
//   scan has identified the pool the roster is narrowed to it. The full roster
//   is the fallback before the pool is known. Measured on the 2026-08-19
//   diagnostic run: 6 of 108 reads resolved to heroes that were NOT in the
//   lineup (e.g. Zeus, Luna, Weaver) — impossible reads that scoping removes
//   outright. Raising the similarity floor could NOT fix those: correct reads
//   run as low as 0.667 while one wrong read scored a perfect 1.000, so the
//   distributions overlap and any useful threshold costs more than it saves.
// - Results land in DraftStore.ocrHeroNamesByRow (row -> hero) and the log;
//   consumers (model-pick attribution, diagnostics) read them from the store.
// - Language data: tesseract.js downloads eng.traineddata on first use and
//   caches it in userData/ocr-cache. TODO(packaging): bundle the traineddata
//   in resources and point langPath at it so packaged builds work offline.

const logger = log.scope('ocr')

export interface OcrService {
  /** Fire-and-forget: queue name strips from a scan for recognition. */
  processStrips(strips: { row: number; png: ArrayBuffer }[]): void
  /** Clears per-row state (new draft session). */
  reset(): void
  /** Terminates the tesseract worker (app shutdown). */
  dispose(): Promise<void>
}

export function createOcrService(
  dbService: DatabaseService,
  draftStore: StoreApi<DraftStore>,
): OcrService {
  let workerPromise: Promise<TesseractWorker> | null = null
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  // Per-row gates
  const lastStripHash = new Map<number, string>()
  const resolvedRows = new Set<number>()

  let rosterCache: HeroNameCandidate[] | null = null
  function fullRoster(): HeroNameCandidate[] {
    if (rosterCache === null) {
      rosterCache = dbService.heroes.getAll().map((h) => ({
        name: h.name,
        displayName: h.displayName,
      }))
    }
    return rosterCache
  }

  /** The draft's 12 pool heroes when known, else every hero (see DEV-GUIDE). */
  function roster(): HeroNameCandidate[] {
    const pool = draftStore.getState().identifiedHeroModelsCache
    if (pool.length === 0) return fullRoster()
    const poolNames = new Set(pool.map((h) => h.heroName))
    const scoped = fullRoster().filter((c) => poolNames.has(c.name))
    return scoped.length > 0 ? scoped : fullRoster()
  }

  function getWorker(): Promise<TesseractWorker> {
    if (workerPromise === null) {
      workerPromise = createWorker('eng', 1, {
        cachePath: join(app.getPath('userData'), 'ocr-cache'),
      }).then(async (w) => {
        await w.setParameters({
          // Names are spaced capitals; whitelist kills unicode player names
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
        })
        logger.info('Tesseract worker ready')
        return w
      })
      workerPromise.catch((error) => {
        logger.error('Tesseract worker failed to start', {
          error: error instanceof Error ? error.message : String(error),
        })
        workerPromise = null
      })
    }
    return workerPromise
  }

  async function recognizeStrip(row: number, png: Buffer): Promise<void> {
    if (disposed || resolvedRows.has(row)) return
    const hash = createHash('md5').update(png).digest('hex')
    if (lastStripHash.get(row) === hash) return
    lastStripHash.set(row, hash)

    const worker = await getWorker()
    const { data } = await worker.recognize(png)

    // The strip holds the hero name plus (below it) the player name; match
    // line-by-line and keep the best similarity.
    let best: ReturnType<typeof matchHeroName> = null
    for (const line of data.text.split('\n')) {
      const m = matchHeroName(line, roster())
      if (m && (best === null || m.similarity > best.similarity)) best = m
    }
    if (best === null || best.similarity < OCR_MIN_SIMILARITY) {
      logger.debug('OCR strip unresolved', {
        row,
        text: data.text.replace(/\n/g, ' | ').slice(0, 120),
      })
      return
    }
    const match = best

    resolvedRows.add(row)
    draftStore.setState((state) => ({
      ocrHeroNamesByRow: {
        ...state.ocrHeroNamesByRow,
        [row]: {
          name: match.name,
          displayName: match.displayName,
          similarity: match.similarity,
        },
      },
    }))
    logger.info('OCR hero name resolved', {
      row,
      hero: match.name,
      similarity: Number(match.similarity.toFixed(3)),
    })
  }

  return {
    processStrips(strips): void {
      if (disposed) return
      for (const strip of strips) {
        const png = Buffer.from(strip.png)
        queue = queue
          .then(() => recognizeStrip(strip.row, png))
          .catch((error) => {
            logger.warn('OCR strip failed', {
              row: strip.row,
              error: error instanceof Error ? error.message : String(error),
            })
          })
      }
    },

    reset(): void {
      lastStripHash.clear()
      resolvedRows.clear()
      draftStore.setState({ ocrHeroNamesByRow: {} })
    },

    async dispose(): Promise<void> {
      disposed = true
      if (workerPromise !== null) {
        try {
          const w = await workerPromise
          await w.terminate()
        } catch {
          // Worker never came up — nothing to terminate
        }
        workerPromise = null
      }
    },
  }
}
