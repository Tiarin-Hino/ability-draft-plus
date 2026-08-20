// ML Configuration
export const ML_CONFIDENCE_THRESHOLD = 0.9

// Per-class confidence overrides for known hard classes: the class is accepted
// when it wins the argmax at or above ITS threshold, even below the global one.
// Crystal Nova consistently scores 0.55-0.9 on live boards while every other
// class sits at 0.95+, so a nova argmax above 0.5 is virtually always correct.
// Gorgon Grasp and Shadowraze regressed to 0.58/0.63 on live boards with the
// dataset-v8 model (correct argmax, runner-up at ~0.25) — override until the
// classes get more training data and a retrain wins them back above 0.9.
export const ML_CLASS_THRESHOLD_OVERRIDES: Readonly<Record<string, number>> = {
  crystal_maiden_crystal_nova: 0.5,
  medusa_gorgon_grasp: 0.5,
  nevermore_shadowraze2: 0.5,
}
// Picked-slot recognition via template matching against official CDN icons
// (core/ml/template-matcher.ts). Pick boxes render the icon FLAT (unlike the
// skewed pool slots), so a normalized-cross-correlation match against the
// stream-icons cache beats the classifier there: on a real 40-slot board the
// classifier missed 3 picks and confidently misread a 4th; template matching
// went 40/40 (2026-08-14, sample-2026-08-13T23-08-21-287Z).
export const PICK_TEMPLATE_COMPARE_SIZE = 48
// Pick boxes have a border ring + rounded corners the model/icons never saw;
// insetting the crop by ~8% of the slot width (7px at 1440p's 87px) removes
// them. Measured: shadowraze2 NCC 0.773 inset vs argmax LOST without inset.
export const PICK_TEMPLATE_CROP_INSET_RATIO = 0.08
// Acceptance: best NCC at or above MIN_NCC and ahead of the runner-up by
// MIN_MARGIN, else the slot renders Unknown. With CORRECT box geometry
// (87px at 1440p — see the 2026-08-14 layout fix; the original 73px
// under-crop degraded every match to 0.42-0.87 and caused chronic rejects),
// correct matches measure 0.90-0.996 NCC with 0.19+ margins against all 539
// icons, so these gates carry comfortable headroom. If scores regress into
// the gates again, suspect crop geometry FIRST (debug/rejected-picks dumps),
// not the thresholds.
export const PICK_TEMPLATE_MIN_NCC = 0.45
export const PICK_TEMPLATE_MIN_MARGIN = 0.02
// Scoping a pick box to the pool's candidates is what keeps margins wide, but it
// turns a POOL miss into a permanent pick miss: an ability the initial scan failed
// to read never enters the candidate set, so its pick box can never match and the
// matcher just returns the least-bad pool candidate forever. Measured 2026-08-19:
// 3 of 528 pool slots read Unknown (classifier below its 0.9 gate) and each one
// that got drafted produced an unresolvable pick box scoring ~0.32 — while an
// UNRESTRICTED match against the full icon library scored the true ability at
// 0.974 and 0.994. So a rejected scoped match retries unrestricted and is accepted
// only above this much stricter floor, which sits far above any wrong match
// observed in the runs (max 0.782) and below every correct one.
export const PICK_TEMPLATE_FALLBACK_MIN_NCC = 0.85
// An empty pick box is near-uniform dark pixels: measured std 0.8 vs 54+ for
// any real icon. Detected before matching — empties never reach the matcher
// (the classifier used to argmax tusk_snowball 0.33-0.52 on them).
export const PICK_TEMPLATE_EMPTY_STD = 5
// Cached CDN icons go stale when Valve reworks art in place (2026-08: all four
// Pugna icons — old art broke pick-slot template matching AND the streamer
// view). During prefetch, a cached icon older than this TTL is refetched with a
// cache-busting query — required because Valve's Cloudflare edge itself served
// the pre-rework bytes under the bare URL while origin had the new art.
export const ICON_CACHE_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Pool slots that read Unknown are re-classified on later scans (pool art is
// static until drafted). Bounded so a genuinely unreadable slot cannot re-crop
// forever; ~10 rescans covers several draft rounds, far more than a transient
// artifact (hover tooltip, animation frame) survives.
export const POOL_RETRY_MAX_ATTEMPTS = 10

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
// v2: StreamPlayerRow.picks became a fixed-length-4 positional array (nulls for
// empty boxes, index 3 = ultimate box) instead of a compact list.
export const STREAM_PROTOCOL_VERSION = 2
export const DEFAULT_STREAM_PORT = 58873
export const STREAM_TOP_WINRATE_COUNT = 8
export const STREAM_MAX_COMBO_PANEL_ENTRIES = 8
export const STREAM_PICK_FEED_LENGTH = 20

// Model-tile IDENTIFICATION via NCC against the gathered reference-tile library
// (core/ml/model-tile-matcher.ts; references from ad_data_gather_script's
// models mode land in userData/model-tiles/<hero>/*.png).
// CALIBRATED on the 2026-08-19 diagnostic run (11 bot drafts, 5737 accepted
// tile matches vs known lineups): correct matches score 0.995+ (p05, median
// 0.998) because a reference exists for that hero AT THAT BOARD POSITION,
// while every WRONG match topped out at 0.782 (median 0.564 — mostly picked/
// dimmed tiles latching onto dark templates: tiny/pangolier/tusk). The
// distribution is bimodal with a wide empty gap, so a 0.85 floor drops 100%
// of the wrong matches and keeps 99.1% of the correct ones. At the old 0.5
// floor those 36 wrong IDs made model recognition 72.7% accurate; a tile that
// scores below the floor now reads Unknown, which beats a confident misread.
export const MODEL_TILE_MATCH_MIN_NCC = 0.85
export const MODEL_TILE_MATCH_MIN_MARGIN = 0.03

// OCR of hero names on the 10 player cards (main/services/ocr-service.ts).
// Names are always English spaced capitals; the strip is the card's UPPER HALF
// (the highlighted/active card expands, shifting the name down). A strip is
// re-OCR'd only when its downscaled pixels change (cheap diff), and a match
// below this similarity (1 - levenshtein/len) is discarded as a misread.
export const OCR_NAME_STRIP_HEIGHT_RATIO = 0.5
export const OCR_MIN_SIMILARITY = 0.6
export const OCR_STRIP_DIFF_SIZE = 32
export const OCR_STRIP_DIFF_THRESHOLD = 4
// Strips are upscaled to this width before OCR so letter height is consistent
// across game resolutions (tesseract reads upscaled small text far better).
export const OCR_STRIP_TARGET_WIDTH = 600

// Picked-model detection via model-tile diffing. The 12 model portrait tiles on
// the draft stage are pixel-STATIC while unpicked (measured mean abs diff 0.0
// across scans) and change drastically when picked (measured 35-120). Tiles are
// normalized to a small square for comparison; the threshold sits in the huge
// gap between "identical" and "changed".
export const MODEL_TILE_COMPARE_SIZE = 48
export const MODEL_PICK_DIFF_THRESHOLD = 10
// A model tile that just read changed gets a dedicated CONFIRMATION capture this
// soon (zero ability slots — model tiles only), so the two-scan persistence rule
// resolves in ~1.5s instead of waiting a full turn for the next scheduled scan.
export const MODEL_PICK_CONFIRM_DELAY_MS = 1_500

// GSI slot <-> scan row correlation via player-card diffing (spectate/replay).
// The 10 player cards on the draft screen show pixel-static "NO HERO" art until
// that row's player drafts a model, then switch to ANIMATED hero art — a change
// that persists against the baseline on every later scan. Cards are normalized
// to a small square for comparison (same rationale as model tiles; the downscale
// also absorbs the spectator layout's slight coordinate nudges).
export const PLAYER_CARD_COMPARE_SIZE = 48
export const PLAYER_CARD_DIFF_THRESHOLD = 10
// Matching window between a GSI "slot S gained hero H" event and a card row's
// first-read-changed time. BEFORE covers GSI lagging the screen (throttle /
// 10s heartbeat); AFTER covers the scan cadence reaching the changed card
// (5s replay interval or ~7s turn spacing, plus processing).
export const SLOT_MAP_EVENT_SLACK_BEFORE_MS = 10_000
export const SLOT_MAP_EVENT_SLACK_AFTER_MS = 20_000

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

// Cached-source game window capture (cached-window-capture-service.ts + the
// overlay renderer's capture-agent.ts). desktopCapturer.getSources() thumbnails
// EVERY open window to deliver one frame (measured 730-1075ms/scan, ~85% of
// scan latency), so scans instead grab frames from a persistent getUserMedia
// stream of the game window; getSources runs once per session (thumbnail-free)
// only to resolve the window's source id.
// Stream frame-rate cap: scans run at most every ~1.5s, so a frame up to
// 1/10s stale is irrelevant while the capture stays cheap between scans.
export const CAPTURE_STREAM_MAX_FPS = 10
// Main-side wait for the renderer's frame response. Covers a cold stream start
// (getUserMedia + the known ~300ms WGC first-attempt failure) with room to
// spare; on expiry the scan falls back to the getSources path (~1s).
export const CAPTURE_FRAME_TIMEOUT_MS = 4_000
// Renderer-side wait for the FIRST frame after a stream starts. Must stay
// below CAPTURE_FRAME_TIMEOUT_MS so the error response beats the main-side
// timeout (a timed-out request ignores late responses).
export const CAPTURE_FIRST_FRAME_TIMEOUT_MS = 3_000
// No frame requested for this long -> the draft is over; stop the renderer
// stream so the WGC capture session doesn't run for the whole match. The
// cached source id survives (restarting the stream is cheap).
export const CAPTURE_IDLE_STOP_MS = 30_000

// Per-player draft score: score = clamp01(meanWinrate + weight * Σ clamped pair lifts).
// MAX_PAIR_DELTA caps a single pair's contribution so one outlier synergy row
// cannot dominate the whole score.
export const PLAYER_SCORE_SYNERGY_WEIGHT = 0.5
export const PLAYER_SCORE_MAX_PAIR_DELTA = 0.08
