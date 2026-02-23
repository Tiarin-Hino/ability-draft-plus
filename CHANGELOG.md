# Changelog

All notable changes to this project will be documented in this file.

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
