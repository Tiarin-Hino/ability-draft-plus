# Ability Draft Plus — Agent Guidelines

Authoritative maintenance and architecture guide for **Ability Draft Plus** (v3.3.0+, Electron 40 + `electron-vite` 5 + TypeScript strict).

## Workflow & Collaboration Rules

- **Discuss before changing code:** During analysis or debugging, present findings and proposed changes first and **wait for explicit user approval** before editing code.
- **Never bump the version:** Never modify `package.json` `"version"` or run `npm version` in PRs or bugfixes — version moves only on an official release with a user-named `X.Y.Z` (flag `.github/workflows/train-model.yml`'s `npm version minor` conflict before triggering a retrain).
- **Releases vs. merges & stacked PRs:** Merges to `main` never auto-release; squash-merge stacked PRs bottom-up and restack downstream branches (`git rebase --onto main <old-base> <branch>`, `--force-with-lease`).
- **Live-stream CPU safety:** Heavy builds/tests tank OBS stream FPS (worse than a broken overlay); propose before running heavy commands if the user may be streaming.
- **Evidence-first debugging:** Read `%APPDATA%/ability-draft-plus/logs/main.log` and `gsi-captures/` first (keep `gsi-captures/` active in production). If GSI shows disconnected, check the Dota `.cfg` port vs. stream port first.

## Process & Package Map

Four Electron / Vite targets + one Node worker + standalone Twitch extension subpackages:

- **Main process (`src/main/`)**: Owns all services (`createXxxService` factories), `sql.js` database, `AppStore` (`@zubridge/electron`), `DraftStore` (main-only ephemeral draft session state), `ocr-service` (`tesseract.js`), `stream-server-service` (`127.0.0.1` HTTP + SSE + `/gsi`), `auto-rescan-service`, `twitch-publisher-service`, `topbar-seat-service`, and `window-tracker-service` (`koffi` Win32 FFI).
- **ML worker (`src/main/workers/ml-worker.ts`)**: `worker_threads` worker (NOT `UtilityProcess`) running `onnxruntime-node` (FP16 MobileNetV2 on CPU), `sharp` slot cropping, and NCC template matching.
- **Preload (`src/preload/`)**: Context-isolated bridges (`control-panel.ts`, `overlay.ts`) exposing `electronApi` + `@zubridge`.
- **Renderers (`src/renderer/`)** — 4 Vite SPA entry points:
  1. `control-panel/`: Main dashboard window (React 19 + shadcn/ui + Tailwind CSS v4 + `@tanstack/react-table` + `konva`/`react-konva`).
  2. `overlay/`: Transparent click-through game overlay (`window-manager.ts`) + persistent WGC `getUserMedia` `capture-agent.ts` (hand-written CSS, no Tailwind).
  3. `stream/`: OBS Browser Source tournament draft board served by `stream-server-service` at `/stream` + `/events` SSE (no preload, no Electron API).
  4. `picks/`: OBS Browser Source in-game team strips + URL configurator served at `/picks` + `/picks/events` SSE (persisted to `userData/picks-view.json`).
- **Core (`src/core/`)**: Pure domain logic (`database/`, `domain/`, `gsi/`, `ml/`, `ocr/`, `resolution/`, `scraper/`, `stream/`).
- **Shared (`src/shared/`)**: Typed IPC channel contracts (`ipc/api.ts`), shared types (`types/`), constants (`constants/`).
- **Twitch subpackages (`twitch/{catalog,ebs,frontend}`)**: Separate npm packages outside the Electron installer (`out/**` only ships); see `twitch/AGENTS.md`.
- **External sibling repos** (referenced by dev scripts/docs, outside this repo): `../ad_data_gather_script` (data capture + `build_ability_tags.py` + `tag_overrides.json` / `hero_tag_overrides.json`) and `../tiarinhino.com` (website + live Tag Lab at `abilitydraftplus.com`).

## Hard Architecture Invariants

### Dependency Boundaries & IPC
- **`src/core/` MUST have ZERO Electron imports.** Pure TypeScript only — this keeps the Vitest suite fast without Electron. Never break this boundary.
- **Database access goes strictly through repositories** (`src/core/database/repositories/*`). Never query `sql.js` directly from services, handlers, or renderers.
- **Typed IPC is the sole channel inventory**: `IpcInvokeMap`, `IpcSendMap`, and `IpcOnMap` in `src/shared/ipc/api.ts`. Keep context isolation on, `nodeIntegration` off, and sandboxed CSP intact on HTML entries.
- **Never block high-frequency ticks on SQLite**: GSI payloads (up to 2 Hz) and auto-rescan ticks should read cached state, not repeat expensive DB queries.

### Database (`sql.js` + Drizzle ORM)
- **WASM SQLite, NO native DB drivers**: `sql.js` runs in-memory and writes via explicit `dbService.persist()`.
- **Schema & migrations**: `SCHEMA_SQL` (`CREATE TABLE IF NOT EXISTS`) in `src/core/database/schema.ts` + Drizzle table objects must stay in lockstep. `runColumnMigrations()` in `src/main/services/database-service.ts` diffs Drizzle tables against live SQLite and auto-adds missing nullable columns plus casts historical text-typed numeric values. Any `NOT NULL` addition requires explicit migration logic; keep `tests/unit/main/services/database-migration.test.ts` green.
- **`sql.js` `run()` quirk**: `run()` returns the `Database` instance (`result.changes` is always `undefined`). Use `SELECT`-before-`UPDATE` or `db.getRowsModified()`.
- **Prepared statement memory leak patch**: `drizzle-orm` `0.45.2` leaked a WASM prepared statement on `.all()`. `patches/drizzle-orm+0.45.2.patch` (applied by `postinstall`) fixes it and `tests/unit/core/database/statement-leak.test.ts` enforces it. Never upgrade `drizzle-orm` without testing/removing this patch carefully.

### Overlay Window, Click-Through & Lifecycle
- **1px width shrink (`window-manager.ts`)**: Fullscreen transparent overlays on Windows break `setIgnoreMouseEvents(..., { forward: true })` if they cover exact display bounds. The `width - 1` adjustment is an intentional Windows fix — do not remove it.
- **Focus & hotkeys**: Overlay uses `alwaysOnTop(true, 'screen-saver')` and `showInactive()`. It never holds keyboard focus, so in-window key handlers do not fire during gameplay — use `globalShortcut` (`Control+Shift+S` / `Control+Shift+R`), registered on activation and unregistered on close.
- **Overlay CSS**: Use `contain: strict`, `will-change: transform`, and `rgba()` backgrounds. **NEVER use `backdrop-filter: blur()`** over transparent game overlays.
- **Control panel minimization**: Activating a visible overlay minimizes the control panel so it cannot contaminate scan captures over windowed Dota. Background mode (`overlayBackgroundMode`) skips minimization.
- **Background mode (`overlayBackgroundMode`)**: Creates a NEVER-SHOWN overlay (`show: false`, `backgroundThrottling: false`) so `capture-agent.ts` stays alive for fast `getUserMedia` grabs while scan hotkeys bypass the renderer (`backgroundMode` branch in `src/main/ipc/index.ts`). Do NOT "optimize" background mode by closing the overlay window (closing resets `DraftStore` and drops the stream board). Do NOT enable `setIgnoreMouseEvents(true, { forward: true })` on invisible background windows.
- **GSI dependency & auto-close**: Dota GSI (`POST /gsi`) is hosted by `stream-server-service` (`127.0.0.1`). Overlay auto-close (`src/core/gsi/overlay-lifecycle.ts`) awaits `autoRescan.finalizeDraft()` (which waits for any in-flight scan before checking `mlStatus`, then drains card OCR with `OCR_FINAL_PASS_SETTLE_TIMEOUT_MS`), suppresses control-panel restore/focus on close, ignores `gamePhase: null` dropouts, and restarts the preview clock via `classifyHeroSelectionReentry`.

### Capture, ML Worker, Template Matching & Card OCR
- **Screen capture**: Electron `desktopCapturer` + `capture-agent.ts` (`getUserMedia`) via `game-frame-capture.ts`. Never reintroduce child-process screenshot tools. `cached-window-capture-service.ts` falls back cleanly to `screenshot-service.ts` (`getSources` window -> full display).
- **ML contract (`resources/model/`)**: `ability_classifier_fp16.onnx` + `class_names.json` must match; class count is dynamic (validated at init, never hardcode). Preprocessing feeds **raw `0–255` float32** (`[batch, 96, 96, 3]`) because the ONNX graph contains an internal `Rescaling` layer. Keep **FP16** on CPU (DirectML exists behind config but stays off pending validation; INT8 collapsed accuracy twice). Retrains MUST pass `--fine-tune` (verify `"Fine-tuned top block: yes"` in `report.md` and A/B test on `low-conf-pool` / `low-confidence-pool`); never set a `tusk_snowball` threshold override `>= 0.5` or add blind `ML_CLASS_THRESHOLD_OVERRIDES`.
- **Pool vs. Pick recognition**:
  - Pool slots: MobileNetV2 ONNX classifier (`confidence >= 0.9`, else Unknown; Unknown pool slots retry up to `POOL_RETRY_MAX_ATTEMPTS`).
  - Picked ability slots: Border-inset NCC template matching (`src/core/ml/template-matcher.ts`) against `userData/stream-icons/abilities` scoped by box type (36 pool standards vs. 12 pool ultimates, with unrestricted fallback at `PICK_TEMPLATE_FALLBACK_MIN_NCC`). Revalidates CDN icons older than 7 days with cache-busting queries.
- **Ability Draft board & hero rules**: Facets are gone; every board slot holds 1 ability except Jakiro E (`liquid_fire`/`liquid_ice`), Troll W (`whirling_axes_melee`/`_ranged`), and Invoker/Kez random pools (Invoker's ult is a random ultimate from a hero outside the lobby). Legitimately missing slots: `arc_warden`, `meepo`, `ogre_magi`, `rubick`, `morphling` (no Ult); `crystal_maiden`, `morphling` (no E). Anything else with 2+ abilities/slot or `NULL ability_order` belongs in `SLOT_METADATA_OVERRIDES`. DB hero names use npc tokens (`necrolyte`, `obsidiandestroyer`, `monkey_king`) except `zeus` (npc `zuus`, sole alias among 127 heroes). Player-card hero names always render in English regardless of Dota client language.
- **Draft tracking & sequencing (`src/core/domain/`)**:
  - Playing-mode model picks come **ONLY from card OCR** (`model-picks-from-ocr.ts`), keyed by `poolHeroOrder` so corrected reads update in place. Never reintroduce tile diffing or turn-timing model attribution.
  - Ability picks are tracked per card BOX GROUP (`pick-attribution.ts`): the 3 standard boxes are an unordered SET (Dota reorders them as picks land); the ultimate box is fixed.
  - Draft timeline orders picks by `seenAtS` against `src/core/gsi/draft-clock.ts` (`LATE_PICK_GRACE_S`), **never** by pick count (`k`-th pick != `k`-th turn).
  - GSI ability-bar fallback (`gsi-pick-fallback.ts`) recovers and latches picks when scans missed them.
- **Card OCR (`src/main/services/ocr-service.ts`)**: Runs a 3-pass cascade (`sparse` -> `darkText` threshold -> `auto`), short-circuits on `"NO HERO"`, supports thin-letter `"Io"` (`matchThinTwoLetterHero`), scopes to the 12 pool heroes with a `0.85` unscoped full-roster fallback (`OCR_UNSCOPED_MIN_SIMILARITY`), and drops strips queued before a session reset.
- **GSI seat mapping**: GSI lobby `slotIndex` order != draft `hero_order` row order (`slot 0 != row 0`). Always key wire payloads by draft row and translate in-game overlays via `seats`. Playing mode resolves seats via `topbar-seat-service.ts` (`core/domain/topbar-seats.ts` + `core/ml/topbar-portraits.ts`); spectating mode joins GSI heroes/names/in-game abilities (`slot-row-correlation.ts`, `gsi-pick-fallback.ts`).

### Scoring, Tags & Role-Aware Suggestions
- **Scoring formula (`src/core/domain/scoring.ts`)**: `0.4 * winrate_norm + 0.6 * inverted_pick_order_norm` (pick-order clamped `1.0–50.0`). Top-tier recommendations cap at `10`.
- **Layered scoring stack**: Global -> Personal shrinkage (`K=20`) -> Role (`src/core/domain/role-scoring.ts` + `shift-axes.ts`) -> Top-tier (`top-tier.ts`).
- **Role-off bit-identity invariant**: `roleMode: 'off'` or missing shifts MUST stay bit-identical to pre-role scoring except for intentional role-independent verdicts (`roleMust`/`roleAvoid` covering all 5 positions, overrated damp, Aghs stacking boost, skill-point-sink damp, `melee_only`/`ranged_only` inert filter, `requires` gates).
- **Generated tag/hero data**: `resources/data/ability_tags.json` (42-tag `TAG_VOCABULARY` including 3 hidden `MECHANICAL_TAGS`, plus `roleMust`, `roleAvoid`, `requires`, `combos`, `viaUpgrade`, `with`) and `resources/data/hero_meta.json` (`HERO_TAG_VOCABULARY`) are generated by `../ad_data_gather_script/build_ability_tags.py`. **Never hand-edit these JSONs**, and keep `TAG_VOCABULARY` in `src/core/domain/ability-tags.ts` synchronized with `build_ability_tags.py`. Use `board-tag-profile.ts` for board-wide tag counts rather than re-walking `selectedAbilities`.
- **Tag curation rules**: Keep a tag only when the voiced advice ("covers your missing X") is genuinely accurate. `melee_only`/`ranged_only` apply ONLY to truly inert abilities (never "works but worse"; cleave works on ranged models in current AD). `pick_asap` is visual-only and must never enter score calculation.

### Localization (`i18n`)
- **8 supported languages** in `SUPPORTED_LANGUAGES` (`src/shared/constants/defaults.ts`): `en`, `ru`, `zh-CN`, `es`, `pt-BR`, `uk`, `fil`, `fi`, across 10 namespaces (80 JSON files across `control-panel`, `overlay`, `stream`, `picks`).
- `tests/unit/renderer/i18n-locales.test.ts` fails on any key or interpolation drift from `en`.
- Main process MUST pass i18n keys + params, never raw English strings (see `FeedbackStatus`).

## Verification & Build Commands

> [!IMPORTANT]
> **Typecheck caveat:** Root `tsconfig.json` has `"files": []` with project references, so running `npm run typecheck` (`tsc --noEmit`) checks **0 files**! Always run both referenced configs explicitly until `tsconfig.json` / `package.json` is fixed.

```bash
# 1. Real TypeScript checks (both required!)
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json

# 2. ESLint & Formatting
npm run lint
npm run format:check

# 3. Unit tests (pure core + mocked main/renderer)
npm test
npx vitest run tests/unit/renderer/i18n-locales.test.ts   # Targeted run

# 4. Build & E2E (note: `npm run build` triggers `prebuild` -> scripts/prepare-app-config.mjs)
npm run build
npm run test:e2e

# 5. Project workspace checks (use local skills scripts)
node .agents/skills/i18n-sync/scripts/check-i18n.mjs
node .agents/skills/quality-and-release/scripts/audit-seed-data.mjs
```

## Coding Conventions, `@DEV-GUIDE` & Security
- Strict TypeScript (`no any`, `no @ts-ignore`), ESLint 9 flat config, Prettier (`singleQuote: true`, `semi: false` — see `.prettierrc.json`).
- Non-trivial files carry `// @DEV-GUIDE:` header comments. **Keep them accurate when changing behavior** in the same commit.
- Use `electron-log` scoped loggers (`log.scope('...')`).
- Never commit `.env` or generated `resources/app-config.json`. Keep `CLIENT_TAG` (`CLIENT_TAG_PARAM = 'idf'`, `loadClientTag()`) independent of `loadApiConfig()`; never document or speculate on its external purpose in code, comments, docs, or commit messages. Validate `http:`/`https:` before `shell.openExternal`. Channel tokens live in `Metadata` only (never `AppStore` / `settings:get`).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `perf:`). Releases trigger on `vX.Y.Z` tags (`release.yml`), not merges to `main`.
