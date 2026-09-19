# Claude Code Rules for Ability Draft Plus

Shipped, actively maintained Electron app (v2 architecture, released). This file is the
maintenance spec — the authoritative map of what IS, not a build plan.

## Stack (as shipped)
- **Framework:** Electron + electron-vite (three build targets: main, preload, renderer×2)
- **Frontend:** React 19 + shadcn/ui + Tailwind CSS v4 (control panel); hand-written CSS (overlay)
- **State:** Zustand + @zubridge/electron — main-process AppStore is the single source of truth,
  synced to renderers; DraftStore is main-only session state
- **Database:** Drizzle ORM + sql.js (WASM, in-memory, explicit `persist()`; NO native modules)
- **ML:** onnxruntime-node, **FP16** MobileNetV2 in a `worker_threads` worker (NOT UtilityProcess).
  CPU execution provider; DirectML plumbing exists but is disabled pending validation
- **Screen capture:** Electron `desktopCapturer` (native — never reintroduce child-process capture)
- **IPC:** typed maps in `src/shared/ipc/api.ts` (`IpcInvokeMap`/`IpcSendMap`/`IpcOnMap`).
  That file IS the channel inventory; there is no constants registry
- **Testing:** Vitest unit suite (runs without Electron thanks to core purity) + one Playwright
  E2E smoke test executed in CI after build
- **i18n:** i18next; languages live in SUPPORTED_LANGUAGES/LANGUAGE_META (defaults.ts):
  EN, RU, zh-CN, ES, pt-BR, UK, FIL, FI. The disk-driven parity test
  (tests/unit/renderer/i18n-locales.test.ts) fails on any key/interpolation drift
  from EN, for every language. Every user-visible string goes through locales — including
  strings originating in the main process (send i18n keys + params, translate in the renderer;
  see `FeedbackStatus` for the pattern)
- **Release:** NSIS via electron-builder; publish is TAG-triggered (`v*`); electron-updater
  checks automatically (30s after start + 4h interval), download/install are manual

## Architecture invariants
- `src/core/` has ZERO Electron imports — pure TypeScript. This is why the unit suite is fast;
  never break it
- Database access only through repositories; renderers only via typed IPC (contextBridge,
  context isolation on, nodeIntegration off, CSP on both HTML entries)
- Overlay window: transparent, frameless, `alwaysOnTop('screen-saver')`, `showInactive()`,
  click-through via `setIgnoreMouseEvents(true, {forward:true})` + per-element hover opt-in.
  The 1px width-shrink in window-manager is a REAL Windows fix — do not "clean it up"
- The overlay never holds keyboard focus — in-window key handlers don't work; use
  `globalShortcut` (registered on overlay activation, unregistered on close)
- Overlay auto-close (GSI, `overlayAutoCloseEnabled`, only with auto draft
  tracking on): closes on the HERO_SELECTION→post-draft transition, reopens at
  POST_GAME or a new-match draft. State machine is pure (core/gsi/
  overlay-lifecycle.ts); the auto-close path suppresses the control-panel
  restore/focus (stealing focus would alt-tab the player out of the game).
  Inert in background mode — nothing is covering the game, and closing resets
  the draft session (dropping the stream board to 'waiting' mid-match).
  Auto-close AWAITS the draft-end final pass (auto-rescan `finalizeDraft`): the
  last turn's scheduled scan always falls after GSI leaves hero selection, and
  closing the overlay ends capture — without it the last pick is lost. The pass
  WAITS for a scan still running before checking ML readiness (gating on
  `mlStatus` first skipped the pass while the last round scanned, 2026-09-16),
  and waits for card OCR to DRAIN (OCR_FINAL_PASS_SETTLE_TIMEOUT_MS) rather than
  the per-scan 1.5s — strips still queued at the session reset are dropped, which
  cost 4 of 7 missed models in the 2026-09-18 sweep
