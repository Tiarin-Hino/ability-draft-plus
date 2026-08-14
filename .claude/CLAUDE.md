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
- **i18n:** i18next, EN + RU. Every user-visible string goes through locales — including
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
- Overlay CSS: `contain: strict`, `will-change: transform`, NO `backdrop-filter: blur()`;
  `rgba()` backgrounds instead

## ML pipeline (see docs/ML_PIPELINE.md for the full loop)
- Model + `class_names.json` ship in `resources/model/` and MUST stay in sync; the classifier
  validates class count against the model's output width at init. There is NO hardcoded class count
- Preprocessing feeds RAW 0–255 float32 — the graph's Rescaling layer normalizes internally.
  Do not add normalization
- The classifier handles POOL slots only. PICKED-ability slots are identified by template
  matching (`core/ml/template-matcher.ts`): NCC against the official CDN icons cached in
  `userData/stream-icons/abilities` (pick boxes render icons flat; crops are border-inset).
  Candidates are scoped to pool + picked names; the classifier is the pick-slot fallback
  only when no icons are cached. Went 40/40 on a board where the classifier missed 3 picks
  and confidently misread a 4th
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
  Never commit them. Note: the client "shared secret" is distributed with the installer —
  treat the API as public + rate-limited, not authenticated
- Validate URLs before `shell.openExternal` (http/https only)

## Known intentional decisions (don't "fix" without reading history)
- Control panel minimizes on overlay activation — a restored window overlapping a windowed
  game would contaminate scan screenshots
- `autoDownload` off for updates — checking is automatic, downloading is the user's choice
- Scan hotkey skips the confirmation dialog — pressing it is explicit intent
- FP16 model, CPU provider, no INT8 — see docs/ML_PIPELINE.md
