import { parentPort } from 'worker_threads'
import { readdir, stat, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  MlWorkerRequest,
  MlWorkerReadyResponse,
  MlWorkerSuccessResponse,
  MlWorkerErrorResponse,
  InitialScanResults,
  PickCandidates,
} from '@shared/types/ml'
import type { ScanResult, SlotCoordinate, ResolutionLayout } from '@shared/types'
import { createOnnxClassifier } from '@core/ml/onnx-classifier'
import {
  preprocessBatch,
  cropTile,
  cropRegionPng,
  loadIconVector,
  saveRawVectorPng,
} from '@core/ml/preprocessing'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { ClassifierResult } from '@core/ml/classifier'
import {
  makeIconTemplate,
  matchPickSlotScoped,
  computePixelStats,
} from '@core/ml/template-matcher'
import type { IconTemplate, PickMatchResult } from '@core/ml/template-matcher'
import { matchModelTile } from '@core/ml/model-tile-matcher'
import {
  MODEL_TILE_COMPARE_SIZE,
  PLAYER_CARD_COMPARE_SIZE,
  PICK_TEMPLATE_COMPARE_SIZE,
  PICK_TEMPLATE_CROP_INSET_RATIO,
  PICK_TEMPLATE_FALLBACK_MIN_NCC,
  PICK_TEMPLATE_EMPTY_STD,
  MODEL_INPUT_SIZE,
  OCR_NAME_STRIP_HEIGHT_RATIO,
  OCR_STRIP_TARGET_WIDTH,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: ML Worker thread entry point. Runs as a Node.js worker_thread, spawned by MlService.
// Handles two operations: init (load ONNX model) and scan (classify ability icons).
//
// Message protocol:
// - Main → { type: 'init', payload: { modelPath, classNamesPath, useDirectML } }
//   → Worker replies { status: 'ready', executionProvider } or { status: 'error', type: 'init-error' }
// - Main → { type: 'scan', payload: { screenshotBuffer, layout, confidenceThreshold, isInitialScan,
//   activeClassNames? } } → Worker replies { status: 'success', results } or { status: 'error' }
//   activeClassNames (DB ability names) masks model classes for removed-from-pool abilities.
// - Main → { type: 'dispose' } → Worker releases ONNX session
//
// Scan pipeline: receive a transferred RAW RGB bitmap (+dimensions — no PNG anywhere:
// the encode/decode round-trip cost ~145ms/scan) → extract slot images from it (sharp
// crop+resize to 96x96) → convert to float32 (raw 0-255 — the model's internal
// Rescaling layer maps to [-1,1]) → ONNX batch inference → filter by confidence →
// return ScanResult[]. Slot crops MUST read from the single shared bitmap: cropping
// from an encoded buffer re-decoded the full screenshot per slot (~1.1s/scan at 1440p).
//
// For initial scan: processes ultimate + standard slots, extracts heroDefiningAbilities (ability_order===2).
// For rescan: processes only the selected-ability slots. Those PICK slots are identified by
// TEMPLATE MATCHING (core/ml/template-matcher.ts) against the official CDN icons in
// payload.pickIconsDir (userData/stream-icons/abilities): pick boxes render icons flat, so a
// border-inset crop NCC-matched against the cache beats the classifier, which regressed on
// exactly these crops (missed picks + one confident misread on a real board). Templates load
// lazily on the first rescan; each later scan re-stats the directory and (re)loads files that
// are new OR whose mtime changed — the icon cache rewrites files when Valve reworks art
// (see ICON_CACHE_REFRESH_TTL_MS), so templates must not be treated as append-only.
// The classifier remains the pick-slot path only when no templates are available.
// Every scan additionally captures the 12 model portrait tiles (models_coords) as
// normalized raw crops — the scan-processor diffs them against the initial-scan
// baseline to detect picked models (see core/domain/model-pick-detection.ts) —
// plus the 10 player cards (heroes_coords) for the GSI slot <-> scan row
// correlation (see core/domain/slot-row-correlation.ts).

if (!parentPort) {
  throw new Error('ml-worker must run as a worker thread')
}

const classifier = createOnnxClassifier()

// Pick-slot icon templates, keyed by ability name. Loaded lazily from
// pickIconsDir on the first selected-abilities scan; each later scan re-stats
// the directory and (re)loads files that are new or whose mtime changed —
// the icon cache rewrites a file in place when Valve reworks an icon.
let pickIconsDir: string | null = null
const pickTemplates = new Map<string, IconTemplate>()
const pickTemplateMtimes = new Map<string, number>()
let pickTemplatesDirBroken = false

// Dev-only diagnostic sink for rejected pick-slot crops (see MlWorkerInitRequest)
let rejectedCropsDir: string | null = null
let rejectedCropsDirReady = false

// Dev-only sink for POOL crops the classifier rejected (below its gate)
let lowConfCropsDir: string | null = null
let lowConfCropsDirReady = false

// Model-tile reference library (userData/model-tiles/<hero>/<n>.png). Template
// name = hero internal name (many variants per hero: 125 heroes x 24 = ~3000
// files). That size makes it UNLIKE the pick templates: decoding it lazily
// inside a scan blew the 10s scan watchdog (2026-08-19), and stat'ing 3000
// files per scan is not free either. So: the library is loaded at worker INIT
// (off the scan path, in the background) and re-stat'ed at most every
// MODEL_TILE_REFRESH_INTERVAL_MS during scans. It gets DELETED and regathered
// as a workflow (bad gather runs) — vanished files are pruned on refresh and a
// missing directory is just an empty library, never a latched failure.
let modelTilesDir: string | null = null
const modelTileTemplates = new Map<string, IconTemplate>() // key: hero/file
const modelTileMtimes = new Map<string, number>()
let modelTilesLastRefreshMs = 0
let modelTilesInitialLoad: Promise<void> | null = null
const MODEL_TILE_REFRESH_INTERVAL_MS = 30_000

/** Refresh unless refreshed recently; never blocks a scan on the initial load. */
async function getModelTileTemplates(): Promise<IconTemplate[]> {
  if (modelTilesInitialLoad !== null) {
    // Initial load still in flight — scan proceeds with whatever is loaded
    return [...modelTileTemplates.values()]
  }
  if (Date.now() - modelTilesLastRefreshMs >= MODEL_TILE_REFRESH_INTERVAL_MS) {
    await refreshModelTileTemplates()
  }
  return [...modelTileTemplates.values()]
}

async function refreshModelTileTemplates(): Promise<IconTemplate[]> {
  modelTilesLastRefreshMs = Date.now()
  if (modelTilesDir === null) return []
  let heroes: string[]
  try {
    heroes = await readdir(modelTilesDir)
  } catch {
    // Library absent (not gathered yet, or wiped for a regather)
    modelTileTemplates.clear()
    modelTileMtimes.clear()
    return []
  }
  const seen = new Set<string>()
  for (const hero of heroes) {
    let files: string[]
    try {
      files = await readdir(join(modelTilesDir, hero))
    } catch {
      continue // not a directory / unreadable — skip
    }
    for (const file of files) {
      if (!file.endsWith('.png')) continue
      const key = `${hero}/${file}`
      seen.add(key)
      const filePath = join(modelTilesDir, hero, file)
      try {
        const { mtimeMs } = await stat(filePath)
        if (modelTileMtimes.get(key) === mtimeMs) continue
        const vec = await loadIconVector(filePath, MODEL_TILE_COMPARE_SIZE)
        modelTileTemplates.set(key, makeIconTemplate(hero, vec))
        modelTileMtimes.set(key, mtimeMs)
      } catch {
        // Unstattable/undecodable file — retried next scan
      }
    }
  }
  for (const key of [...modelTileTemplates.keys()]) {
    if (!seen.has(key)) {
      modelTileTemplates.delete(key)
      modelTileMtimes.delete(key)
    }
  }
  return [...modelTileTemplates.values()]
}

async function refreshPickTemplates(): Promise<IconTemplate[]> {
  if (pickIconsDir === null || pickTemplatesDirBroken) return []
  let files: string[]
  try {
    files = await readdir(pickIconsDir)
  } catch {
    // Missing/unreadable icon cache — classifier fallback for this session
    pickTemplatesDirBroken = true
    return []
  }
  for (const file of files) {
    if (!file.endsWith('.png')) continue
    const name = file.slice(0, -4)
    const filePath = join(pickIconsDir, file)
    try {
      const { mtimeMs } = await stat(filePath)
      if (pickTemplateMtimes.get(name) === mtimeMs) continue
      const vec = await loadIconVector(filePath, PICK_TEMPLATE_COMPARE_SIZE)
      pickTemplates.set(name, makeIconTemplate(name, vec))
      pickTemplateMtimes.set(name, mtimeMs)
    } catch {
      // Unstattable/undecodable file — skip; retried next scan (mtime unrecorded)
    }
  }
  return [...pickTemplates.values()]
}

parentPort.on('message', async (message: MlWorkerRequest) => {
  try {
    switch (message.type) {
      case 'init':
        await handleInit(message.payload)
        break
      case 'scan':
        await handleScan(message.payload)
        break
      case 'dispose':
        await classifier.dispose()
        break
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const response: MlWorkerErrorResponse = {
      status: 'error',
      error: { message: err.message, stack: err.stack },
    }
    parentPort!.postMessage(response)
  }
})

async function handleInit(payload: {
  modelPath: string
  classNamesPath: string
  useDirectML: boolean
  pickIconsDir?: string
  rejectedCropsDir?: string
  lowConfCropsDir?: string
  modelTilesDir?: string
}): Promise<void> {
  try {
    pickIconsDir = payload.pickIconsDir ?? null
    rejectedCropsDir = payload.rejectedCropsDir ?? null
    lowConfCropsDir = payload.lowConfCropsDir ?? null
    modelTilesDir = payload.modelTilesDir ?? null
    // Kick off the (large) model-tile library load in the background — the
    // ready response must not wait for ~3000 PNG decodes, and scans that
    // arrive before it finishes simply match against the partial set.
    modelTilesInitialLoad = refreshModelTileTemplates()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        modelTilesInitialLoad = null
      })
    await classifier.initialize(payload)
    const response: MlWorkerReadyResponse = {
      status: 'ready',
      executionProvider: classifier.getExecutionProvider(),
    }
    parentPort!.postMessage(response)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    const response: MlWorkerErrorResponse = {
      status: 'error',
      type: 'init-error',
      error: { message: err.message, stack: err.stack },
    }
    parentPort!.postMessage(response)
  }
}

