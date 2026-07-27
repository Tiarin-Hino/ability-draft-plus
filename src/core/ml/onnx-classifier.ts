import * as ort from 'onnxruntime-node'
import { readFile } from 'fs/promises'
import { MODEL_INPUT_SIZE } from '@shared/constants/thresholds'
import type { ClassifierConfig, ClassifierResult, ImageClassifier } from './classifier'

// @DEV-GUIDE: ONNX Runtime inference wrapper for ability icon classification.
// Model: FP16 MobileNetV2 (input: [batch, 96, 96, 3] float32 raw 0-255; output: [batch, N]
// probs, N defined by class_names.json and validated against the model at init).
// Runs on the CPU execution provider. DirectML plumbing exists (config.useDirectML)
// but is disabled pending validation — note the provider echo below is the requested
// config, not a detected one.
// Warmup inference runs on init to trigger JIT compilation.
// classifyBatch() takes pre-processed float32 arrays and returns className + confidence pairs.
// Returns null className if confidence < threshold (0.9).
// Zero Electron imports -- runs in the ML worker (worker_threads).

export function createOnnxClassifier(): ImageClassifier {
  let session: ort.InferenceSession | null = null
  let classNames: string[] = []
  let inputName = ''
  let outputName = ''
  let ready = false
  let activeProvider = 'cpu'

  async function initialize(config: ClassifierConfig): Promise<void> {
    // Load class names. The class count is defined by class_names.json (shipped
    // alongside the model), not by a hardcoded constant — a retrained model with
    // more classes must not brick ML init. Consistency with the actual model
    // output is verified against the warmup inference below.
    const classNamesData = await readFile(config.classNamesPath, 'utf-8')
    classNames = JSON.parse(classNamesData) as string[]
    if (!Array.isArray(classNames) || classNames.length === 0) {
      throw new Error('class_names.json is empty or invalid')
    }

    // Configure execution providers
    const providers: ort.InferenceSession.ExecutionProviderConfig[] = config.useDirectML
      ? ['dml', 'cpu']
      : ['cpu']

    // Create inference session
    session = await ort.InferenceSession.create(config.modelPath, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })

    inputName = session.inputNames[0]
    outputName = session.outputNames[0]

    // Detect which provider was actually used
    activeProvider = config.useDirectML ? 'dml' : 'cpu'

    // Warmup inference; also verifies the model's output width matches class_names.json
    const dummyData = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3)
    const dummyTensor = new ort.Tensor('float32', dummyData, [
      1,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
      3,
    ])
    const warmup = await session.run({ [inputName]: dummyTensor })
    const outputSize = warmup[outputName].data.length
    if (outputSize !== classNames.length) {
      throw new Error(
        `Model output size ${outputSize} does not match class_names.json (${classNames.length} entries) — model and class list are out of sync`,
      )
    }

    ready = true
  }

  async function classify(
    batchData: Float32Array,
    batchSize: number,
    confidenceThreshold: number,
  ): Promise<ClassifierResult[]> {
    if (!session || !ready) {
      throw new Error('Classifier not initialized')
    }

    const tensor = new ort.Tensor('float32', batchData, [
      batchSize,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
      3,
    ])

    const outputMap = await session.run({ [inputName]: tensor })
    const outputTensor = outputMap[outputName]
    const outputData = outputTensor.data as Float32Array

    const results: ClassifierResult[] = []
    for (let i = 0; i < batchSize; i++) {
      const numClasses = classNames.length
      const offset = i * numClasses
      let maxProb = 0
      let maxIndex = 0
      for (let j = 0; j < numClasses; j++) {
        const val = outputData[offset + j]
        if (val > maxProb) {
          maxProb = val
          maxIndex = j
        }
      }
      results.push({
        name:
          maxProb >= confidenceThreshold && maxIndex < classNames.length
            ? classNames[maxIndex]
            : null,
        confidence: maxProb,
        classIndex: maxIndex,
      })
    }

    return results
  }

  async function dispose(): Promise<void> {
    if (session) {
      await session.release()
      session = null
    }
    classNames = []
    inputName = ''
    outputName = ''
    ready = false
  }

  function isReady(): boolean {
    return ready
  }

  function getExecutionProvider(): string {
    return activeProvider
  }

  return { initialize, classify, dispose, isReady, getExecutionProvider }
}

export type OnnxClassifier = ReturnType<typeof createOnnxClassifier>
