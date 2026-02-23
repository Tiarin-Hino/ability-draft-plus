// ML Configuration
export const ML_CONFIDENCE_THRESHOLD = 0.9
export const ML_MODEL_INIT_TIMEOUT = 30_000
export const ML_PREDICTION_TIMEOUT = 10_000
export const ML_WORKER_MAX_RESTART_ATTEMPTS = 3
export const ML_WORKER_RESTART_COOLDOWN = 5_000
export const ML_WORKER_RESTART_RESET_TIME = 60_000

// Scoring
export const WEIGHT_WINRATE = 0.4
export const WEIGHT_PICK_ORDER = 0.6
export const MIN_PICK_ORDER_FOR_NORMALIZATION = 1.0
export const MAX_PICK_ORDER_FOR_NORMALIZATION = 50.0
export const NUM_TOP_TIER_SUGGESTIONS = 10

// Default thresholds
export const DEFAULT_OP_THRESHOLD = 0.13
export const DEFAULT_TRAP_THRESHOLD = 0.05

// Model
export const MODEL_INPUT_SIZE = 96
export const MODEL_NUM_CLASSES = 524

// Screenshot Cache
export const SCREENSHOT_CACHE_TTL = 2_000
export const SCREENSHOT_PREFETCH_INTERVAL = 1_500
