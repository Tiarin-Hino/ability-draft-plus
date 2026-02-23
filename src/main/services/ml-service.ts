import { Worker } from 'worker_threads'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log/main'
import type {
  MlWorkerRequest,
  MlWorkerResponse,
  MlWorkerReadyResponse,
  MlWorkerSuccessResponse,
  MlWorkerErrorResponse,
} from '@shared/types/ml'
import type { ResolutionLayout } from '@shared/types'
import {
  ML_WORKER_MAX_RESTART_ATTEMPTS,
  ML_WORKER_RESTART_COOLDOWN,
  ML_WORKER_RESTART_RESET_TIME,
  ML_MODEL_INIT_TIMEOUT,
  ML_CONFIDENCE_THRESHOLD,
  ML_PREDICTION_TIMEOUT,
} from '@shared/constants/thresholds'

// @DEV-GUIDE: Manages the ML Worker thread that runs ONNX inference for ability classification.
// The worker runs in a separate thread (Node.js worker_threads) to avoid blocking the main process.
//
// Communication: Main sends typed messages to worker via postMessage(), worker replies with
// typed responses. Each operation (init, scan, dispose) uses promise-based request/response.
//
// The worker loads an INT8-quantized MobileNetV2 ONNX model (524 ability classes).
// Input: [batch, 96, 96, 3] float32 images. Confidence threshold: 0.9.
//
// Auto-restart: Up to 3 attempts with 5s cooldown. Counter resets after 60s of stability.
// Init timeout: 30s. Scan timeout: 10s (watchdog rejects promise if worker doesn't respond).
// Screenshot buffer is transferred (not copied) via ArrayBuffer transfer for zero-copy perf.

const logger = log.scope('ml-service')

export interface MlService {
  initialize(): Promise<void>
  scan(
    screenshotBuffer: Buffer,
    layout: ResolutionLayout,
    isInitialScan: boolean,
  ): Promise<MlWorkerSuccessResponse>
  terminate(): Promise<void>
  isReady(): boolean
}

