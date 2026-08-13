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

// Streamer view
export const STREAM_PROTOCOL_VERSION = 1
export const DEFAULT_STREAM_PORT = 58873
export const STREAM_TOP_WINRATE_COUNT = 8
export const STREAM_MAX_COMBO_PANEL_ENTRIES = 8
export const STREAM_PICK_FEED_LENGTH = 20

// Picked-model detection via model-tile diffing. The 12 model portrait tiles on
// the draft stage are pixel-STATIC while unpicked (measured mean abs diff 0.0
// across scans) and change drastically when picked (measured 35-120). Tiles are
// normalized to a small square for comparison; the threshold sits in the huge
// gap between "identical" and "changed".
export const MODEL_TILE_COMPARE_SIZE = 48
export const MODEL_PICK_DIFF_THRESHOLD = 10

// Experimental auto-rescan (GSI-driven draft tracking).
// Fallback auto INITIAL scan: fires this long after the draft clock is first
// identified (hero selection + clock_time present) when the user hasn't run
// the initial scan themselves — deep in the preview, pool fully rendered.
export const AUTO_INITIAL_SCAN_DELAY_S = 15
// The tick only CHECKS the turn clock; scans fire when a turn ends (~7s apart),
// so a 1s tick costs nothing between turns but keeps boundary latency low.
export const AUTO_RESCAN_TICK_MS = 1_000
// Wait after a turn ends before scanning — the game UI needs a moment to render
// the picked ability icon into the player's row.
export const AUTO_RESCAN_PICK_VISIBLE_DELAY_S = 1
// A targeted rescan blocked by the contamination guard (hover tooltip over the
// rows) retries every tick; after this many attempts the pending rows are
// dropped — the next round-break full reconciliation scan will catch the pick.
export const AUTO_RESCAN_MAX_TARGET_RETRIES = 10
// REPLAYS: seeking rewinds the draft clock and playback is chunked, so the turn
// schedule cannot be trusted — replay sessions fall back to plain periodic FULL
// rescans at this interval. Live spectating stays turn-driven.
export const AUTO_RESCAN_REPLAY_INTERVAL_MS = 5_000
// A spectated draft whose clock jumps BACKWARD by more than this is a replay
// being seeked (the per-turn -7..0 countdown legitimately rewinds by exactly 7s,
// so the threshold must sit above that).
export const REPLAY_CLOCK_REWIND_THRESHOLD_S = 10
// Contamination guard: after this many CONSECUTIVE rejected rescans, accept the
// next one and re-baseline — a poisoned baseline (confident misread of an empty
// slot) or a long-lived in-game overlay must not stall updates indefinitely.
export const RESCAN_GUARD_MAX_CONSECUTIVE_REJECTIONS = 3

// Per-player draft score: score = clamp01(meanWinrate + weight * Σ clamped pair lifts).
// MAX_PAIR_DELTA caps a single pair's contribution so one outlier synergy row
// cannot dominate the whole score.
export const PLAYER_SCORE_SYNERGY_WEIGHT = 0.5
export const PLAYER_SCORE_MAX_PAIR_DELTA = 0.08
