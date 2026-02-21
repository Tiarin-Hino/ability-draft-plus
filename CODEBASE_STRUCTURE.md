# Ability Draft Plus - Codebase Structure

A Dota 2 Ability Draft overlay with ML-powered ability recognition, built as an Electron desktop application.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Framework | Electron 31 |
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| ML Inference | TensorFlow.js (`@tensorflow/tfjs-node`) |
| Database | SQLite via `better-sqlite3` |
| Image Processing | `sharp`, `screenshot-desktop` |
| Web Scraping | `axios` + `cheerio` |
| Logging | `winston` |
| Auto-Update | `electron-updater` |
| Build/Package | `electron-builder` |
| Testing | Jest |
| Linting | ESLint 9+ (flat config) + Prettier |

## Directory Structure

```
ability-draft-plus/
├── .claude/                        # Claude AI tool configuration
├── .github/                        # GitHub workflows & issue templates
│   └── ISSUE_TEMPLATE/
├── .husky/                         # Git hook configurations (pre-commit)
├── build/                          # Build output artifacts
├── config/
│   └── layout_coordinates.json     # Screen resolution coordinate mappings
├── images/                         # Documentation images
├── locales/                        # i18n translation files
│   ├── en.json                     # English
│   └── ru.json                     # Russian
├── model/
│   └── tfjs_model/                 # TensorFlow.js ML model
│       ├── model.json              # Model architecture
│       ├── *.bin                    # Model weights
│       └── class_names.json        # Ability class mappings
├── resources/
│   └── images/                     # Application icons & images
├── scripts/                        # Build & utility scripts
├── src/                            # Source code
│   ├── main/                       # Electron main process modules
│   │   └── ipcHandlers/            # Modular IPC handler files
│   ├── database/                   # SQLite schema & queries
│   ├── renderer/                   # Renderer process UI modules
│   │   └── overlay/                # Overlay-specific UI logic
│   ├── scraper/                    # Web scraping modules
│   └── test/                       # Test utilities & mock data
├── main.js                         # Electron entry point
├── renderer.js                     # Main window renderer logic
├── overlayRenderer.js              # Overlay window renderer logic
├── preload.js                      # Secure IPC bridge (preload script)
├── index.html                      # Main control panel UI
├── overlay.html                    # In-game overlay UI
├── styles.css                      # Main window styles
├── overlay.css                     # Overlay styles
├── config.js                       # App configuration constants
├── package.json                    # Dependencies & build config
├── eslint.config.js                # ESLint rules
├── jest.config.js                  # Jest test configuration
└── .prettierrc.js                  # Prettier formatting rules
```

## Application Architecture

### Multi-Window Electron App

The application uses two Electron windows communicating via IPC:

```
┌──────────────────┐       IPC        ┌─────────────────────┐
│   Main Window    │◄────────────────►│    Main Process      │
│  (Control Panel) │                  │     (main.js)        │
│   renderer.js    │                  │                      │
│   index.html     │                  │  ┌────────────────┐  │
└──────────────────┘                  │  │  ML Worker      │  │
                                      │  │  (ml.worker.js) │  │
┌──────────────────┐       IPC        │  └────────────────┘  │
│  Overlay Window  │◄────────────────►│                      │
│  (In-Game HUD)   │                  │  ┌────────────────┐  │
│ overlayRenderer  │                  │  │  SQLite DB      │  │
│  overlay.html    │                  │  │  (dota_ad_data) │  │
└──────────────────┘                  │  └────────────────┘  │
                                      └─────────────────────┘
```

### Data Flow (Scan Cycle)

1. User triggers scan from overlay
2. Main process captures screenshot via `screenshot-desktop`
3. Screenshot sent to ML Worker Thread for inference
4. ML model predicts ability icons from the screenshot
5. Predictions enriched with database data (win rates, synergies)
6. Scan processor scores and ranks abilities
7. Results returned to overlay UI for display

## Source Code Details

### `src/main/` - Main Process Modules

Core application logic running in Node.js with full system access.