- Background mode (`overlayBackgroundMode`): a NEVER-SHOWN session, not a
  "close the overlay to go headless". `createOverlayWindow({visible:false})`
  keeps the renderer — and therefore the fast getUserMedia capture agent —
  alive, so scan speed is unchanged. Scan hotkeys bypass the renderer in this
  mode (its two-rAF capture-mode wait is both pointless and not guaranteed to
  fire in a window that never paints). Nothing closes a background session, so
  auto-rescan clears the WHOLE draft session when GSI reports hero selection
  for a DIFFERENT match (both matchids known) — a leftover pool blocks the auto
  initial scan and froze the board on the old draft (2026-09-18, game closed
  mid-draft; any finished draft did the same). The control panel offers Reset
  draft / End session for a running background session (its overlay's own
  buttons are never visible); Reset re-arms auto-rescan for the current draft
- Overlay CSS: `contain: strict`, `will-change: transform`, NO `backdrop-filter: blur()`;
  `rgba()` backgrounds instead
- Twitch extension (`docs/TWITCH_EXTENSION.md`): `twitch/{ebs,frontend,catalog}` are
  separate npm packages OUTSIDE the installer (`out/**` only ships) that import ONLY
  types from `src/shared` (relative path). The uploaded zip MUST be flat — Twitch
  drops subdirectories on ingestion (blank frame, no error anywhere); the vite
  output emits chunks/assets at the dist root and `pack.mjs` enforces it The app side is a transport swap of the
  stream board: `twitch-publisher-service` subscribes to `stream-server-service`
  (`subscribeState`) and is inert unless paired AND `twitchBroadcastEnabled`; the pure
  projection lives in `core/domain/twitch-projection.ts`. The compact PubSub payload
  MUST stay under `TWITCH_COMPACT_MAX_BYTES` (Twitch caps messages at 5 KB) — the
  worst-case size test in `twitch-projection.test.ts` enforces it; anything time-varying
  goes in the compact state, anything stable per draft in the rich state. The channel
  token lives in Metadata only (never AppStore / settings:get)
- Caster edition: `TwitchLiveState` (net worth/items/damage/buyback/Aghs) is its
  OWN PubSub message on a 2 s ticker, spectate-only, `ingame` phase only, never
  stored by the EBS and never retried. Do NOT fold it into the compact — that
  defeats the content-key dedupe and re-sends the whole board every tick.
  Twitch allows 1 msg/s/channel, so 2 s is deliberate headroom
- GSI slot order ≠ draft row order (measured: slot 0 = row 4). Everything on the
  wire is keyed by DRAFT ROW; anything drawn over the in-game top bar must
  translate through `compact.seats`. SPECTATE: learned by hero-name identity
  (GSI `slot→hero` joined with card OCR `row→hero`), then elimination within a
  team half; the older pixel/timing correlator is the fallback. PLAYING (GSI
  knows only the local hero): `topbar-seat-service` matches the ten in-game
  portraits against the drafted models' CDN art, per team (core/domain/
  topbar-seats.ts). Keyed by MODEL, so swaps are covered (a drafted model keeps
  its abilities). Seats are ALWAYS filled — confident match, local seat, then
  elimination, then in-order within the team (nothing is sent until at least one
  portrait is recognised: a capture before the HUD draws matches 0/10) — because
  the released extension
  draws nothing for an unmapped seat (user decision 2026-09-16, reversing the
  earlier "unmapped shows nothing"; caster telemetry still omits unmapped players)
