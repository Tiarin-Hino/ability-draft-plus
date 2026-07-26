# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