export function createMlService(): MlService {
  let worker: Worker | null = null
  let ready = false
  let restartCount = 0
  let lastRestartTime = 0

  let initResolve: (() => void) | null = null
  let initReject: ((err: Error) => void) | null = null
  let scanResolve: ((response: MlWorkerSuccessResponse) => void) | null = null
  let scanReject: ((err: Error) => void) | null = null

  function getWorkerPath(): string {
    return join(__dirname, 'workers', 'ml-worker.js')
  }

  function getModelPath(): string {
    const basePath = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    return join(basePath, 'model', 'ability_classifier_int8.onnx')
  }

  function getClassNamesPath(): string {
    const basePath = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    return join(basePath, 'model', 'class_names.json')
  }

  // @DEV-GUIDE: Single message router for all worker responses. Uses status field to distinguish
  // between init-ready, scan-success, and errors. Only one pending resolve/reject at a time
  // per operation type (init vs scan), cleared immediately upon receipt to prevent double-resolve.
  function handleMessage(message: MlWorkerResponse): void {
    if (message.status === 'ready') {
      ready = true
      const resp = message as MlWorkerReadyResponse
      logger.info('ML Worker ready', {
        executionProvider: resp.executionProvider,
      })
      initResolve?.()
      initResolve = null
      initReject = null
    } else if (message.status === 'success') {
      scanResolve?.(message as MlWorkerSuccessResponse)
      scanResolve = null
      scanReject = null
    } else if (message.status === 'error') {
      const errResponse = message as MlWorkerErrorResponse
      const error = new Error(errResponse.error.message)
      if (errResponse.type === 'init-error') {
        initReject?.(error)
        initResolve = null
        initReject = null
      } else {
        scanReject?.(error)
        scanResolve = null
        scanReject = null
      }
    }
  }

  async function initialize(): Promise<void> {
    if (worker && ready) {
      logger.warn('ML Worker already initialized')
      return
    }

    const workerPath = getWorkerPath()
    logger.info('Spawning ML Worker', { path: workerPath })

    return new Promise<void>((resolve, reject) => {
      initResolve = resolve
      initReject = reject

      worker = new Worker(workerPath)

      worker.on('message', handleMessage)

      worker.on('error', (err) => {
        logger.error('ML Worker error', { error: err.message })
        if (initReject) {
          initReject(err)
          initResolve = null
          initReject = null
        }
        if (scanReject) {
          scanReject(err)
          scanResolve = null
          scanReject = null
        }
      })

      worker.on('exit', (code) => {
        logger.info('ML Worker exited', { code })
        ready = false
        worker = null
        if (code !== 0) {
          attemptRestart(new Error(`Worker exited with code ${code}`))
        }
      })

      const initMessage: MlWorkerRequest = {
        type: 'init',
        payload: {
          modelPath: getModelPath(),
          classNamesPath: getClassNamesPath(),
          useDirectML: false,
        },
      }
      worker.postMessage(initMessage)

      // Init timeout
      setTimeout(() => {
        if (initReject) {
          initReject(new Error('ML Worker initialization timed out'))
          initResolve = null
          initReject = null
        }
      }, ML_MODEL_INIT_TIMEOUT)
    })
  }

  async function scan(
    screenshotBuffer: Buffer,
    layout: ResolutionLayout,
    isInitialScan: boolean,
  ): Promise<MlWorkerSuccessResponse> {
    if (!worker || !ready) {
      throw new Error('ML Worker not ready')
    }

    return new Promise<MlWorkerSuccessResponse>((resolve, reject) => {
      // Scan timeout watchdog
      const timer = setTimeout(() => {
        if (scanReject) {
          const err = new Error(`ML scan timed out after ${ML_PREDICTION_TIMEOUT}ms`)
          logger.error(err.message)
          scanReject(err)
          scanResolve = null
          scanReject = null
        }
      }, ML_PREDICTION_TIMEOUT)

      scanResolve = (result) => {
        clearTimeout(timer)
        resolve(result)
      }
      scanReject = (err) => {
        clearTimeout(timer)
        reject(err)
      }

      // Create a copy of the ArrayBuffer for transfer
      const bufferCopy = screenshotBuffer.buffer.slice(
        screenshotBuffer.byteOffset,
        screenshotBuffer.byteOffset + screenshotBuffer.byteLength,
      )

      const message: MlWorkerRequest = {
        type: 'scan',
        payload: {
          screenshotBuffer: bufferCopy,
          layout,
          confidenceThreshold: ML_CONFIDENCE_THRESHOLD,
          isInitialScan,
        },
      }

      worker!.postMessage(message, [bufferCopy])
    })
  }

  // @DEV-GUIDE: Auto-restart on unexpected worker exit. Resets attempt counter if the worker
  // has been stable for ML_WORKER_RESTART_RESET_TIME (60s). After max attempts, gives up
  // permanently. The 5s cooldown prevents restart storms.
  async function attemptRestart(error: Error): Promise<boolean> {
    const now = Date.now()
    if (now - lastRestartTime > ML_WORKER_RESTART_RESET_TIME) {
      restartCount = 0
    }

    if (restartCount >= ML_WORKER_MAX_RESTART_ATTEMPTS) {
      logger.error('ML Worker failed permanently', {
        attempts: restartCount,
      })
      return false
    }

    restartCount++
    lastRestartTime = now
    logger.warn(
      `Restarting ML Worker (${restartCount}/${ML_WORKER_MAX_RESTART_ATTEMPTS})`,
      { reason: error.message },
    )

    await new Promise((r) => setTimeout(r, ML_WORKER_RESTART_COOLDOWN))

    try {
      await terminate()
      await initialize()
      logger.info('ML Worker restarted successfully')
      return true
    } catch (restartError) {
      logger.error('ML Worker restart failed', {
        error:
          restartError instanceof Error
            ? restartError.message
            : String(restartError),
      })
      return false
    }
  }

  async function terminate(): Promise<void> {
    if (worker) {
      try {
        worker.postMessage({ type: 'dispose' } satisfies MlWorkerRequest)
      } catch {
        // Worker may already be dead
      }
      await worker.terminate()
      worker = null
      ready = false
      logger.info('ML Worker terminated')
    }
  }

  return {
    initialize,
    scan,
    terminate,
    isReady: () => ready,
  }
}
