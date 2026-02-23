# Architecture Guide

Technical reference for the Ability Draft Plus codebase. This document covers the process model, data flow, state management, and key design decisions.

## Process Model

The application runs four concurrent processes:

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process (Electron)                                        │
│  - Service layer (window, DB, ML, screenshot, scraper, etc.)    │
│  - IPC handler registration                                     │
│  - AppStore (Zustand) + @zubridge bridge                        │
│  - DraftStore (Zustand, main-only)                              │
├─────────────────────────────────────────────────────────────────┤
│         │ IPC (typed)         │ IPC (typed)        │ postMessage │
│         ▼                     ▼                    ▼             │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────┐     │
│  │ Control     │  │ Overlay          │  │ ML Worker      │     │
│  │ Panel       │  │ Renderer         │  │ Thread         │     │
│  │ Renderer    │  │ (transparent,    │  │ (ONNX Runtime, │     │
│  │ (React SPA) │  │  click-through)  │  │  DirectML)     │     │
│  └─────────────┘  └──────────────────┘  └────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

- **Main process**: Owns all services, database, and state. Single source of truth.
- **Control panel renderer**: Main app window (React SPA with shadcn/ui). Settings, data tables, dashboard, scraping UI.
- **Overlay renderer**: Transparent, always-on-top window rendered over the Dota 2 game. Click-through by default, interactive elements opt-in.
- **ML worker thread**: Runs ONNX inference in a separate thread to avoid blocking the main process.

## Directory Structure