async function handleScan(payload: {
  screenshotBuffer: ArrayBuffer
  screenshotWidth: number
  screenshotHeight: number
  layout: ResolutionLayout
  confidenceThreshold: number
  isInitialScan: boolean
  activeClassNames?: string[]
  heroOrders?: number[]
  pickCandidates?: PickCandidates
  retryPoolSlots?: SlotCoordinate[]
}): Promise<void> {
  if (!classifier.isReady()) {
    throw new Error('ML Worker not initialized')
  }

  const {
    screenshotBuffer,
    screenshotWidth,
    screenshotHeight,
    layout: coords,
    confidenceThreshold,
    isInitialScan,
    activeClassNames,
    heroOrders,
    pickCandidates,
    retryPoolSlots,
  } = payload
  // The buffer arrives as a transferred RAW RGB bitmap — no decode step;
  // every slot crop reads from it directly.
  const screenshot: DecodedScreenshot = {
    data: Buffer.from(screenshotBuffer),
    width: screenshotWidth,
    height: screenshotHeight,
  }

  const activeSet =
    activeClassNames && activeClassNames.length > 0
      ? new Set(activeClassNames)
      : undefined

  let results: InitialScanResults | ScanResult[]

  if (isInitialScan) {
    results = await performInitialScan(
      screenshot,
      coords,
      confidenceThreshold,
      activeSet,
    )
  } else {
    // heroOrders: undefined = all rows; [] = NO ability rows (model-tile-only
    // confirmation capture); non-empty = targeted player rows
    results = await performSelectedAbilitiesScan(
      screenshot,
      coords,
      confidenceThreshold,
      activeSet,
      heroOrders ? new Set(heroOrders) : undefined,
      pickCandidates
        ? {
            standard: new Set(pickCandidates.standard),
            ultimates: new Set(pickCandidates.ultimates),
          }
        : undefined,
    )
  }

  // Re-read pool slots that previously came back Unknown (see core/domain/
  // pool-retry.ts). Cheap: a handful of slots, and only while any remain.
  let poolRetryResults: ScanResult[] | undefined
  if (!isInitialScan && retryPoolSlots && retryPoolSlots.length > 0) {
    poolRetryResults = await retryUnknownPoolSlots(
      screenshot,
      retryPoolSlots,
      confidenceThreshold,
      activeSet,
    )
  }

  // Model portrait tiles for picked-model diff detection — captured every scan
  // (~10ms for 12 small crops from the already-decoded bitmap)
  const modelTiles = await captureModelTiles(screenshot, coords)
  // Player cards for GSI slot <-> scan row correlation — same cost profile
  const playerCardTiles = await capturePlayerCardTiles(screenshot, coords)
  // Hero-name strips for main-process OCR (upscaled grayscale PNGs)
  const nameStrips = await captureNameStrips(screenshot, coords)
  // Model-tile identification against the reference library (no-op until the
  // gather script's models mode populates it) — MUST run before the tiles'
  // buffers are transferred away below
  const modelTileMatches = await matchModelTiles(modelTiles)

  const response: MlWorkerSuccessResponse = {
    status: 'success',
    results,
    isInitialScan,
    modelTiles,
    playerCardTiles,
    nameStrips,
    poolRetryResults,
    modelTileMatches,
  }
  parentPort!.postMessage(response, [
    ...(modelTiles?.map((t) => t.tile) ?? []),
    ...(playerCardTiles?.map((t) => t.tile) ?? []),
    ...(nameStrips?.map((s) => s.png) ?? []),
  ])
}

