import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock onnxruntime-node
const mockRun = vi.fn()
const mockRelease = vi.fn()
const mockCreate = vi.fn()

vi.mock('onnxruntime-node', () => {
  // Must use a function (not arrow) so it can be called with `new`
  function MockTensor(
    this: { type: string; data: unknown; dims: number[] },
    type: string,
    data: unknown,
    dims: number[],
  ) {
    this.type = type
    this.data = data
    this.dims = dims
  }
  return {
    InferenceSession: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
    Tensor: MockTensor,
  }
})

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

import { createOnnxClassifier } from '@core/ml/onnx-classifier'
import { readFile } from 'fs/promises'

const mockReadFile = vi.mocked(readFile)

function makeClassNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `ability_${i}`)
}

function makeOutputData(batchSize: number, numClasses: number, predictions: Array<{ index: number; confidence: number }>): Float32Array {
  const data = new Float32Array(batchSize * numClasses)
  for (let i = 0; i < predictions.length; i++) {
    const offset = i * numClasses
    // Fill with small values
    for (let j = 0; j < numClasses; j++) {
      data[offset + j] = 0.001
    }
    // Set the predicted class to the desired confidence
    data[offset + predictions[i].index] = predictions[i].confidence
  }
  return data
}

describe('OnnxClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCreate.mockResolvedValue({
      inputNames: ['input_for_inference'],
      outputNames: ['Identity'],
      run: mockRun,
      release: mockRelease,
    })

    // Default: warmup run returns empty output
    mockRun.mockResolvedValue({
      Identity: { data: new Float32Array(524) },
    })
  })

  describe('initialize', () => {
    it('loads class names and creates session', async () => {
      const classNames = makeClassNames(524)
      mockReadFile.mockResolvedValueOnce(JSON.stringify(classNames))

      const classifier = createOnnxClassifier()
      await classifier.initialize({
        modelPath: '/path/to/model.onnx',
        classNamesPath: '/path/to/class_names.json',
        useDirectML: false,
      })

      expect(mockReadFile).toHaveBeenCalledWith('/path/to/class_names.json', 'utf-8')
      expect(mockCreate).toHaveBeenCalledWith('/path/to/model.onnx', {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      })
      expect(classifier.isReady()).toBe(true)
    })

    it('uses DirectML provider when requested', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(makeClassNames(524)))

      const classifier = createOnnxClassifier()
      await classifier.initialize({
        modelPath: '/path/to/model.onnx',
        classNamesPath: '/path/to/class_names.json',
        useDirectML: true,
      })

      expect(mockCreate).toHaveBeenCalledWith('/path/to/model.onnx', {
        executionProviders: ['dml', 'cpu'],
        graphOptimizationLevel: 'all',
      })
    })

    it('throws if class names count is wrong', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(makeClassNames(100)))

      const classifier = createOnnxClassifier()
      await expect(
        classifier.initialize({
          modelPath: '/path/to/model.onnx',
          classNamesPath: '/path/to/class_names.json',
          useDirectML: false,
        }),
      ).rejects.toThrow('Expected 524 class names, got 100')
    })

    it('runs warmup inference during init', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(makeClassNames(524)))

      const classifier = createOnnxClassifier()
      await classifier.initialize({
        modelPath: '/path/to/model.onnx',
        classNamesPath: '/path/to/class_names.json',
        useDirectML: false,
      })

      // Warmup call is the first run call
      expect(mockRun).toHaveBeenCalledTimes(1)
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ input_for_inference: expect.anything() }),
      )
    })
  })

  describe('classify', () => {
    async function createInitializedClassifier() {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(makeClassNames(524)))
      const classifier = createOnnxClassifier()
      await classifier.initialize({
        modelPath: '/path/to/model.onnx',
        classNamesPath: '/path/to/class_names.json',
        useDirectML: false,
      })
      return classifier
    }

    it('returns correct prediction for single image', async () => {
      const classifier = await createInitializedClassifier()

      const output = makeOutputData(1, 524, [{ index: 42, confidence: 0.95 }])
      mockRun.mockResolvedValueOnce({
        Identity: { data: output },
      })

      const results = await classifier.classify(
        new Float32Array(96 * 96 * 3),
        1,
        0.9,
      )

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('ability_42')
      expect(results[0].confidence).toBeCloseTo(0.95)
      expect(results[0].classIndex).toBe(42)
    })

    it('returns null name when confidence is below threshold', async () => {
      const classifier = await createInitializedClassifier()

      const output = makeOutputData(1, 524, [{ index: 42, confidence: 0.85 }])
      mockRun.mockResolvedValueOnce({
        Identity: { data: output },
      })

      const results = await classifier.classify(
        new Float32Array(96 * 96 * 3),
        1,
        0.9,
      )

      expect(results[0].name).toBeNull()
      expect(results[0].confidence).toBeCloseTo(0.85)
      expect(results[0].classIndex).toBe(42)
    })

    it('handles batch of multiple images', async () => {
      const classifier = await createInitializedClassifier()

      const output = makeOutputData(3, 524, [
        { index: 10, confidence: 0.99 },
        { index: 200, confidence: 0.50 },
        { index: 523, confidence: 0.92 },
      ])
      mockRun.mockResolvedValueOnce({
        Identity: { data: output },
      })

      const results = await classifier.classify(
        new Float32Array(3 * 96 * 96 * 3),
        3,
        0.9,
      )

      expect(results).toHaveLength(3)
      expect(results[0].name).toBe('ability_10')
      expect(results[1].name).toBeNull() // below threshold
      expect(results[2].name).toBe('ability_523')
    })

    it('throws if not initialized', async () => {
      const classifier = createOnnxClassifier()

      await expect(
        classifier.classify(new Float32Array(96 * 96 * 3), 1, 0.9),
      ).rejects.toThrow('Classifier not initialized')
    })
  })

  describe('dispose', () => {
    it('releases session and marks as not ready', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify(makeClassNames(524)))
      const classifier = createOnnxClassifier()
      await classifier.initialize({
        modelPath: '/path/to/model.onnx',
        classNamesPath: '/path/to/class_names.json',
        useDirectML: false,
      })

      expect(classifier.isReady()).toBe(true)

      await classifier.dispose()

      expect(mockRelease).toHaveBeenCalled()
      expect(classifier.isReady()).toBe(false)
    })

    it('is safe to call when not initialized', async () => {
      const classifier = createOnnxClassifier()
      await expect(classifier.dispose()).resolves.not.toThrow()
    })
  })
})