```
src/
├── core/                   Pure TypeScript, ZERO Electron imports
│   ├── database/
│   │   ├── schema.ts       Drizzle ORM table definitions + raw CREATE TABLE SQL
│   │   ├── index.ts        sql.js initialization (in-memory + file persistence)
│   │   └── repositories/   Data access layer (hero, ability, synergy, triplet, metadata)
│   ├── domain/
│   │   ├── scan-processor.ts   Central business logic (14-phase enrichment pipeline)
│   │   ├── scoring.ts          Consolidated score formula
│   │   ├── hero-identification.ts  Hero model identification from ability_order
│   │   ├── synergy-enrichment.ts   Ability-ability and hero-ability synergy lookups
│   │   ├── op-trap-filter.ts       OP/Trap threshold filtering
│   │   ├── top-tier.ts            Top 10 pick selection algorithm
│   │   └── types.ts               Domain type definitions
│   ├── ml/
│   │   ├── onnx-classifier.ts     ONNX Runtime inference wrapper
│   │   ├── preprocessing.ts       Screenshot crop extraction + float32 normalization
│   │   └── staleness-detector.ts  Detect model/data mismatches
│   ├── resolution/
│   │   ├── coordinate-utils.ts    Coordinate transformations, ultimate hero_order mapping
│   │   ├── scaling-engine.ts      Mathematical resolution scaling
│   │   ├── anchor-calibration.ts  4-anchor affine transform calibration
│   │   └── validation.ts          Calibration result validation
│   └── scraper/
│       ├── windrun-api-client.ts  REST API client for api.windrun.io/api/v2/
│       ├── data-transformer.ts    API response → DB-ready format
│       ├── orchestrator.ts        3-phase scrape flow controller
│       └── liquipedia-scraper.ts  Wiki HTML parsing (dev-mode only)
│
├── main/                   Electron main process
│   ├── index.ts            Entry point (startup sequence, service wiring)
│   ├── ipc/
│   │   ├── index.ts            Master IPC handler registration + overlay:activate
│   │   ├── database-handlers.ts  Hero, ability, settings, backup queries
│   │   ├── ml-handlers.ts       ML init, scan trigger, result processing
│   │   ├── draft-handlers.ts    My Spot / My Model selection
│   │   ├── scraper-handlers.ts  Windrun/Liquipedia scrape triggers
│   │   └── resolution-handlers.ts  Resolution management, screenshot capture
│   ├── services/
│   │   ├── window-manager.ts        Control panel + overlay window creation
│   │   ├── database-service.ts      sql.js lifecycle, persist(), repository creation
│   │   ├── ml-service.ts            ML worker thread management (init, scan, restart)
│   │   ├── scan-processing-service.ts  Bridge between ML results and overlay UI
│   │   ├── layout-service.ts        Resolution → coordinate mapping (cascade)
│   │   ├── scraper-service.ts       Scrape orchestration + staleness detection
│   │   ├── screenshot-service.ts    Screen capture with caching + prefetch
│   │   ├── window-tracker-service.ts  Win32 FFI game window tracking (koffi)
│   │   ├── backup-service.ts        DB backup/restore with retention policy
│   │   ├── update-service.ts        electron-updater wrapper
│   │   ├── sentry-service.ts        Crash reporting (no-op when unconfigured)
│   │   └── api-config.ts            Runtime config loading (.env / app-config.json)
│   ├── store/
│   │   ├── app-store.ts             Zustand store + @zubridge handlers
│   │   └── draft-store.ts           Ephemeral draft session state
│   └── workers/
│       └── ml-worker.ts             ONNX inference worker thread
│
├── preload/                Context-isolated preload scripts
│   ├── control-panel.ts    Exposes electronApi + zubridge to control panel
│   └── overlay.ts          Exposes electronApi + zubridge to overlay
│
├── renderer/
│   ├── control-panel/      Main app window (React SPA)
│   │   └── src/
│   │       ├── App.tsx             Root component, page routing
│   │       ├── components/         UI components (app-shell, sidebar, settings cards, data tables)
│   │       ├── pages/              7 pages (dashboard, abilities, heroes, scraping, settings, mapper, dev-mapper)
│   │       ├── hooks/              useAppStore, useDispatch, useSettings, useIpcQuery
│   │       └── i18n/               i18next setup, 6 namespaces × 2 languages (EN/RU)
│   └── overlay/            Game overlay window (transparent, click-through)
│       └── src/
│           ├── App.tsx             Root component, overlay composition
│           ├── components/         ControlsPanel, HotspotLayer, Tooltip, CombinationPanel, etc.
│           └── hooks/              useOverlayData, useMousePassthrough, useAppStore
│
└── shared/                 Types and constants for all processes
    ├── ipc/
    │   ├── channels.ts     Channel name constants (domain:action pattern)
    │   └── api.ts          Typed IPC maps (IpcInvokeMap, IpcSendMap, IpcOnMap)
    └── types/              Shared type definitions (app-store, ML, overlay payload)
```

## Startup Sequence

`src/main/index.ts` runs the following on `app.whenReady()`:

1. Initialize electron-log (file: 10MB max, console: debug)
2. Register global error handlers (`uncaughtException`, `unhandledRejection`)
3. Initialize Sentry crash reporting (no-op if DSN unconfigured)
4. Initialize database (sql.js loads `.db` into memory, Drizzle wraps it)
5. Create startup backup (skipped on first run)
6. Create all services (window manager, ML, layout, screenshot, scraper, window tracker, updater)
7. Create AppStore (Zustand) + @zubridge bridge for cross-process state sync
8. Load persisted settings (theme, language) into AppStore
9. Register all IPC handlers
10. Create control panel window, subscribe to @zubridge
11. Auto-initialize ML worker in background (non-blocking)

## State Management

Two state systems coexist:

### AppStore (@zubridge)

Reactive UI state synced automatically to both renderers. Main process is the single source of truth.

```
Main: appStore.setState({ mlStatus: 'success' })
  → @zubridge pushes to all subscribed windows
  → Renderer: useAppStore(s => s.mlStatus) auto-updates
```

**State shape**: theme mode, resolved dark mode, language, overlay active, active resolution, ML status/error, scraper status, update status.