/** Crop + normalize the 12 model portrait tiles; undefined when unavailable. */
async function captureModelTiles(
  screenshot: DecodedScreenshot,
  coords: ResolutionLayout,
): Promise<{ heroOrder: number; tile: ArrayBuffer }[] | undefined> {
  const modelCoords = coords.models_coords
  if (!modelCoords || modelCoords.length === 0) return undefined

  const tiles: { heroOrder: number; tile: ArrayBuffer }[] = []
  for (const c of modelCoords) {
    if (c.width <= 0 || c.height <= 0) continue
    try {
      const raw = await cropTile(screenshot, c, MODEL_TILE_COMPARE_SIZE)
      tiles.push({
        heroOrder: c.hero_order,
        tile: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      })
    } catch {
      // Out-of-bounds crop (layout drift) — skip this tile
    }
  }
  return tiles.length > 0 ? tiles : undefined
}

/**
 * Crop + normalize the 10 player-card regions. heroes_coords entries carry only
 * x/y — the shared card dimensions live in heroes_params.
 */
async function capturePlayerCardTiles(
  screenshot: DecodedScreenshot,
  coords: ResolutionLayout,
): Promise<{ row: number; tile: ArrayBuffer }[] | undefined> {
  const heroCoords = coords.heroes_coords
  const params = coords.heroes_params
  if (!heroCoords || heroCoords.length === 0) return undefined
  if (!params || params.width <= 0 || params.height <= 0) return undefined

  const tiles: { row: number; tile: ArrayBuffer }[] = []
  for (const c of heroCoords) {
    try {
      const raw = await cropTile(
        screenshot,
        { ...c, width: params.width, height: params.height },
        PLAYER_CARD_COMPARE_SIZE,
      )
      tiles.push({
        row: c.hero_order,
        tile: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      })
    } catch {
      // Out-of-bounds crop (layout drift) — skip this card
    }
  }
  return tiles.length > 0 ? tiles : undefined
}