| File | Purpose |
|------|---------|
| `mlManager.js` | ML worker thread management with auto-restart |
| `scanProcessor.js` | Processes ML results, enriches with DB data, scoring |
| `windowManager.js` | Creates/manages main and overlay windows |
| `stateManager.js` | Centralized application state management |
| `logger.js` | Winston-based structured logging |
| `localization.js` | Translation and i18n support |
| `memoryMonitor.js` | Memory usage tracking and alerts |
| `performanceMetrics.js` | Performance monitoring |
| `cacheManager.js` | LRU cache implementation |
| `debugMode.js` | Debug utilities |
| `hotReload.js` | Development hot reload |
| `errorRecovery.js` | Error handling and recovery |
| `gracefulDegradation.js` | Graceful failure handling |
| `databaseBackup.js` | Database backup/restore |
| `dbUtils.js` | Database utilities |
| `autoUpdaterSetup.js` | electron-updater configuration |
| `utils.js` | General utilities |
| `scraper.js` | Main scraper coordinator |
| `ipcValidation.js` | IPC message validation |

### `src/main/ipcHandlers/` - Modular IPC Handlers

Each handler manages a specific area of IPC communication:

| Handler | Responsibility |
|---------|---------------|
| `appContextHandlers.js` | App lifecycle and context |
| `dataHandlers.js` | Database queries and data operations |
| `overlayHandlers.js` | Overlay-specific IPC |
| `feedbackHandlers.js` | User feedback and snapshots |
| `backupHandlers.js` | Database backup/restore |
| `localizationHandlers.js` | i18n and translations |
| `memoryHandlers.js` | Memory monitoring |
| `cacheHandlers.js` | Cache operations |
| `performanceHandlers.js` | Performance metrics |
| `debugHandlers.js` | Debug mode utilities |
| `hotReloadHandlers.js` | Hot reload during development |

### `src/database/` - Database Layer

| File | Purpose |
|------|---------|
| `setupDatabase.js` | SQLite schema creation and migrations |
| `queries.js` | Query functions (heroes, abilities, synergies) |

**Database Tables:**
- `Heroes` - Hero metadata
- `Abilities` - Ability stats (win rates, pick rates, etc.)
- `AbilitySynergies` - Ability pair synergy data
- `Metadata` - App metadata and version info

### `src/renderer/` - Renderer Process Modules

UI logic running in the browser context.

| File | Purpose |
|------|---------|
| `themeManager.js` | Light/dark theme switching |
| `translationUtils.js` | i18n translation application |
| `uiUtils.js` | UI helper functions |
| `initUtils.js` | Initialization utilities |
| `overlay/tooltip.js` | Tooltip display system |
| `overlay/hotspotManager.js` | Interactive hotspot creation |
| `overlay/buttonManager.js` | Control button management |
| `overlay/uiUpdater.js` | Dynamic UI updates |

### Root-Level Source Files

| File | Purpose |
|------|---------|
| `src/imageProcessor.js` | Screenshot capture and image processing |
| `src/ml.worker.js` | ML Worker Thread (runs TensorFlow.js inference in a separate thread) |
| `src/mlPerformanceMetrics.js` | ML-specific performance tracking |
| `src/smartScanning.js` | Intelligent scanning strategy |
| `src/screenshotCache.js` | Screenshot caching for performance |
| `src/constants.js` | Centralized configuration constants |

### `src/scraper/` - Web Scraping

| File | Purpose |
|------|---------|
| `abilityScraper.js` | Scrapes ability stats from Windrun.io |
| `abilityPairScraper.js` | Scrapes ability synergy/pair data |
| `liquipediaScraper.js` | Liquipedia data collection |

### `scripts/` - Build & Utility Scripts

| File | Purpose |
|------|---------|
| `prepare-app-config.js` | Injects environment variables at build time |
| `fix-tfjs-node-build.js` | Post-build fix for TensorFlow.js native modules |
| `complete_manual_mapper.py` | Python utility for manual coordinate mapping |
| `mapper_utils.py` | Mapping utilities |
| `test_ml_recognition.js` | ML model testing |

