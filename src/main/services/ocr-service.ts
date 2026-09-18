import { join } from 'path'
import { createHash } from 'crypto'
import { mkdir, writeFile, appendFile } from 'fs/promises'
import sharp from 'sharp'
import { app } from 'electron'
import log from 'electron-log/main'
import { createWorker, PSM } from 'tesseract.js'
import type { Worker as TesseractWorker } from 'tesseract.js'
import type { StoreApi } from 'zustand/vanilla'
import {
  matchHeroName,
  matchThinTwoLetterHero,
  normalizeHeroText,
} from '@core/ocr/hero-name-matcher'
import type { HeroNameCandidate } from '@core/ocr/hero-name-matcher'
import {
  OCR_MIN_SIMILARITY,
  OCR_UNSCOPED_MIN_SIMILARITY,
  OCR_UNRESOLVED_DUMP_MAX,
  OCR_DARK_TEXT_THRESHOLD,
} from '@shared/constants/thresholds'
import type { DraftStore } from '../store/draft-store'
import type { DatabaseService } from './database-service'

// @DEV-GUIDE: OCRs the hero-name strips the ML worker crops from the 10 player
// cards each scan (names are ALWAYS English regardless of client language —
// see core/ocr/hero-name-matcher.ts). Design constraints:
// - One tesseract.js worker, lazily spawned on the first strip batch; strip
//   recognition is serialized through a queue (tesseract is not reentrant).
// - THREE PASSES per strip, stopping at the first one that names a hero (the
//   numbers behind them are in thresholds.ts, OCR_DARK_TEXT_THRESHOLD). One
//   reader is not enough: the draft screen renders the same text three ways —
//   light on dark (normal card), DARK ON LIGHT (the highlighted/active card,
//   which the original settings read as nothing at all), and wide-spaced caps
//   that the default page segmentation mangles ("ANTI-MAGE" -> "MACE", losing a
//   live model pick on 2026-09-17). Sparse-text mode first, then a dark-text
//   threshold, then the original mode. A pre-pick "NO HERO" card stops the
//   cascade at the pass that read it — those change pixels constantly (hover
//   animations) and must not cost three recognitions every time.
// - FULL-ROSTER FALLBACK: a strip no pass could match against the draft's pool
//   is matched against every hero, accepted only at OCR_UNSCOPED_MIN_SIMILARITY.
//   The pool scan misses a hero in ~1 draft in 3 (unrecognized W-slot), and its
//   model pick could never be read otherwise; model-picks-from-ocr.ts then maps
//   the read onto the pool's single unidentified row. Before the pool is known
//   at all, every match uses that same strict bar. The thin-letter Io fallback
//   needs a known pool that contains Io.
// - A strip queued while a draft's pool was known but recognized after the
//   session was reset is DROPPED: it belongs to a draft that no longer exists.
//   The draft-end capture queues strips, auto-close resets the session before
//   tesseract gets to them, and matched against the full roster the post-draft
//   screen produced wrong heroes (2026-09-18 sweep: "AME" -> Axe, "I" -> Io).
// - Per-row gating keeps the steady-state cost near zero: a row whose strip
//   bytes are unchanged since the last attempt is skipped. A row IS re-OCR'd
//   when its pixels change — even after resolving — because a resolution can
//   be a MISREAD (observed 2026-08-26: an empty card read as the wrong hero at
//   0.933 and, under the old never-re-OCR rule, poisoned attribution for the
//   whole draft). A changed card re-reads and REPLACES the entry only when the
//   new read clears the similarity floor; failed reads never wipe a good value.
//   A card's name area changes pixels only a handful of times per draft, so
//   the cost stays negligible (reset() clears state on new drafts).
// - CANDIDATE SCOPING (same trick as pick-slot template matching): a drafted
//   model can only be one of the draft's 12 pool heroes, so once the initial
//   scan has identified the pool the roster is narrowed to it. The full roster
//   is the fallback before the pool is known. Measured on the 2026-08-19
//   diagnostic run: 6 of 108 reads resolved to heroes that were NOT in the
//   lineup (e.g. Zeus, Luna, Weaver) — impossible reads that scoping removes
//   outright. Raising the similarity floor could NOT fix those: correct reads
//   run as low as 0.667 while one wrong read scored a perfect 1.000, so the
//   distributions overlap and any useful threshold costs more than it saves.
// - Results land in DraftStore.ocrHeroNamesByRow (row -> hero) and the log.
//   They are THE model-pick source in playing mode (model-picks-from-ocr.ts):
//   auto-rescan calls settle() after each capture so a card read from that
//   capture is applied before the capture's ability picks are sequenced.
// - Dev builds (debugDir set) record EVERY strip recognition as a JSONL line in
//   debug/ocr-diagnostics (row, the hero it resolved to, which pass won, each
//   pass's raw text, and — when nothing matched — the best match against the
//   FULL roster, which separates "the name was unreadable" from "the name read
//   fine but that hero is not in the identified pool", the failure that cost
//   2/3 of the unresolved reads in the 2026-09-17 sweep trial) and save the STRIP ITSELF plus its text under
//   debug/ocr-unresolved when no pass named a hero and the card is not the
//   pre-pick "NO HERO" one (capped per draft, OCR_UNRESOLVED_DUMP_MAX). The
//   JSONL is what the draft-cycle analyzer reports per hero; the raw text in it
//   is enough to re-test matcher changes offline without the images. A model
//   pick that never OCRs leaves a gap in the draft order; these show why.
// - Language data: tesseract.js downloads eng.traineddata on first use and
//   caches it in userData/ocr-cache. TODO(packaging): bundle the traineddata
//   in resources and point langPath at it so packaged builds work offline.

