import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app/path',
  },
}))

// Mock electron-log
vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// Create a mock worker that extends EventEmitter
class MockWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn().mockResolvedValue(0)
}

let mockWorkerInstance: MockWorker

vi.mock('worker_threads', () => {
  // Must use a regular function so it can be called with `new`
  function WorkerConstructor(this: MockWorker) {
    mockWorkerInstance = new MockWorker()
    return mockWorkerInstance
  }
  return { Worker: WorkerConstructor }
})

import { createMlService } from '../../../../src/main/services/ml-service'

describe('MlService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Clear any pending timers to prevent rejections leaking between tests
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('initialize', () => {
    it('spawns worker and waits for ready response', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      // Simulate worker sending ready
      await vi.advanceTimersByTimeAsync(0)
      mockWorkerInstance.emit('message', {
        status: 'ready',
        executionProvider: 'cpu',
      })

      await initPromise
      expect(service.isReady()).toBe(true)
    })

    it('sends init message with model paths', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      await vi.advanceTimersByTimeAsync(0)
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'init',
        payload: {
          modelPath: expect.stringContaining('ability_classifier_int8.onnx'),
          classNamesPath: expect.stringContaining('class_names.json'),
          useDirectML: false,
        },
      })

      mockWorkerInstance.emit('message', {
        status: 'ready',
        executionProvider: 'cpu',
      })
      await initPromise
    })

    it('rejects on init error', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      await vi.advanceTimersByTimeAsync(0)
      mockWorkerInstance.emit('message', {
        status: 'error',
        type: 'init-error',
        error: { message: 'Model not found' },
      })

      await expect(initPromise).rejects.toThrow('Model not found')
      expect(service.isReady()).toBe(false)
    })

    it('rejects on worker error event', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      await vi.advanceTimersByTimeAsync(0)
      mockWorkerInstance.emit('error', new Error('Worker crashed'))

      await expect(initPromise).rejects.toThrow('Worker crashed')
    })

    it('rejects on timeout', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      // Attach rejection handler before advancing timers to prevent unhandled rejection warning
      const caughtError = initPromise.catch((e: Error) => e)

      // Advance past the 30s timeout
      await vi.advanceTimersByTimeAsync(31_000)

      const error = await caughtError
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('timed out')
    })

    it('does not re-initialize when already ready', async () => {
      const service = createMlService()
      const initPromise = service.initialize()

      await vi.advanceTimersByTimeAsync(0)
      const firstWorker = mockWorkerInstance
      mockWorkerInstance.emit('message', {
        status: 'ready',
        executionProvider: 'cpu',
      })
      await initPromise

      // Second init should return immediately without creating new worker
      await service.initialize()
      expect(mockWorkerInstance).toBe(firstWorker) // Same worker instance
      expect(service.isReady()).toBe(true)
    })
  })

  describe('scan', () => {
    async function createReadyService() {
      const service = createMlService()
      const initPromise = service.initialize()
      await vi.advanceTimersByTimeAsync(0)
      mockWorkerInstance.emit('message', {
        status: 'ready',
        executionProvider: 'cpu',
      })
      await initPromise
      return service
    }

    it('sends scan message and returns results', async () => {
      const service = await createReadyService()

      const scanPromise = service.scan(
        Buffer.from('screenshot'),
        {} as never,
        true,
      )

      // Worker should receive scan message
      expect(mockWorkerInstance.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'scan',
          payload: expect.objectContaining({
            isInitialScan: true,
            confidenceThreshold: 0.9,
          }),
        }),
        expect.any(Array), // transferables
      )

      // Simulate success response
      const mockResults = {
        ultimates: [],
        standard: [],
        selectedAbilities: [],
        heroDefiningAbilities: [],
      }
      mockWorkerInstance.emit('message', {
        status: 'success',
        results: mockResults,
        isInitialScan: true,
      })

      const response = await scanPromise
      expect(response.status).toBe('success')
      expect(response.results).toEqual(mockResults)
      expect(response.isInitialScan).toBe(true)
    })

    it('rejects on scan error', async () => {
      const service = await createReadyService()

      const scanPromise = service.scan(
        Buffer.from('screenshot'),
        {} as never,
        true,
      )

      mockWorkerInstance.emit('message', {
        status: 'error',
        error: { message: 'Inference failed' },
      })

      await expect(scanPromise).rejects.toThrow('Inference failed')
    })

    it('throws if worker not ready', async () => {
      const service = createMlService()
      await expect(
        service.scan(
          Buffer.from('screenshot'),
          {} as never,
          true,
        ),
      ).rejects.toThrow('ML Worker not ready')
    })
  })

  describe('terminate', () => {
    it('terminates the worker and marks as not ready', async () => {
      const service = createMlService()
      const initPromise = service.initialize()
      await vi.advanceTimersByTimeAsync(0)
      mockWorkerInstance.emit('message', {
        status: 'ready',
        executionProvider: 'cpu',
      })
      await initPromise

      await service.terminate()

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'dispose',
      })
      expect(mockWorkerInstance.terminate).toHaveBeenCalled()
      expect(service.isReady()).toBe(false)
    })

    it('is safe to call when not initialized', async () => {
      const service = createMlService()
      await expect(service.terminate()).resolves.not.toThrow()
    })
  })
})