/**
 * Crops the hero-name strip (upper half) of each player card as an upscaled
 * grayscale PNG for OCR in the main process. The upper HALF (not a fixed
 * line): the highlighted/active card expands and shifts its name down.
 */
async function captureNameStrips(
  screenshot: DecodedScreenshot,
  coords: ResolutionLayout,
): Promise<{ row: number; png: ArrayBuffer }[] | undefined> {
  const heroCoords = coords.heroes_coords
  const params = coords.heroes_params
  if (!heroCoords || heroCoords.length === 0) return undefined
  if (!params || params.width <= 0 || params.height <= 0) return undefined

  const strips: { row: number; png: ArrayBuffer }[] = []
  for (const c of heroCoords) {
    try {
      const png = await cropRegionPng(
        screenshot,
        {
          x: c.x,
          y: c.y,
          width: params.width,
          height: Math.round(params.height * OCR_NAME_STRIP_HEIGHT_RATIO),
        },
        OCR_STRIP_TARGET_WIDTH,
      )
      strips.push({
        row: c.hero_order,
        png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      })
    } catch {
      // Out-of-bounds crop (layout drift) — skip this card
    }
  }
  return strips.length > 0 ? strips : undefined
}

/**
 * Identifies the 12 model tiles against the reference-tile library. Reuses the
 * raw tiles already captured for diff detection — no extra cropping.
 */
