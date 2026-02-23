export interface ClassifierConfig {
  modelPath: string
  classNamesPath: string
  useDirectML: boolean
}

export interface ClassifierResult {
  name: string | null
  confidence: number
  classIndex: number
}

export interface ImageClassifier {
  initialize(config: ClassifierConfig): Promise<void>
  classify(
    batchData: Float32Array,
    batchSize: number,
    confidenceThreshold: number,
  ): Promise<ClassifierResult[]>
  dispose(): Promise<void>
  isReady(): boolean
}