**Dispatch pattern**: Renderers send `dispatch({ type: APP_ACTIONS.THEME_SET_MODE, payload: 'dark' })`. Main process handler calls `appStore.setState()`.

### DraftStore (main-process only)

Ephemeral draft session state. Not synced to renderers -- read via IPC when needed.

**State**: initial pool cache (from first scan), identified hero models, My Spot selection, My Model selection.

### Typed IPC (data queries)

Request/response pattern for data that doesn't need reactive updates:

```
Renderer: await window.electronApi.invoke('hero:getAll')
  → ipcMain.handle('hero:getAll', () => heroRepo.findAll())
  → Returns Hero[]
```

## IPC Architecture

### Channel Naming

All channels follow the `domain:action` pattern. Domains: `hero`, `ability`, `draft`, `settings`, `scraper`, `ml`, `resolution`, `app`, `overlay`, `theme`, `i18n`, `feedback`, `backup`.

### Three Channel Types

| Type | Direction | Pattern | Use Case |
|------|-----------|---------|----------|
| `invoke` | Renderer → Main (awaitable) | `ipcMain.handle()` + `ipcRenderer.invoke()` | Data queries, operations with return values |
| `send` | Renderer → Main (fire-and-forget) | `ipcMain.on()` + `ipcRenderer.send()` | Triggers, notifications, state changes |
| `on` | Main → Renderer (push) | `webContents.send()` + `ipcRenderer.on()` | Events, status updates, scan results |

### Type Safety

All channels are typed in `src/shared/ipc/api.ts` via three TypeScript maps (`IpcInvokeMap`, `IpcSendMap`, `IpcOnMap`). The preload scripts expose a typed `ElectronApi` interface via `contextBridge`, giving renderers full type safety without direct Node.js access.

## Scan Pipeline

The core data flow during a draft:

```
1. User clicks "Scan" in overlay
   → overlay:  ml:scan IPC send

2. Main receives ml:scan
   → screenshotService.capture() → raw PNG buffer
   → layoutService.getLayout(resolution) → slot coordinates
   → Crop screenshot to game window bounds (windowed mode)
   → mlService.scan(buffer, layout, threshold, isInitialScan)

3. ML Worker receives scan message
   → preprocessing.extractSlots(buffer, layout) → 96×96 slot images
   → onnxClassifier.classifyBatch(slots) → class probabilities
   → Filter by confidence threshold (0.9) → ScanResult[]
   → postMessage back to main

4. Main receives results
   → scanProcessingService.processResults(results)
     → processScanResults() (14-phase pipeline in src/core/domain/)
       Phase 1:  Branch initial vs rescan
       Phase 2:  Collect ability names
       Phase 3:  Batch DB lookup (ability details, settings)
       Phase 4:  Build heroes-in-pool set
       Phase 5:  Per-ability synergy enrichment
       Phase 6:  Per-ability hero synergies
       Phase 7:  Per-hero-model ability synergies
       Phase 8:  OP/Trap combination filtering
       Phase 8.5: Triplet enrichment (suggested third ability)
       Phase 9:  My Spot synergistic partners
       Phase 10: Score all entities (consolidated score)
       Phase 11: Check ultimate already picked
       Phase 12: Top-tier selection (max 10)
       Phase 13: Enrich scan slots with computed data
       Phase 14: Assemble OverlayDataPayload
   → Update DraftStore
   → Broadcast overlay:data to overlay window

5. Overlay receives overlay:data
   → useOverlayData hook updates state
   → Components re-render with tooltips, panels, recommendations
```

### Scoring Formula

```
consolidatedScore = 0.4 * normalizedWinrate + 0.6 * normalizedPickOrder
```

- `winrate`: float [0, 1] from DB (0.55 = 55%). Normalized by mapping observed range to [0, 1].
- `pickRate`: average pick position (lower = picked earlier = better). Inverted and normalized so earlier picks score higher.
- Missing values default to 0.5 (neutral).