async function matchModelTiles(
  modelTiles: { heroOrder: number; tile: ArrayBuffer }[] | undefined,
): Promise<MlWorkerSuccessResponse['modelTileMatches']> {
  if (!modelTiles || modelTiles.length === 0) return undefined
  const templates = await getModelTileTemplates()
  if (templates.length === 0) return undefined
  return modelTiles.map((t) => ({
    heroOrder: t.heroOrder,
    ...matchModelTile(new Uint8Array(t.tile), templates),
  }))
}

// @DEV-GUIDE: Initial scan processes ultimate + standard ability slots in parallel, then
// extracts hero-defining abilities (ability_order === 2) from standard results.
// These hero-defining abilities are used by the scan processor to identify which hero each
// draft slot belongs to (hero identification by their second ability).
async function performInitialScan(
  screenshot: DecodedScreenshot,
  coords: ResolutionLayout,
  confidenceThreshold: number,
  activeClassNames?: ReadonlySet<string>,
): Promise<InitialScanResults> {
  const [ultimates, standard] = await Promise.all([
    identifySlots(
      coords.ultimate_slots_coords,
      screenshot,
      confidenceThreshold,
      activeClassNames,
    ),
    identifySlots(
      coords.standard_slots_coords,
      screenshot,
      confidenceThreshold,
      activeClassNames,
    ),
  ])

  const heroDefiningAbilities = standard.filter(
    (slot) => slot.ability_order === 2,
  )

  return {
    ultimates,
    standard,
    selectedAbilities: [],
    heroDefiningAbilities,
  }
}

async function performSelectedAbilitiesScan(
  screenshot: DecodedScreenshot,
  coords: ResolutionLayout,
  confidenceThreshold: number,
  activeClassNames?: ReadonlySet<string>,
  heroOrders?: ReadonlySet<number>,
  pickCandidates?: PickCandidateSets,
): Promise<ScanResult[]> {
  const selectedCoords = coords.selected_abilities_coords
  if (!selectedCoords || selectedCoords.length === 0) return []

  const params = coords.selected_abilities_params
  // heroOrders restricts a targeted rescan to specific player rows; the
  // partial results merge into the baseline downstream (scan-processor).
  const relevantCoords = heroOrders
    ? selectedCoords.filter((c) => heroOrders.has(c.hero_order))
    : selectedCoords
  const slotsToScan: SlotCoordinate[] = relevantCoords.map((c) => ({
    ...c,
    width: params?.width ?? c.width,
    height: params?.height ?? c.height,
  }))

  const templates = await refreshPickTemplates()
  if (templates.length === 0) {
    // No icon cache — classifier fallback (pre-template-matching behavior)
    return identifySlots(
      slotsToScan,
      screenshot,
      confidenceThreshold,
      activeClassNames,
    )
  }

  return matchPickSlots(slotsToScan, screenshot, templates, pickCandidates)
}

