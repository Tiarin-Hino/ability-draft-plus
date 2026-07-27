# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Model update: 528 classes** — recognizes 6 new abilities (Beastmaster Summon Raptor/Razorback, Dragon Knight Wyrm's Wrath, Lifestealer Feast, Tinker Deploy Turrets, Venomancer Snakebite) and drops 2 removed ones (PA Blur, Tinker Heat-Seeking Missile). 99.47% test accuracy. Known gap: Summon Raptor is often confused with Call of the Wild Hawk (near-identical bird icons, thin training data) — improves with the next data collection round
- **Model format switched from INT8 to FP16** (~5.6 MB) after INT8 quantization proved unreliable across training runs — FP16 matches full-precision accuracy exactly and is deterministic; see docs/ML_PIPELINE.md

- **Semi-automated model retraining pipeline** (`docs/ML_PIPELINE.md`) — the Dashboard now has an "Export Model Gaps" button that writes the staleness-detector's missing-ability list (with hero mapping from the DB) to a JSON the data-gather script consumes directly; a new `training/train.py` replaces the 17 loose Colab cells with a seeded, class-weighted, reproducible pipeline; and a "Retrain ML model" GitHub Actions workflow trains on an S3-hosted dataset, runs an INT8 accuracy regression gate against the test split, and opens a review PR with the new model, class list, per-class metrics, and a minor version bump
- The model's class count is now derived from `class_names.json` and validated against the model's actual output size at init — a retrained model with more classes no longer requires a code change (previously a hardcoded 524 caused a hard ML init failure)

- **Global scan hotkeys** — Ctrl+Shift+S triggers a scan and Ctrl+Shift+R a rescan while the overlay is active, so no mouse travel is needed during a timed draft. The scan hotkey skips the confirmation dialog
- **Getting Started checklist** — the Dashboard now walks new users through the three required steps (update Windrun data → activate overlay → scan) until the first data update completes
- **Scan quality summary** — after a scan the overlay shows "N/M recognized"; unrecognized slots get a dashed amber border and an explanatory tooltip instead of rendering as silent blanks
- **Resolution source visibility** — the overlay and the Dashboard overlay card now show whether coordinates are preset, calibrated, or auto-scaled, with an accuracy warning for auto-scaled layouts

### Fixed

- **"Report Failed Recognition" now works** — the feedback pipeline (snapshot, export, upload) had no main-process implementation in v2; all three buttons were silent no-ops. Snapshots now save the exact screenshot the model classified plus its raw predictions to `feedback-samples/` in the app data folder (capped at 25), Export zips them to a user-chosen file, and Send uploads pending samples to the feedback API when configured
- **Scan confirmation dialog has a real Cancel button** — previously "Don't Show Again" replaced Cancel and both buttons started a scan
- **Recommendation highlights stay visible while hovering** — opening any tooltip no longer strips the shimmer borders from every hotspot
- **Overlay no longer gets stuck on "Scanning…"** — scan-processing errors are now reported to the overlay, and a 30-second client-side timeout recovers the UI if the main process never responds
- **Reset fully resets the draft session** — the overlay Reset button now also clears the main-process ability-pool caches and My Spot / My Model selections (previously a Rescan after Reset diffed against the stale previous pool); the session is also cleared when the overlay closes
- **Calibration wizard is reachable by users** — the 4-anchor calibration advertised in the README was gated to dev builds; the Calibrate button is now always available in the Mapper
- **ML errors are visible** — the Dashboard ML status card now shows the actual error message instead of just "Error"
- Mapper wizard no longer triggers a React setState-during-render warning on completion

### Changed

- Feedback status messages are now localized (EN/RU) via i18n keys instead of hardcoded English strings
- OP/Trap combination panels are capped at 40% of screen height with their own scrollbars, so they can no longer cover the draft timer area

## [2.0.0] - 2026-02-23

### Complete Rewrite

Ability Draft Plus v2 is a ground-up rewrite of the original application. Every line of code has been replaced with a modern, TypeScript-strict, professionally architected Electron application.

### New Features

- **Automatic resolution detection** -- mathematical scaling for any resolution, preset coordinates for 28 common resolutions, 4-anchor calibration wizard for custom setups
- **Ability triplet synergies** -- three-ability combination data from Windrun.io, with suggested-third-ability badges on pair tooltips
- **ML model staleness detection** -- warns when the ML model is out of date with newly scraped ability data
- **Internationalization** -- full English and Russian language support (i18next)
- **Dark mode** -- system theme sync with manual light/dark/system toggle
- **Auto-updater** -- in-app update notifications and one-click install
- **Database backup and restore** -- automatic startup backups with 3-backup retention, manual backup/restore from Settings
- **Windowed mode support** -- automatic game window tracking and overlay repositioning via Win32 API
- **Screenshot feedback submission** -- submit misidentified ability screenshots for ML training data collection
- **Liquipedia enrichment** -- dev-mode ability metadata enrichment from Liquipedia wiki pages
- **Crash reporting** -- optional Sentry integration for automated error tracking

### Improvements Over v1

- **ML**: ONNX Runtime INT8 quantized model (halved memory, DirectML GPU acceleration) replaces TensorFlow.js
- **UI**: Professional shadcn/ui + Tailwind CSS v4 design system replaces vanilla HTML/CSS
- **Data**: API-based Windrun.io scraper (reliable JSON endpoints) replaces broken Puppeteer web scraping
- **Architecture**: TypeScript strict mode, clean 3-layer separation (core/main/renderer), zero `any` types
- **Testing**: 381 automated tests (Vitest unit/integration + Playwright E2E)
- **Build**: electron-vite for fast development and optimized production builds
- **State**: Zustand + @zubridge/electron for reactive cross-process state synchronization
- **Database**: Drizzle ORM + sql.js (no native modules, no node-gyp, no electron-rebuild)
- **Logging**: electron-log v5 with scoped loggers replaces console.log

### Preserved From v1

All 21 original features have been preserved, including:

- One-click ML-based ability scanning (initial scan + rescan)
- Real-time transparent click-through overlay
- Ability synergy detection (OP and trap combinations)
- Hero-ability synergy analysis
- Top-tier pick recommendations (max 10, synergy-prioritized)
- My Spot / My Model hero selection
- Consolidated scoring formula (0.4 * winrate + 0.6 * pick order)
- 90% ML confidence threshold
- Configurable OP/trap thresholds (default 13% / 5%)