## ML Model

- **Architecture**: MobileNetV2 (transfer learning)
- **Input**: `[batch, 96, 96, 3]` float32 images (RGB, normalized to [0, 1])
- **Output**: `[batch, 524]` class probabilities (524 ability classes)
- **Quantization**: INT8 (ONNX opset 18) for reduced memory and faster inference
- **Execution provider**: DirectML (GPU) with CPU fallback
- **Confidence threshold**: 0.9 (90%) -- below this, classification returns null
- **Worker management**: Max 3 auto-restart attempts with 5-second cooldown. 30-second init timeout, 10-second scan timeout.

## Resolution System

### Layout Cascade (priority order)

1. **Custom layouts** -- user-calibrated via mapper wizard, saved to `%APPDATA%/custom_layouts.json`
2. **Preset layouts** -- bundled in `resources/config/layout_coordinates.json` (28 resolutions)
3. **Auto-scaled** -- mathematically scaled from the nearest base resolution

### Auto-Scaling Formula

```
scaleFactor = targetHeight / baseHeight
horizontalOffset = (targetWidth - baseWidth * scaleFactor) / 2
```

Base resolutions per aspect ratio family:
- **4:3** (ratio 1.2-1.55): 1920x1440
- **16:10** (ratio 1.55-1.7): 1920x1200
- **16:9** (ratio 1.7-2.1): 1920x1080
- **21:9** (ratio >= 2.1): 3440x1440

### DPI Handling

`layoutService.getScaleFactor()` returns `screen.getPrimaryDisplay().scaleFactor` (DPI scale, e.g. 1.25 for 125%). This is NOT the resolution scale factor. Layout coordinates in JSON are physical pixels matching screenshot coordinates. The DPI scale factor is used by the overlay CSS to convert physical pixels to logical pixels for correct positioning.

## Overlay Click-Through

The overlay window uses a multi-layered approach for click-through:

1. **OS-level**: `setIgnoreMouseEvents(true, { forward: true })` makes the entire window transparent to mouse events, forwarding them to the game underneath
2. **CSS-level**: `pointer-events: none` on body, `pointer-events: auto` on interactive elements (buttons, tooltips, panels)
3. **Toggle mechanism**: When the mouse enters an interactive element, the `useMousePassthrough` hook sends `overlay:setMouseIgnore { ignore: false }` to temporarily disable click-through. On mouse leave, re-enables with `{ ignore: true, forward: true }`.

**Windows-specific fixes**:
- Overlay width is shrunk by 1px to prevent Windows from treating it as a fullscreen window (which breaks mouse event forwarding)
- Window uses `showInactive()` instead of `show()` to avoid stealing focus from the game

## Scraping Pipeline

### Windrun.io (Production)

```
Phase 1: Fetch abilities + heroes from api.windrun.io/api/v2/
  → /static/abilities, /static/heroes (ID mapping)
  → /abilities, /ability-high-skill (stats)
  → /heroes (hero stats)
  → Transform and upsert into Heroes + Abilities tables

Phase 2: Fetch synergy pairs
  → /ability-pairs (ability-ability synergies)
  → Transform and insert into AbilitySynergies + HeroAbilitySynergies tables

Phase 3: Fetch triplets
  → /ability-triplets (3-ability combinations)
  → Transform and insert into AbilityTriplets + HeroAbilityTriplets tables
```

After scraping, the staleness detector compares scraped ability names against the ML model's `class_names.json` to identify missing/renamed abilities.

### Liquipedia (Dev-mode only)

Enriches ability metadata (`ability_order`, `is_ultimate`) by scraping Liquipedia wiki pages with Cheerio HTML parsing. Gated behind `app.isPackaged` check.

## Database

### Engine

sql.js (SQLite compiled to WASM) running entirely in-memory. No native modules, no node-gyp, no electron-rebuild. Database is loaded from file on startup and persisted back to file via explicit `persist()` calls.