- Model picks in PLAYING mode come ONLY from card OCR (core/domain/
  model-picks-from-ocr.ts): the drafter's card prints the hero's name. Tile
  diffing and turn-timing attribution were REMOVED (2026-09-16 live draft: tile
  diff committed a model nobody picked and missed the last pick; timing
  attribution was wrong 5/10; card OCR was 10/10). Do not reintroduce them.
  Each model marker carries its `poolHeroOrder`, so a corrected read re-labels
  the marker in place instead of duplicating it. ABILITY picks are tracked per
  card BOX GROUP (pick-attribution.ts): the 3 standard boxes are a SET — Dota
  REORDERS them as picks land (127/127 high-confidence box changes across 69 live
  drafts were shifts), so never bind a pick to a standard box position; the
  single ultimate box never moves. A name hidden while a box is unreadable is only
  flagged; once every box reads cleanly, a vanished name is renamed (misread,
  keeps its turn) or removed (phantom: an empty ultimate box scored 0.457 as
  Focus Fire).
  The draft store orders the timeline by DRAFT TURN, never by discovery (double
  turns at round breaks and multi-pick scans are discovered out of order): each
  pick carries `seenAtS` (capture time on the draft clock) and lands at its
  player's earliest free turn it was seen within LATE_PICK_GRACE_S of, else the
  latest free turn already started. Do NOT go back to counting picks (k-th pick =
  k-th turn): one unread pick (2026-09-17, an Io card) slid every later pick of
  that player a round early. Untimed picks (replay, mid-draft join, spectate GSI
  markers) fill free turns in order.
- Card-name OCR runs up to THREE passes per strip, first hit wins: sparse-text,
  a dark-text threshold (the HIGHLIGHTED card is dark on light — the original
  settings read it as nothing), then the original mode LAST (it is the only one
  that ever produced a confident wrong hero). One pass missed 2/3 of readable
  names and lost a live Anti-Mage model pick (2026-09-17, "ANTI-MAGE" -> "MACE").
  A "NO HERO" read stops the cascade. Two-letter Io: an exact match on the
  hero-name line, else the thin-letter fallback (`matchThinTwoLetterHero`) —
  tesseract drops Io's hairline "I", and a lone "O" on the FIRST line was only
  ever a real Io across 646 measured strips (only the thin letter may be
  missing: a stray "I" is not Io; needs a known pool). The pool scan misses a
  hero in ~1 draft in 3, so a strip the pool can't match is retried against
  EVERY hero at OCR_UNSCOPED_MIN_SIMILARITY (0.85: 199/213 recovered, 0 wrong
  over the 2026-09-18 sweep) and model-picks-from-ocr maps it onto the pool's
  single unidentified row (2+ gaps: skipped, never guessed). Strips queued
  while a pool was known but recognized after the session reset are DROPPED —
  the draft-end capture read the post-draft screen into wrong heroes. Dev builds log every read to
  debug/ocr-diagnostics and save unreadable strips to debug/ocr-unresolved
  (capped per draft); `scripts/analyze-draft-diagnostics.mjs` reports them per
  hero, fed by the overnight `diagnostic_draft_cycle.py --model-sweep` run

## ML pipeline (see docs/ML_PIPELINE.md for the full loop)
- Model + `class_names.json` ship in `resources/model/` and MUST stay in sync; the classifier
  validates class count against the model's output width at init. There is NO hardcoded class count
- Preprocessing feeds RAW 0–255 float32 — the graph's Rescaling layer normalizes internally.
  Do not add normalization
- The classifier handles POOL slots only. PICKED-ability slots are identified by template
  matching (`core/ml/template-matcher.ts`): NCC against the official CDN icons cached in
  `userData/stream-icons/abilities` (pick boxes render icons flat; crops are border-inset).
  Candidates are scoped per box type — standard boxes match the pool's 36 standard
  abilities, the ultimate box its 12 ultimates (pool + picked names); the classifier is
  the pick-slot fallback only when no icons are cached. Went 40/40 on a board where the
  classifier missed 3 picks and confidently misread a 4th. The cache is NOT immutable:
  prefetch revalidates icons older than 7 days with a cache-busting query (Valve reworks
  art in place and their CDN edge serves stale bytes under the bare URL — 2026-08 Pugna)
- Retraining: `training/train.py` (+ isolated `training/gate.py`) via the "Retrain ML model"
  workflow → opens a model PR. FP16 only; INT8 collapsed accuracy twice (documented) — do not
  reintroduce quantization without beating the gate across multiple training runs
