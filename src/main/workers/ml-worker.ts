import { parentPort } from 'worker_threads'
import type {
  MlWorkerRequest,
  MlWorkerReadyResponse,
  MlWorkerSuccessResponse,
  MlWorkerErrorResponse,
  InitialScanResults,
} from '@shared/types/ml'
import type { ScanResult, SlotCoordinate, ResolutionLayout } from '@shared/types'
import { createOnnxClassifier } from '@core/ml/onnx-classifier'
import { decodeScreenshot, preprocessBatch } from '@core/ml/preprocessing'
import type { DecodedScreenshot } from '@core/ml/preprocessing'
import type { ClassifierResult } from '@core/ml/classifier'

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
// Scan pipeline: receive screenshot buffer → decode PNG ONCE to raw RGB → extract slot
// images from the decoded bitmap (sharp crop+resize to 96x96) → convert to float32
// (raw 0-255 — the model's internal Rescaling layer maps to [-1,1]) → ONNX batch
// inference → filter by confidence → return ScanResult[]. The single decode matters:
// cropping from the PNG buffer re-decoded the full screenshot per slot (~1.1s/scan
// at 1440p vs ~110ms).
//
// For initial scan: processes ultimate + standard slots, extracts heroDefiningAbilities (ability_order===2).
// For rescan: processes only the selected-ability slots.

if (!parentPort) {
  throw new Error('ml-worker must run as a worker thread')
}

const classifier = createOnnxClassifier()

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
}): Promise<void> {
  try {
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
  layout: ResolutionLayout
  confidenceThreshold: number
  isInitialScan: boolean
  activeClassNames?: string[]
}): Promise<void> {
  if (!classifier.isReady()) {
    throw new Error('ML Worker not initialized')
  }

  const {
    screenshotBuffer,
    layout: coords,
    confidenceThreshold,
    isInitialScan,
    activeClassNames,
  } = payload
  // Decode the PNG once; every slot crop reads from this raw bitmap.
  const screenshot = await decodeScreenshot(Buffer.from(screenshotBuffer))

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
    results = await performSelectedAbilitiesScan(
      screenshot,
      coords,
      confidenceThreshold,
      activeSet,
    )
  }

  const response: MlWorkerSuccessResponse = {
    status: 'success',
    results,
    isInitialScan,
  }
  parentPort!.postMessage(response)
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
): Promise<ScanResult[]> {
  const selectedCoords = coords.selected_abilities_coords
  if (!selectedCoords || selectedCoords.length === 0) return []

  const params = coords.selected_abilities_params
  const slotsToScan: SlotCoordinate[] = selectedCoords.map((c) => ({
    ...c,
    width: params?.width ?? c.width,
    height: params?.height ?? c.height,
  }))

  return identifySlots(
    slotsToScan,
    screenshot,
    confidenceThreshold,
    activeClassNames,
  )
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