const logger = log.scope('ocr')

export interface OcrService {
  /** Fire-and-forget: queue name strips from a scan for recognition. */
  processStrips(strips: { row: number; png: ArrayBuffer }[]): void
  /** Fire-and-forget: OCR a "YOU WILL DRAFT IN: N" digits strip; the parsed
   * seconds land in DraftStore.draftCountdown stamped with capturedAtMs. */
  processCountdown(png: ArrayBuffer, capturedAtMs: number): void
  /**
   * Resolves true once every strip queued so far has been recognized, or false
   * after timeoutMs. Never rejects (strip failures are already caught per strip).
   */
  settle(timeoutMs: number): Promise<boolean>
  /** Clears per-row state (new draft session). */
  reset(): void
  /** Terminates the tesseract worker (app shutdown). */
  dispose(): Promise<void>
}

export function createOcrService(
  dbService: DatabaseService,
  draftStore: StoreApi<DraftStore>,
  /** The ten GSI player names (spectate); the closed set the name line is matched against. */
  getPlayerNames?: () => string[],
  /** Dev-only: userData/debug (see DEV-GUIDE); undefined = no diagnostics. */
  debugDir?: string,
): OcrService {
  let workerPromise: Promise<TesseractWorker> | null = null
  let queue: Promise<void> = Promise.resolve()
  let disposed = false

  // Per-row gates
  const lastStripHash = new Map<number, string>()
  /** Countdown strip pixels unchanged -> skip (it changes every second). */
  let lastCountdownHash: string | null = null

  let unresolvedDumps = 0
  const unresolvedDumpDir = debugDir === undefined ? undefined : join(debugDir, 'ocr-unresolved')
  const diagnosticsPath =
    debugDir === undefined
      ? undefined
      : join(
          debugDir,
          'ocr-diagnostics',
          `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
        )
  let diagnosticsDirReady = false

  /** One JSONL line per strip recognition. Fire-and-forget; never throws. */
  function recordOcrDiagnostics(entry: Record<string, unknown>): void {
    if (diagnosticsPath === undefined) return
    void (async () => {
      try {
        if (!diagnosticsDirReady) {
          await mkdir(join(diagnosticsPath, '..'), { recursive: true })
          diagnosticsDirReady = true
        }
        await appendFile(diagnosticsPath, JSON.stringify(entry) + '\n')
      } catch {
        // Diagnostics must never break OCR
      }
    })()
  }

  /**
   * Save a strip tesseract could not turn into a hero, with its raw text and
   * the closest (rejected) candidate. Never throws — diagnostics must not
   * break OCR.
   */
  async function dumpUnresolvedStrip(
    row: number,
    png: Buffer,
    hash: string,
    text: string,
    closest: ReturnType<typeof matchHeroName>,
  ): Promise<string | null> {
    if (unresolvedDumpDir === undefined || unresolvedDumps >= OCR_UNRESOLVED_DUMP_MAX) return null
    unresolvedDumps += 1
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `${stamp}_row${row}_${hash.slice(0, 8)}`
    try {
      await mkdir(unresolvedDumpDir, { recursive: true })
      const file = join(unresolvedDumpDir, name)
      await writeFile(`${file}.png`, png)
      await writeFile(
        `${file}.txt`,
        [
          `row: ${row}`,
          `roster: ${draftStore.getState().identifiedHeroModelsCache.length > 0 ? 'pool' : 'full'}`,
          `closest: ${closest ? `${closest.name} ${closest.similarity.toFixed(3)}` : 'none'}`,
          'text:',
          text,
        ].join('\n'),
      )
      return name
    } catch {
      // Diagnostic-only path — a full disk or locked file must not fail OCR
      return null
    }
  }

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

  /**
   * Resolve which player's card this row is, by matching the name line against
   * the ten names GSI reports. Spectate only (a playing client knows one name,
   * and its row is already resolved by own-row detection). Never overwrites a
   * resolved row with a weaker read, and refuses on ambiguity — a wrong name is
   * worse than none, which is the same rule the whole mapping follows.
   */
  function matchPlayerName(row: number, lines: string[], skipLine: number): void {
    const candidates = getPlayerNames?.() ?? []
    if (candidates.length === 0) return
    const roster = candidates.map((name) => ({ name, displayName: name }))

    let best: ReturnType<typeof matchHeroName> = null
    for (const [i, line] of lines.entries()) {
      if (i === skipLine) continue
      const m = matchHeroName(line, roster)
      if (m && (best === null || m.similarity > best.similarity)) best = m
    }
    if (best === null || best.similarity < OCR_MIN_SIMILARITY) return

    const previous = draftStore.getState().ocrPlayerNamesByRow[row]
    if (previous && previous.similarity > best.similarity) return
    if (previous?.name === best.name) return

    draftStore.setState((state) => ({
      ocrPlayerNamesByRow: {
        ...state.ocrPlayerNamesByRow,
        [row]: { name: best.name, similarity: best.similarity },
      },
    }))
    logger.info('OCR player name resolved', {
      row,
      player: best.name,
      similarity: Number(best.similarity.toFixed(3)),
    })
  }

  /** Tesseract page segmentation modes used for the name strips. */
  const PSM_AUTO = PSM.AUTO
  const PSM_SPARSE = PSM.SPARSE_TEXT
  const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ -'"

  interface StripPass {
    name: string
    psm: PSM
    whitelist: string
    /** Optional pre-processing of the strip PNG before recognition. */
    prepare?: (png: Buffer) => Promise<Buffer>
  }

  const STRIP_PASSES: StripPass[] = [
    { name: 'sparse', psm: PSM_SPARSE, whitelist: NAME_CHARS },
    {
      name: 'darkText',
      psm: PSM_SPARSE,
      whitelist: NAME_CHARS,
      // The highlighted card is dark text on a lit background: below the
      // threshold is the text, above it the card
      prepare: (png) => sharp(png).threshold(OCR_DARK_TEXT_THRESHOLD).png().toBuffer(),
    },
    // The original reader, last: it is the only one that ever produced a
    // confident WRONG hero, but it still rescues strips the other two miss
    { name: 'auto', psm: PSM_AUTO, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ' },
  ]

  interface StripRead {
    lines: string[]
    text: string
    /** Best hero match on the strip, whatever its similarity. */
    best: ReturnType<typeof matchHeroName>
    bestLine: number
    /** The strip's first text line — where the hero name is (see readStrip). */
    heroLineText: string
  }

  /** One recognition of the strip; pure reading, no store writes. */
  async function readStrip(png: Buffer, pass: StripPass): Promise<StripRead> {
    const worker = await getWorker()
    await worker.setParameters({
      tessedit_char_whitelist: pass.whitelist,
      tessedit_pageseg_mode: pass.psm,
    })
    const input = pass.prepare ? await pass.prepare(png) : png
    const { data } = await worker.recognize(input)

    // The hero name is the strip's FIRST text line; the player name sits below.
    // A two-letter exact match (Io) only counts there — a player called "Io" or
    // a "[IO]" tag on the name line must never read as an Io model pick.
    const lines = data.text.split('\n')
    const heroLine = lines.findIndex((line) => normalizeHeroText(line).length > 0)
    let best: ReturnType<typeof matchHeroName> = null
    let bestLine = -1
    for (const [i, line] of lines.entries()) {
      if (i !== heroLine && normalizeHeroText(line).length === 2) continue
      const m = matchHeroName(line, roster())
      if (m && (best === null || m.similarity > best.similarity)) {
        best = m
        bestLine = i
      }
    }
    return { lines, text: data.text, best, bestLine, heroLineText: lines[heroLine] ?? '' }
  }

  /**
   * The best match these reads have against EVERY hero, whatever the pool. The
   * caller decides what to do with it: accept it at OCR_UNSCOPED_MIN_SIMILARITY
   * (the full-roster fallback) or only record it for diagnostics.
   */
  function bestUnscopedMatch(reads: readonly StripRead[]): ReturnType<typeof matchHeroName> {
    let best: ReturnType<typeof matchHeroName> = null
    for (const read of reads) {
      for (const line of read.lines) {
        const m = matchHeroName(line, fullRoster())
        if (m && (best === null || m.similarity > best.similarity)) best = m
      }
    }
    return best
  }

  /** True while a draft's pool heroes are identified (the draft session). */
  function poolKnown(): boolean {
    return draftStore.getState().identifiedHeroModelsCache.length > 0
  }

  /** The pre-pick card prints "NO HERO" — nothing more to try on this strip. */
  function readsNoHero(lines: string[]): boolean {
    return lines.some((line) => normalizeHeroText(line).includes('NOHERO'))
  }

  async function recognizeStrip(
    row: number,
    png: Buffer,
    /** Whether a draft's pool was known when this strip was queued. */
    queuedWithPool: boolean,
  ): Promise<void> {
    if (disposed) return
    const scoped = poolKnown()
    if (queuedWithPool && !scoped) {
      // The draft this strip came from was reset while it waited (see DEV-GUIDE)
      logger.debug('OCR strip dropped: its draft session was reset', { row })
      recordOcrDiagnostics({ ts: new Date().toISOString(), row, dropped: 'session reset' })
      return
    }
    const hash = createHash('md5').update(png).digest('hex')
    if (lastStripHash.get(row) === hash) return
    lastStripHash.set(row, hash)

    // Against the pool the usual floor holds; with no pool yet, roster() is
    // every hero and a match must clear the strict full-roster bar
    const minSimilarity = scoped ? OCR_MIN_SIMILARITY : OCR_UNSCOPED_MIN_SIMILARITY

    const reads: StripRead[] = []
    let read: StripRead | null = null
    let noHero = false
    let winningPass: string | null = null
    for (const pass of STRIP_PASSES) {
      if (disposed) return
      read = await readStrip(png, pass)
      reads.push(read)
      // Same read, second question: which PLAYER is on this card? The hero name
      // only identifies a row once that player has drafted a model, so matching
      // the name line as well is what lets rows resolve during the preview. The
      // candidate set is the ten names GSI already gave us, so a mangled read
      // only has to be closer to the right name than to the other nine — the
      // same closed-set trick the hero matcher relies on. Excludes the line that
      // won the hero match so a hero name cannot be read as a player.
      matchPlayerName(row, read.lines, read.bestLine)
      noHero = readsNoHero(read.lines)
      if (noHero) break
      if (read.best !== null && read.best.similarity >= minSimilarity) {
        winningPass = pass.name
        break
      }
    }

    /** Dev diagnostics: what every pass saw, and what came of it. */
    const record = (
      hero: string | null,
      similarity: number | null,
      dump: string | null,
      unscoped: ReturnType<typeof matchHeroName> = null,
    ): void => {
      recordOcrDiagnostics({
        ts: new Date().toISOString(),
        row,
        hero,
        similarity: similarity === null ? null : Number(similarity.toFixed(3)),
        pass: winningPass,
        noHero,
        poolScoped: scoped,
        reads: reads.map((r) => r.text.replace(/\n/g, ' | ').trim()),
        ...(unscoped !== null && unscoped.similarity >= OCR_MIN_SIMILARITY
          ? { unscoped: { name: unscoped.name, similarity: Number(unscoped.similarity.toFixed(3)) } }
          : {}),
        ...(dump !== null ? { strip: dump } : {}),
      })
    }

    let best = read?.best ?? null
    let fallback: 'thinLetter' | 'fullRoster' | null = null
    const unresolved = (): boolean =>
      fallback === null && (best === null || best.similarity < minSimilarity)
    const unscopedBest = noHero ? null : bestUnscopedMatch(reads)
    if (unresolved() && !noHero && scoped) {
      // The pool scan can miss a hero; its name may still read cleanly
      if (unscopedBest !== null && unscopedBest.similarity >= OCR_UNSCOPED_MIN_SIMILARITY) {
        best = unscopedBest
        fallback = 'fullRoster'
        winningPass = 'fullRoster'
      }
    }
    if (unresolved() && !noHero && scoped) {
      // Every pass failed on a card that IS showing a hero: the one name too
      // thin to read whole (Io) survives as a fragment of its own first line.
      // Needs the pool: against every hero, any stray "O" would be a candidate
      for (const attempt of reads) {
        const thin = matchThinTwoLetterHero(attempt.heroLineText, roster())
        if (thin !== null) {
          best = thin
          fallback = 'thinLetter'
          winningPass = 'thinLetter'
          break
        }
      }
    }
    if (best === null || unresolved()) {
      logger.debug('OCR strip unresolved', {
        row,
        text: (read?.text ?? '').replace(/\n/g, ' | ').slice(0, 120),
      })
      // The pre-pick card is expected to resolve to nothing
      const dump = noHero
        ? null
        : await dumpUnresolvedStrip(row, png, hash, read?.text ?? '', best)
      record(null, best?.similarity ?? null, dump, unscopedBest)
      return
    }
    const match = best

    record(match.name, match.similarity, null)

    const previous = draftStore.getState().ocrHeroNamesByRow[row]
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
    if (previous && previous.name !== match.name) {
      // A changed card overruled an earlier read — usually a misread healing
      logger.info('OCR hero name revised', {
        row,
        from: previous.name,
        to: match.name,
        similarity: Number(match.similarity.toFixed(3)),
      })
    } else {
      logger.info('OCR hero name resolved', {
        row,
        hero: match.name,
        similarity: Number(match.similarity.toFixed(3)),
        ...(fallback !== null ? { read: `${fallback} fallback` } : {}),
      })
    }
  }

  /**
   * Digits-only recognition of the countdown strip. Runs inside the same
   * serialized queue as the name strips; the whitelist is switched to digits
   * for this recognize and restored after (tesseract is not reentrant, so the
   * queue guarantees no interleaving).
   */
  async function recognizeCountdown(
    png: Buffer,
    capturedAtMs: number,
  ): Promise<void> {
    if (disposed) return
    const hash = createHash('md5').update(png).digest('hex')
    if (lastCountdownHash === hash) return // countdown unchanged since last read
    lastCountdownHash = hash

    const worker = await getWorker()
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' })
    try {
      const { data } = await worker.recognize(png)
      const runs = data.text.match(/\d+/g)
      const seconds = runs ? parseInt(runs[runs.length - 1], 10) : NaN
      // Max legal countdown: 59s preview + full serpentine schedule (~370s)
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 400) {
        logger.debug('Countdown strip unresolved', {
          text: data.text.replace(/\n/g, ' | ').slice(0, 40),
        })
        return
      }
      draftStore.setState({ draftCountdown: { seconds, atMs: capturedAtMs } })
    } finally {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
      })
    }
  }

  return {
    processStrips(strips): void {
      if (disposed) return
      const queuedWithPool = poolKnown()
      for (const strip of strips) {
        const png = Buffer.from(strip.png)
        queue = queue
          .then(() => recognizeStrip(strip.row, png, queuedWithPool))
          .catch((error) => {
            logger.warn('OCR strip failed', {
              row: strip.row,
              error: error instanceof Error ? error.message : String(error),
            })
          })
      }
    },

    processCountdown(png, capturedAtMs): void {
      if (disposed) return
      const buffer = Buffer.from(png)
      queue = queue
        .then(() => recognizeCountdown(buffer, capturedAtMs))
        .catch((error) => {
          logger.warn('Countdown OCR failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
    },

    settle(timeoutMs): Promise<boolean> {
      const drained = queue.then(() => true)
      let timer: NodeJS.Timeout | undefined
      const timedOut = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      })
      return Promise.race([drained, timedOut]).finally(() => clearTimeout(timer))
    },

    reset(): void {
      lastStripHash.clear()
      lastCountdownHash = null
      unresolvedDumps = 0
      draftStore.setState({ ocrHeroNamesByRow: {}, draftCountdown: null })
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