/**
 * Re-classifies pool slots that read Unknown earlier. A slot whose ability has
 * since been drafted now shows an EMPTY box — classifying that invites a
 * confident misread (the classifier argmaxes junk on empty boxes), so anything
 * near-uniform is skipped and simply stays unresolved.
 */
async function retryUnknownPoolSlots(
  screenshot: DecodedScreenshot,
  slots: SlotCoordinate[],
  confidenceThreshold: number,
  activeClassNames?: ReadonlySet<string>,
): Promise<ScanResult[]> {
  const live: SlotCoordinate[] = []
  for (const slot of slots) {
    if (slot.width <= 0 || slot.height <= 0) continue
    try {
      const raw = await cropTile(screenshot, slot, PICK_TEMPLATE_COMPARE_SIZE)
      const vec = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      if (computePixelStats(vec).std < PICK_TEMPLATE_EMPTY_STD) continue
      live.push(slot)
    } catch {
      // Out-of-bounds crop — skip
    }
  }
  if (live.length === 0) return []
  return identifySlots(live, screenshot, confidenceThreshold, activeClassNames)
}

/**
 * Dev-only diagnostic: persists a POOL crop the classifier rejected. The pool
 * is read once per draft, so these are the only evidence of why a slot failed.
 * Never throws.
 */
async function dumpLowConfidencePoolCrop(
  screenshot: DecodedScreenshot,
  slot: SlotCoordinate,
  confidence: number,
): Promise<void> {
  if (lowConfCropsDir === null) return
  try {
    if (!lowConfCropsDirReady) {
      await mkdir(lowConfCropsDir, { recursive: true })
      lowConfCropsDirReady = true
    }
    const raw = await cropTile(screenshot, slot, MODEL_INPUT_SIZE)
    const file = [
      `h${slot.hero_order}`,
      `a${slot.ability_order ?? 'x'}`,
      slot.is_ultimate ? 'ult' : 'std',
      `x${slot.x}y${slot.y}`,
      confidence.toFixed(3),
    ].join('_')
    await saveRawVectorPng(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      MODEL_INPUT_SIZE,
      join(lowConfCropsDir, `${file}.png`),
    )
  } catch {
    // Diagnostics must never break a scan
  }
}

/** Pick-slot candidate names split by pick-box type (see PickCandidates). */
interface PickCandidateSets {
  standard: ReadonlySet<string>
  ultimates: ReadonlySet<string>
}

/**
 * Dev-only diagnostic: persists a rejected pick-slot crop (the exact
 * compare-size pixels the matcher scored) as a PNG. Filename encodes the slot
 * position and verdict; identical repeat rejections overwrite the same file,
 * so a stuck slot doesn't flood the directory. Never throws — diagnostics
 * must not break a scan.
 */
async function dumpRejectedCrop(
  crop: Buffer,
  slot: SlotCoordinate,
  match: PickMatchResult,
): Promise<void> {
  if (rejectedCropsDir === null) return
  try {
    if (!rejectedCropsDirReady) {
      await mkdir(rejectedCropsDir, { recursive: true })
      rejectedCropsDirReady = true
    }
    const file = [
      `h${slot.hero_order}`,
      `x${slot.x}y${slot.y}`,
      slot.is_ultimate ? 'ult' : 'std',
      match.bestName ?? 'none',
      match.score.toFixed(3),
      `m${match.margin === null ? 'none' : match.margin.toFixed(3)}`,
    ].join('_')
    await saveRawVectorPng(
      new Uint8Array(crop.buffer, crop.byteOffset, crop.byteLength),
      PICK_TEMPLATE_COMPARE_SIZE,
      join(rejectedCropsDir, `${file}.png`),
    )
  } catch {
    // Diagnostic-only path — a full disk or locked file must not fail the scan
  }
}

