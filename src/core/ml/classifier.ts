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
  /**
   * @param activeClassNames When provided (non-empty), classes NOT in the set are
   * excluded from prediction — used to mask model classes for abilities that left
   * the draft pool but are kept in the model in case they return.
   */
  classify(
    batchData: Float32Array,
    batchSize: number,
    confidenceThreshold: number,
    activeClassNames?: ReadonlySet<string>,
  ): Promise<ClassifierResult[]>
  dispose(): Promise<void>
  isReady(): boolean
}