## Configuration

### `config.js` - Application Constants

Key configuration values:

| Setting | Value | Description |
|---------|-------|-------------|
| `ML_CONFIDENCE_THRESHOLD` | 0.9 | Minimum confidence for ML predictions |
| `NUM_TOP_TIER_SUGGESTIONS` | 10 | Number of top ability suggestions |
| Win Rate Weight | 40% | Scoring weight for win rate |
| Pick Order Weight | 60% | Scoring weight for pick order |
| ML Init Timeout | 30s | Max time for model initialization |
| Scan Timeout | 60s | Max time for a scan operation |
| DB Connection Timeout | 5s | Max time for database connection |
| Screenshot Max Size | 10 MB | Maximum screenshot file size |

### `config/layout_coordinates.json`

Pre-mapped screen coordinates for different resolutions (1920x1080, 1440x900, etc.) defining ability hotspots, hero positions, and UI element locations.

## Key Architecture Patterns

### 1. Worker Thread for ML Inference
ML inference runs in a separate Node.js Worker Thread (`ml.worker.js`) managed by `mlManager.js`, preventing the main process from blocking. Includes auto-restart with exponential backoff (max 3 attempts).

### 2. Centralized State Management
`stateManager.js` acts as a single source of truth with getters/setters for all application state, including caching for class names, layout config, and scan results.

### 3. Offline-First Design
All data is stored locally in SQLite. No constant internet connection required. Scrapers update the database on-demand from Windrun.io.

### 4. Error Recovery & Graceful Degradation
Dedicated modules (`errorRecovery.js`, `gracefulDegradation.js`) handle failures gracefully. The ML worker auto-restarts on crashes. Database backups are created on startup.

### 5. Performance Optimization
- LRU caching for queries and scan results (`cacheManager.js`)
- Screenshot caching (`screenshotCache.js`)
- Smart scanning to avoid redundant scans (`smartScanning.js`)
- Memory monitoring with threshold alerts (`memoryMonitor.js`)

### 6. Modular IPC Architecture
IPC handlers are split by responsibility into 11 separate modules, each registered with the main process. Message validation is centralized in `ipcValidation.js`.

## Build & Deployment

### NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run the application |
| `npm run dev` | Development mode with hot reload |
| `npm run dev:debug` | Development with debug mode |
| `npm run dist` | Build distributable packages |
| `npm run rebuild` | Rebuild native modules |
| `npm run prepare-config` | Prepare app configuration |
| `npm run generate-mock-data` | Generate test data |

### Build Targets

- **Windows Portable** - Single EXE executable
- **Windows NSIS Installer** - Setup wizard
- **GitHub Releases** - Auto-publish via `electron-builder`

### Native Module Dependencies

Three native modules require compilation during build:
- `@tensorflow/tfjs-node` (tfjs_binding.node)
- `better-sqlite3` (better_sqlite3.node)
- `sharp` (image processing binaries)

These are unpacked from the ASAR archive for proper loading in the packaged app.

## Testing

- **Framework**: Jest
- **Coverage Thresholds**: 60% branches/functions/lines
- **Test Utilities**: `src/test/mockDataGenerators.js`, `src/test/testHelpers.js`
- **Test Pattern**: `**/*.test.js` or `**/*.spec.js`

## Key Features

1. **Real-time ML Ability Recognition** - Trained model identifies abilities from screenshots at 90%+ confidence
2. **Statistical Insights** - Win rates, pick rates, and skill-bracket-specific stats
3. **Synergy Detection** - Ability pair recommendations, "OP Combinations" alerts, "Trap Combinations" warnings
4. **User Customization** - Select drafting hero ("My Spot"), model hero ("My Model"), configurable thresholds, theme preferences
5. **Data Management** - Local SQLite DB, scraper updates, database backups
6. **Developer Tools** - Hot reload, debug mode, mock data generation, comprehensive logging, performance metrics