/** Template-matches pick-box slots against the official-icon templates. */
async function matchPickSlots(
  slots: SlotCoordinate[],
  screenshot: DecodedScreenshot,
  templates: IconTemplate[],
  candidates?: PickCandidateSets,
): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  for (const slot of slots) {
    let result = makeDefaultResult(slot)
    if (slot.width > 0 && slot.height > 0) {
      // Shave the pick box's border ring + rounded corners — off-distribution
      // pixels for icons and classifier alike (see PICK_TEMPLATE_CROP_INSET_RATIO)
      const inset = Math.round(slot.width * PICK_TEMPLATE_CROP_INSET_RATIO)
      const insetSlot = {
        ...slot,
        x: slot.x + inset,
        y: slot.y + inset,
        width: slot.width - inset * 2,
        height: slot.height - inset * 2,
      }
      try {
        const crop = await cropTile(
          screenshot,
          insetSlot,
          PICK_TEMPLATE_COMPARE_SIZE,
        )
        // An ultimate box can only hold a pool ultimate, a standard box only
        // a pool standard ability — scope to the matching candidate set, with
        // an unrestricted high-confidence fallback so an ability missing from
        // the pool scan does not make its pick box permanently unmatchable.
        const match = matchPickSlotScoped(
          new Uint8Array(crop.buffer, crop.byteOffset, crop.byteLength),
          templates,
          slot.is_ultimate ? candidates?.ultimates : candidates?.standard,
          PICK_TEMPLATE_FALLBACK_MIN_NCC,
  PICK_TEMPLATE_EMPTY_STD,
  MODEL_INPUT_SIZE,
        )
        result = {
          ...result,
          name: match.name,
          // NCC in [-1,1]; clamp so downstream confidence semantics (>= 0) hold
          confidence: Math.max(0, match.score),
        }
        if (match.name === null && !match.isEmpty) {
          result.rejectedMatch = {
            bestName: match.bestName,
            secondName: match.secondName,
            margin: match.margin,
          }
          await dumpRejectedCrop(crop, slot, match)
        }
      } catch {
        // Out-of-bounds crop (layout drift) — keep the default null result
      }
    }
    results.push(result)
  }
  return results
}

// @DEV-GUIDE: Core ML pipeline for a batch of slots. preprocessBatch crops each slot from the
// decoded screenshot bitmap and resizes to 96x96 (model input size). validIndices tracks which
// slots had enough image data to process. Slots that failed preprocessing get default (null) results.
async function identifySlots(
  slots: SlotCoordinate[],
  screenshot: DecodedScreenshot,
  confidenceThreshold: number,
  activeClassNames?: ReadonlySet<string>,
): Promise<ScanResult[]> {
  if (slots.length === 0) return []

  const { batch, validIndices } = await preprocessBatch(
    screenshot,
    slots,
  )
  if (validIndices.length === 0) return slots.map(makeDefaultResult)

  const classifierResults: ClassifierResult[] = await classifier.classify(
    batch,
    validIndices.length,
    confidenceThreshold,
    activeClassNames,
  )

  // Initialize all results to defaults
  const results: ScanResult[] = slots.map(makeDefaultResult)

  // Fill in successful predictions
  for (let i = 0; i < classifierResults.length; i++) {
    const originalIndex = validIndices[i]
    const slot = slots[originalIndex]
    const cr = classifierResults[i]
    results[originalIndex] = {
      name: cr.name,
      confidence: cr.confidence,
      hero_order: slot.hero_order,
      ability_order: slot.ability_order ?? 0,
      is_ultimate: slot.is_ultimate ?? false,
      coord: {
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        hero_order: slot.hero_order,
      },
    }
    // Below the confidence gate: the slot renders Unknown. Dump the crop so
    // the reason is inspectable (dev builds only; no-op otherwise).
    if (cr.name === null) {
      await dumpLowConfidencePoolCrop(screenshot, slot, cr.confidence)
    }
  }

  return results
}

function makeDefaultResult(slot: SlotCoordinate): ScanResult {
  return {
    name: null,
    confidence: 0,
    hero_order: slot.hero_order,
    ability_order: slot.ability_order ?? 0,
    is_ultimate: slot.is_ultimate ?? false,
    coord: {
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      hero_order: slot.hero_order,
    },
  }
}

// Catch unhandled rejections to prevent silent worker death
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  parentPort?.postMessage({
    status: 'error',
    error: { message: `Unhandled rejection: ${message}` },
  } satisfies MlWorkerErrorResponse)
})