- The gate's twin detector flags renamed abilities whose legacy class still exists in the
  dataset (Windrun keeps serving legacy entries, so staleness detection can't catch renames).
  Treat twin warnings in model PRs as action items: verify in-game, merge legacy images into
  the new class (same art) or purge them
- Dev-only ML Pipeline cockpit lives on the Data page (unpackaged builds only); it shells out
  to local tooling (`../ad_data_gather_script`, `gh`) — no credentials in the app

## Database
- Schema: `SCHEMA_SQL` in `src/core/database/schema.ts` (raw SQL, `CREATE TABLE IF NOT EXISTS`)
  + Drizzle schema-as-code for types. Drizzle Kit migrations are NOT used
- **Column migrations are automatic**: `runColumnMigrations()` diffs every Drizzle table against
  the live DB and adds missing nullable columns, then normalizes text-typed values in REAL
  columns. Adding a nullable column to the schema needs no migration entry. NOT NULL additions
  DO need manual handling (the function logs and skips them). Keep the 1.0-schema tests in
  `database-migration.test.ts` passing
- sql.js gotcha: `run()` returns the Database, so `result.changes` is undefined —
  use SELECT-before-UPDATE or `db.getRowsModified()`
- drizzle-orm 0.45.2's sql.js driver LEAKED a prepared statement per typed
  `select().all()` (WASM heap, never GC'd): a 5-hour session died with "out of
  memory" (2026-09-18). Fixed by `patches/drizzle-orm+0.45.2.patch`, applied by
  patch-package in postinstall; `statement-leak.test.ts` fails if the patch stops
  applying (e.g. after a drizzle upgrade — check whether upstream fixed
  `PreparedQuery.all`, then re-create or drop the patch). Keep per-tick paths
  (GSI broadcasts, auto-rescan ticks) off the DB regardless: cache what they read

## Role-aware suggestions (docs/ROLE_SUGGESTIONS.md is the full map)
- Windrun `/ability-shifts` (undocumented, provider-approved) fills shift columns on
  Abilities AND Heroes (negative ids = hero models) — ordering-only data, consumed as
  pool percentiles (core/domain/shift-axes.ts). Scrape step is non-fatal, never wipes
- Scoring layers are strictly ordered: global → personal blend → role (greed taper +
  needs engine + accents + ult nudge, capped) → top-tier. `roleMode: 'off'` or missing
  shift data is BIT-IDENTICAL to the role-less path — golden tests enforce it —
  EXCEPT role-independent verdicts/facts: all-five roleMust (guaranteed slot),
  all-five roleAvoid (excluded), the overrated damp (wr<0.48 & pick<=15 →
  −OVERRATED_DAMP + tooltip), the round-4 own-pick verdicts (Aghanim's
  stacking: +AGHS_STACK_BOOST per family once MY picks share a good_shard /
  good_aghanims tag; a second skill_point_sink → −POINT_SINK_DAMP; never
  teammates' picks), and the inert/requires filters apply role mode or not.
  The opt-in `aghsMarkersEnabled` setting only adds always-on overlay markers,
  resolved in scan-processor (payload-gated)
- `resources/data/ability_tags.json` + `hero_meta.json` are GENERATED (community Tag
  Lab on abilitydraftplus.com + ../ad_data_gather_script/build_ability_tags.py; the durable
  source of truth is that repo's tag_overrides.json) — never hand-edit, and keep
  TAG_VOCABULARY (core/domain/ability-tags.ts) in lockstep with the script's VOCAB
- Role weights in thresholds.ts carry their empirical rationale (expert-draft corpus +
  simulation) as comments — read them before retuning
- Dependency gates: `requires: ["ability" | "model:hero" | "tag:tag"]` on a
  dataset entry — hard-excluded from suggestions until the user drafts a listed
  ability, picks the listed model (Eclipse→Lucent Beam, Requiem→SF's innate
  souls), or for tag: entries has/still-sees a tagged ability in the pool
  (Rearm→tag:good_with_rearm). Stats stay visible; tooltip explains. Curated in
  tag_overrides.json, preserved by import_site_export.py (the Tag Lab doesn't
  carry it yet). Model shift-greed is DISABLED (ROLE_MODEL_WEIGHT_SCALE=0,
  Drow aura selection-effect); soft-CC half-credit only fires for candidates
  when no real hard_cc remains in the pool
- Curated must-picks: `roleMust: [positions]` on a dataset entry (curated in
  tag_overrides.json, NOT a tag — tags are mechanical facts, this is a verdict)
  guarantees the ability a top-tier slot when the user's role matches, plus a
  ROLE_CURATED_WEIGHT boost. For abilities the stats systematically undervalue
  (e.g. Glimpse for supports); keep the list short and deliberate. The negative
  counterpart `roleAvoid: [positions]` excludes from suggestions (all five =
  never suggested at all, e.g. Ransack). Hero MODELS take roleAvoid too
  (Drow/Luna [4,5]) — model avoids and the MODEL_RESERVATION damp both LIFT
  once every teammate has picked a model (then it only denies enemies)
- Hero MODELS carry tags too (hero_meta.json `tags` + `roleMust`, 7-tag
  HERO_TAG_VOCABULARY: talent profile + innate value; talent tags count GENERIC
  talents only — ability-specific talents are dead on an AD model). They feed
  per-position model accents, model must-picks, and the Layer C ability×model
  pairing (computeAbilityPairing/computeModelPairing, own PAIRING cap,
  role-gated). Curated in hero_tag_overrides.json + the Tag Lab Models view

## Business logic constants (do not change casually)
- Scoring: `0.4 * winrate_normalized + 0.6 * inverted_pick_order_normalized`;
  pick-order normalization range 1.0–50.0
- ML confidence threshold 0.9; below it a slot renders as Unknown (localized, amber dashed)
- Default OP threshold 13%, trap threshold 5%; top-tier suggestions max 10
- Hero identification uses the `ability_order === 2` slot — one W-slot misread mislabels the
  whole hero row (known fragility)
- Slot metadata convention: `ability_order` 0 = ultimate, 1–3 = Q/W/E

## Code quality
- TypeScript strict; no `any`, no `@ts-ignore`; ESLint 9 flat config + Prettier
- `@DEV-GUIDE` header comments on non-trivial files — keep them TRUE when changing behavior
  (stale dev-guides caused real bugs; if code and comment disagree, fix the comment in the
  same commit)
- electron-log scoped loggers; meaningful user-facing error messages

## Git / release workflow
- Branch from main; PRs squash-merged (stacked branches need a rebase after the base merges)
- Conventional commits (feat:, fix:, chore:, docs:, test:)
- Model PRs come from the retrain workflow with a metrics report — review per-class recall
  and twin warnings before merging
- Releasing: merge → set version → `git tag vX.Y.Z && git push origin vX.Y.Z` (release.yml
  is tag-triggered; nothing releases on merge alone)

## Security
- API credentials via `.env` (dev) / `resources/app-config.json` (packaged, generated at build).
  Never commit them. `CLIENT_TAG` is an optional stats-API request parameter, kept
  deliberately separate from `loadApiConfig()` so neither setting can disable the
  other's feature (absent → requests still go out).
  Note: the client "shared secret" is distributed with the installer — treat the API
  as public + rate-limited, not authenticated
- Validate URLs before `shell.openExternal` (http/https only)

## Known intentional decisions (don't "fix" without reading history)
- Control panel minimizes on overlay activation — a restored window overlapping a windowed
  game would contaminate scan screenshots. EXCEPTION: background mode
  (`overlayBackgroundMode`) skips the minimize — the user is not being sent into the game,
  and the capture paths it uses target the Dota window rather than the full display
- `autoDownload` off for updates — checking is automatic, downloading is the user's choice
- Scan hotkey skips the confirmation dialog — pressing it is explicit intent
- FP16 model, CPU provider, no INT8 — see docs/ML_PIPELINE.md
