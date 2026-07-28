// ML Configuration
export const ML_CONFIDENCE_THRESHOLD = 0.9

// Per-class confidence overrides for known hard classes: the class is accepted
// when it wins the argmax at or above ITS threshold, even below the global one.
// Crystal Nova consistently scores 0.55-0.9 on live boards while every other
// class sits at 0.95+, so a nova argmax above 0.5 is virtually always correct.
export const ML_CLASS_THRESHOLD_OVERRIDES: Readonly<Record<string, number>> = {
  crystal_maiden_crystal_nova: 0.5,
}
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
// The class count is NOT a constant — it is defined by resources/model/class_names.json
// and validated against the model's output width at classifier init.
export const MODEL_INPUT_SIZE = 96