**Location**: `%APPDATA%/ability-draft-plus/dota_ad_data.db`
**Seed**: `resources/dota_ad_data.db` (bundled, copied on first run)

### Schema (7 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| Heroes | Hero stats | heroId (PK), name, displayName, winrate, pickRate |
| Abilities | Ability stats | abilityId (PK), name, heroId (FK), winrate, pickRate, isUltimate, abilityOrder |
| AbilitySynergies | Ability pair winrates | baseAbilityId + synergyAbilityId (unique), synergyWinrate, synergyIncrease |
| HeroAbilitySynergies | Hero-ability synergies | heroId + abilityId (unique), synergyWinrate, synergyIncrease |
| AbilityTriplets | 3-ability combinations | abilityIdOne/Two/Three (unique), synergyWinrate, numPicks |
| HeroAbilityTriplets | Hero + 2 abilities | heroId + abilityIdOne/Two (unique), synergyWinrate, numPicks |
| Metadata | Key-value settings | key (PK), value (JSON-serialized) |

### Repository Pattern

Each table has a repository in `src/core/database/repositories/` providing domain-specific query methods. Repositories accept a `SQLJsDatabase` instance (Drizzle-wrapped) and have zero Electron imports, making them testable with in-memory databases.

## Testing Strategy

- **Unit tests** (Vitest): Core domain logic, database repositories, ML preprocessing, resolution scaling, scraper transforms. Use in-memory sql.js databases and mock data.
- **Component tests** (jsdom + @testing-library/react): Overlay hooks, renderer state management. Use `// @vitest-environment jsdom` pragma per test file.
- **E2E smoke test** (Playwright): Launches the full Electron app and verifies the control panel window opens.
- **381 total tests** across 26 test files in `tests/unit/`.

## Build Configuration

### electron-vite (3 targets)

| Target | Entry | Output | Notes |
|--------|-------|--------|-------|
| main | `src/main/index.ts` + `workers/ml-worker.ts` | CJS | electron-log bundled; drizzle-orm, sql.js, onnxruntime-node, sharp, screenshot-desktop, koffi externalized |
| preload | `src/preload/control-panel.ts` + `overlay.ts` | CJS | Sandboxed context |
| renderer | `control-panel/index.html` + `overlay/index.html` | ESM | React + Tailwind CSS v4 plugin |

### Path Aliases

| Alias | Target |
|-------|--------|
| `@core` | `src/core/` |
| `@shared` | `src/shared/` |
| `@` | `src/renderer/control-panel/src/` |
| `@overlay` | `src/renderer/overlay/src/` |
| `@renderer` | `src/renderer/` |

### electron-builder

- **Installer**: NSIS (Windows) with custom install directory option
- **Formats**: NSIS installer + portable
- **ASAR unpacking**: `sharp` and `onnxruntime-node` (native modules need filesystem access)
- **Auto-update**: GitHub Releases provider
- **Architecture**: x64 only

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| sql.js (WASM) over better-sqlite3 | No native module compilation. No node-gyp, no electron-rebuild. Works identically in all environments. |
| ONNX Runtime over TensorFlow.js | ~50% less memory, DirectML GPU support, INT8 quantization support |
| @zubridge over custom IPC | Automatic state sync between processes. Zustand-native API. Reduces IPC boilerplate. |
| Worker thread over UtilityProcess | Better debugging support in development. Same isolation guarantees. |
| Domain layer (src/core/) with no Electron imports | Testable with plain Vitest, no Electron test harness needed. Clean dependency boundaries. |
| koffi FFI over node-ffi-napi | Actively maintained, better TypeScript support, no native compilation needed. |
| Windrun.io API over web scraping | JSON endpoints are faster, more reliable, and don't require headless browsers. |
| i18next over react-intl | Simpler API, namespace support, TypeScript module augmentation for type-safe translations. |
