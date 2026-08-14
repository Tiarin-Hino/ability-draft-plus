import { parentPort } from 'worker_threads'
import { readdir } from 'fs/promises'
import { join } from 'path'
import type {
  MlWorkerRequest,
  MlWorkerReadyResponse,
  MlWorkerSuccessResponse,
  MlWorkerErrorResponse,
  InitialScanResults,
} from '@shared/types/ml'
import type { ScanResult, SlotCoordinate, ResolutionLayout } from '@shared/types'
import { createOnnxClassifier } from '@core/ml/onnx-classifier'
import { preprocessBatch, cropTile, loadIconVector } from '@core/ml/preprocessing'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { ClassifierResult } from '@core/ml/classifier'
import { makeIconTemplate, matchPickSlot } from '@core/ml/template-matcher'
import type { IconTemplate } from '@core/ml/template-matcher'
import {
  MODEL_TILE_COMPARE_SIZE,
  PLAYER_CARD_COMPARE_SIZE,
  PICK_TEMPLATE_COMPARE_SIZE,
  PICK_TEMPLATE_CROP_INSET_RATIO,
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
// lazily on the first rescan and pick up newly cached icons via a per-scan readdir diff.
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
// pickIconsDir on the first selected-abilities scan; each later scan diffs the
// directory listing and loads only new files (the icon cache is append-only).
let pickIconsDir: string | null = null
const pickTemplates = new Map<string, IconTemplate>()
let pickTemplatesDirBroken = false

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
    if (pickTemplates.has(name)) continue
    try {
      const vec = await loadIconVector(
        join(pickIconsDir, file),
        PICK_TEMPLATE_COMPARE_SIZE,
      )
      pickTemplates.set(name, makeIconTemplate(name, vec))
    } catch {
      // Undecodable file — skip; the name stays eligible for a later retry
      // only if the cache rewrites it, which it never does. Acceptable.
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
}): Promise<void> {
  try {
    pickIconsDir = payload.pickIconsDir ?? null
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
  pickCandidateNames?: string[]
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
    pickCandidateNames,
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
      pickCandidateNames && pickCandidateNames.length > 0
        ? new Set(pickCandidateNames)
        : undefined,
    )
  }

  // Model portrait tiles for picked-model diff detection — captured every scan
  // (~10ms for 12 small crops from the already-decoded bitmap)
  const modelTiles = await captureModelTiles(screenshot, coords)
  // Player cards for GSI slot <-> scan row correlation — same cost profile
  const playerCardTiles = await capturePlayerCardTiles(screenshot, coords)

  const response: MlWorkerSuccessResponse = {
    status: 'success',
    results,
    isInitialScan,
    modelTiles,
    playerCardTiles,
  }
  parentPort!.postMessage(response, [
    ...(modelTiles?.map((t) => t.tile) ?? []),
    ...(playerCardTiles?.map((t) => t.tile) ?? []),
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
  pickCandidateNames?: ReadonlySet<string>,
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

  return matchPickSlots(slotsToScan, screenshot, templates, pickCandidateNames)
}

/** Template-matches pick-box slots against the official-icon templates. */
async function matchPickSlots(
  slots: SlotCoordinate[],
  screenshot: DecodedScreenshot,
  templates: IconTemplate[],
  candidateNames?: ReadonlySet<string>,
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
        const match = matchPickSlot(
          new Uint8Array(crop.buffer, crop.byteOffset, crop.byteLength),
          templates,
          candidateNames,
        )
        result = {
          ...result,
          name: match.name,
          // NCC in [-1,1]; clamp so downstream confidence semantics (>= 0) hold
          confidence: Math.max(0, match.score),
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
