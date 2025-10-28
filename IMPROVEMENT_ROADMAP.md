# Improvement Roadmap

This document tracks planned improvements, technical debt, and future features
for **ability-draft-plus**. Items are organized by priority and phase.

## Table of Contents

1. [Current Status](#current-status)
2. [Phase 1: Testing Infrastructure (High Priority)](#phase-1-testing-infrastructure-high-priority)
3. [Phase 2: Code Quality & Tooling (High Priority)](#phase-2-code-quality--tooling-high-priority)
4. [Phase 3: Error Handling & Reliability (Medium Priority)](#phase-3-error-handling--reliability-medium-priority)
5. [Phase 4: Performance & Maintenance (Medium Priority)](#phase-4-performance--maintenance-medium-priority)
6. [Phase 5: Developer Experience (Low Priority)](#phase-5-developer-experience-low-priority)
7. [Future Features (Backlog)](#future-features-backlog)
8. [Technical Debt](#technical-debt)
9. [Known Issues](#known-issues)

---

## Current Status

**Project Version:** 1.1.1 **Branch:** new-resolutions **Last Major Update:**
Auto-updater cleanup and TensorFlow.js fix

**Recent Accomplishments:**

- ✅ Auto-update mechanism implemented
- ✅ Russian localization added
- ✅ Worker thread architecture for ML inference
- ✅ Resolution support expanded (19 resolutions)
- ✅ Automatic resolution identifier
- ✅ Failed recognition feedback system

**Current Gaps:**

- ❌ No automated testing
- ❌ Incomplete localizations (4 TODOs in renderer.js)
- ❌ Limited error recovery mechanisms
- ❌ No CI/CD pipeline
- ❌ Platform support limited to Windows

---

## Phase 1: Testing Infrastructure (High Priority)

**Goal:** Establish comprehensive testing infrastructure to prevent regressions
and enable confident refactoring.

**Estimated Duration:** 1-2 weeks

### 1.1 Unit Testing Setup

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install Jest and configure for Electron environment
    ```bash
    npm install --save-dev jest @types/jest
    npm install --save-dev @jest/globals
    ```
- [ ] Configure Jest for Node.js environment (main process)
- [ ] Add test scripts to package.json
    ```json
    {
        "scripts": {
            "test": "jest",
            "test:watch": "jest --watch",
            "test:coverage": "jest --coverage"
        }
    }
    ```
- [ ] Create `jest.config.js` with appropriate settings
- [ ] Set up test directory structure: `tests/unit/`

**Resources Needed:**

- Jest documentation: https://jestjs.io/docs/getting-started
- Electron testing guide:
  https://www.electronjs.org/docs/latest/tutorial/automated-testing

---

### 1.2 Unit Tests for Critical Modules

**Status:** 🔴 Not Started

**Priority Modules:**

#### Database Queries (`src/database/queries.js`)

- [ ] Test `getAllHeroes()` - Verify returns all heroes
- [ ] Test `getHeroDetailsById()` - Test valid/invalid IDs
- [ ] Test `getHeroDetailsByAbilityName()` - Test valid/invalid ability names
- [ ] Test `getAbilityDetails()` - Test batch queries
- [ ] Test `getAbilitiesByHeroId()` - Test valid/invalid hero IDs
- [ ] Test `getHighWinrateCombinations()` - Test synergy filtering
- [ ] Test `getOPCombinationsInPool()` - Test OP detection
- [ ] Test `getAllOPCombinations()` - Verify all OP combos returned
- [ ] Mock database for tests (use in-memory SQLite)

**Test Coverage Target:** 80%+

#### State Manager (`src/main/stateManager.js`)

- [ ] Test `getState()` - Returns complete state object
- [ ] Test `get(key)` - Returns specific value
- [ ] Test `updateState(updates)` - Merges updates correctly
- [ ] Test `resetState(keys)` - Resets to default values
- [ ] Test state immutability (no external mutations)
- [ ] Test invalid key handling

**Test Coverage Target:** 90%+

#### Scan Processor (`src/main/scanProcessor.js`)

- [ ] Test ability enrichment with database data
- [ ] Test synergy calculation
- [ ] Test hero model identification
- [ ] Test "Top Tier" suggestion logic
- [ ] Test OP combination detection
- [ ] Test score calculation (40% winrate, 60% pick order)
- [ ] Test filtering of already-picked abilities
- [ ] Mock database queries for tests

**Test Coverage Target:** 70%+

#### IPC Handlers

- [ ] Test `appContextHandlers.js` - All handlers
- [ ] Test `dataHandlers.js` - Data operations
- [ ] Test `overlayHandlers.js` - Scan and overlay control
- [ ] Test `feedbackHandlers.js` - Snapshot and export
- [ ] Test `localizationHandlers.js` - Language switching
- [ ] Mock IPC events and window objects

**Test Coverage Target:** 70%+

---

### 1.3 E2E Testing Setup (Main Menu Only)

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install Playwright for Electron
    ```bash
    npm install --save-dev @playwright/test
    npx playwright install
    ```
- [ ] Create E2E test configuration
- [ ] Set up test directory structure: `tests/e2e/`
- [ ] Configure test fixtures for Electron app launch

**E2E Test Cases (Main Menu):**

- [ ] App launches successfully
- [ ] Main window displays all UI elements
- [ ] Theme switching works (light/dark/system)
- [ ] Language switching works (English/Russian)
- [ ] Resolution selector populates correctly
- [ ] "Update Data" button triggers scraping (mock network)
- [ ] "Activate Overlay" button shows overlay window
- [ ] "Check for Updates" button works (mock update server)
- [ ] Settings persist after app restart
- [ ] Export/Upload feedback buttons work

**Note:** Overlay E2E tests deferred until Phase 5 (requires mock data
generation).

**Test Coverage Target:** Main menu interactions only (Phase 1)

---

### 1.4 Test Coverage Reporting

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Configure Jest coverage reporting
- [ ] Add coverage thresholds to jest.config.js
    ```javascript
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 60,
            lines: 60,
            statements: 60
        }
    }
    ```
- [ ] Generate HTML coverage reports
- [ ] Add coverage badge to README (optional)

---

### 1.5 CI/CD Setup

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create `.github/workflows/test.yml`
- [ ] Configure GitHub Actions for automated testing
    - Run unit tests on every push
    - Run E2E tests on pull requests
    - Generate and upload coverage reports
- [ ] Add status badges to README
- [ ] Configure branch protection (require tests to pass)

**Example Workflow:**

```yaml
name: Tests

on: [push, pull_request]

jobs:
    test:
        runs-on: windows-latest
        steps:
            - uses: actions/checkout@v3
            - uses: actions/setup-node@v3
              with:
                  node-version: '20'
            - run: npm install
            - run: npm test
            - run: npm run test:e2e
```

---

## Phase 2: Code Quality & Tooling (High Priority)

**Goal:** Establish code quality standards and automated enforcement.

**Estimated Duration:** 1 week

### 2.1 ESLint Configuration

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install ESLint and plugins
    ```bash
    npm install --save-dev eslint
    npm install --save-dev eslint-plugin-node
    ```
- [ ] Create `.eslintrc.js` with recommended rules
- [ ] Add ESLint scripts to package.json
    ```json
    {
        "scripts": {
            "lint": "eslint .",
            "lint:fix": "eslint . --fix"
        }
    }
    ```
- [ ] Configure ESLint for Electron environment
- [ ] Fix existing linting issues
- [ ] Add `.eslintignore` for node_modules, dist, etc.

**Recommended Rules:**

- `no-unused-vars`: error
- `no-console`: warn (allow console.error/warn)
- `prefer-const`: error
- `no-var`: error
- `eqeqeq`: error
- `curly`: error

---

### 2.2 Prettier Configuration

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install Prettier
    ```bash
    npm install --save-dev prettier
    ```
- [ ] Create `.prettierrc.js` with formatting rules
    ```javascript
    module.exports = {
        semi: true,
        trailingComma: 'es5',
        singleQuote: true,
        printWidth: 100,
        tabWidth: 4
    };
    ```
- [ ] Add Prettier scripts to package.json
    ```json
    {
        "scripts": {
            "format": "prettier --write .",
            "format:check": "prettier --check ."
        }
    }
    ```
- [ ] Configure Prettier + ESLint integration
    ```bash
    npm install --save-dev eslint-config-prettier
    ```
- [ ] Format entire codebase
- [ ] Add `.prettierignore`

---

### 2.3 Husky Pre-commit Hooks

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install Husky and lint-staged
    ```bash
    npm install --save-dev husky lint-staged
    npx husky install
    ```
- [ ] Configure pre-commit hook
    ```bash
    npx husky add .husky/pre-commit "npx lint-staged"
    ```
- [ ] Configure lint-staged in package.json
    ```json
    {
        "lint-staged": {
            "*.js": ["eslint --fix", "prettier --write"],
            "*.{json,md,css,html}": ["prettier --write"]
        }
    }
    ```
- [ ] Add pre-push hook for tests (optional)
- [ ] Document hook setup in DEVELOPER_GUIDE.md

---

### 2.4 Complete TODO Localizations

**Status:** 🔴 Not Started

**Location:** `renderer.js` (4 instances)

**Tasks:**

- [ ] Line 103: Localize "Failed to get supported resolutions" error
- [ ] Line 190: Localize complex export samples message
- [ ] Line 248: Localize complex upload samples message
- [ ] Line 387: Localize snapshot error message

**Process:**

1. Add translation keys to `locales/en.json` and `locales/ru.json`
2. Update renderer.js to use translation strings
3. Test all error scenarios to verify translations display correctly

**Example:**

```javascript
// Before
showError('Failed to get supported resolutions. Please restart the app.');

// After
showError(translations['error.resolutions_failed']);
```

---

### 2.5 Input Validation Layer

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create `src/main/validators.js` module
- [ ] Add validation functions:
    - `validateResolution(resolution)` - Check format and supported list
    - `validateHeroId(heroId)` - Check type and range
    - `validateAbilityName(name)` - Check type and format
    - `validateLanguageCode(lang)` - Check against supported languages
    - `validateFilePath(path)` - Sanitize and check for path traversal
- [ ] Apply validators to all IPC handlers
- [ ] Add error responses for invalid inputs
- [ ] Log validation failures for debugging

**Example:**

```javascript
// src/main/validators.js
function validateResolution(resolution) {
    if (typeof resolution !== 'string') {
        return { valid: false, error: 'Resolution must be a string' };
    }
    if (!/^\d+x\d+$/.test(resolution)) {
        return { valid: false, error: 'Invalid resolution format' };
    }
    const supported = getSupportedResolutions();
    if (!supported.includes(resolution)) {
        return { valid: false, error: 'Unsupported resolution' };
    }
    return { valid: true };
}

// IPC Handler
ipcMain.handle('activate-overlay', async (event, resolution) => {
    const validation = validateResolution(resolution);
    if (!validation.valid) {
        console.error('Invalid resolution:', validation.error);
        return { success: false, error: validation.error };
    }
    // ... proceed with activation
});
```

---

## Phase 3: Error Handling & Reliability (Medium Priority)

**Goal:** Improve application stability and error recovery.

**Estimated Duration:** 1-2 weeks

### 3.1 Structured Logging System

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install Winston logging library
    ```bash
    npm install --save winston
    ```
- [ ] Create `src/main/logger.js` module
- [ ] Configure log levels: DEBUG, INFO, WARN, ERROR
- [ ] Set up file logging with rotation
    - Location: `app.getPath('logs')/ability-draft-plus.log`
    - Rotation: Keep last 7 days
- [ ] Create separate log files for main/renderer/worker
- [ ] Replace all `console.log` with structured logging
- [ ] Add contextual information to logs (timestamp, module, process)

**Example:**

```javascript
// src/main/logger.js
const winston = require('winston');
const path = require('path');
const { app } = require('electron');

const logger = winston.createLogger({
    level: process.env.DEBUG === 'true' ? 'debug' : 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(app.getPath('logs'), 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(app.getPath('logs'), 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(
        new winston.transports.Console({
            format: winston.format.simple()
        })
    );
}

module.exports = logger;
```

---

### 3.2 ML Worker Auto-Restart

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Implement worker health check mechanism
- [ ] Add worker restart logic in `src/main/mlManager.js`
- [ ] Notify user when worker restarts
- [ ] Retry failed predictions after restart
- [ ] Add maximum restart attempts (e.g., 3 times)
- [ ] Graceful degradation if worker fails permanently

**Example:**

```javascript
// src/main/mlManager.js
let workerRestartCount = 0;
const MAX_RESTART_ATTEMPTS = 3;

function restartWorker() {
    if (workerRestartCount >= MAX_RESTART_ATTEMPTS) {
        logger.error('ML Worker failed permanently after max restart attempts');
        notifyUser('ML recognition unavailable. Please restart the app.');
        return false;
    }

    workerRestartCount++;
    logger.warn(
        `Restarting ML Worker (attempt ${workerRestartCount}/${MAX_RESTART_ATTEMPTS})`
    );

    if (mlWorker) {
        mlWorker.terminate();
    }

    mlWorker = new Worker('./src/ml.worker.js');
    setupWorkerHandlers();
    return true;
}

mlWorker.on('error', (error) => {
    logger.error('ML Worker error:', error);
    restartWorker();
});
```

---

### 3.3 Database Backup & Restore

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create `src/main/databaseBackup.js` module
- [ ] Implement automatic backup before updates
    - Location: `app.getPath('userData')/backups/`
    - Keep last 3 backups
- [ ] Add manual backup/restore UI in settings
- [ ] Implement restore from backup on corruption
- [ ] Add database integrity check on startup

**Example:**

```javascript
// src/main/databaseBackup.js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function backupDatabase() {
    const dbPath = getDatabasePath();
    const backupDir = path.join(app.getPath('userData'), 'backups');
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupPath = path.join(backupDir, `ability_draft_${timestamp}.db`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.copyFileSync(dbPath, backupPath);
    logger.info(`Database backed up to: ${backupPath}`);

    // Clean old backups (keep last 3)
    cleanOldBackups(backupDir, 3);
}
```

---

### 3.4 Graceful Degradation

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Handle ML model loading failure
    - Show error message to user
    - Offer manual scan fallback (user inputs ability names)
    - Suggest re-downloading app or checking model files
- [ ] Handle database query failures
    - Cache last successful query results
    - Use cached data when database unavailable
    - Notify user of stale data
- [ ] Handle network failures during scraping
    - Retry with exponential backoff
    - Show clear error messages
    - Allow user to retry manually

---

### 3.5 Error Recovery Suggestions

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create user-friendly error messages with recovery steps
- [ ] Add "What to do" suggestions for common errors
- [ ] Implement error reporting mechanism (optional)
- [ ] Add troubleshooting section to UI

**Example Error Messages:**

```javascript
// Instead of: "Failed to load model"
// Show:
{
    title: "ML Model Failed to Load",
    message: "The ability recognition model could not be loaded.",
    suggestions: [
        "Restart the application",
        "Verify model files exist in: [path]",
        "Re-download the application from GitHub",
        "Check antivirus is not blocking model files"
    ],
    actions: [
        { label: "Restart App", action: () => app.relaunch() },
        { label: "Open Model Folder", action: () => shell.openPath(modelPath) }
    ]
}
```

---

## Phase 4: Performance & Maintenance (Medium Priority)

**Goal:** Optimize performance and maintainability.

**Estimated Duration:** 1 week

### 4.1 Centralize Configuration Constants

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create `src/constants.js` module
- [ ] Move all magic numbers to constants:
    - ML confidence threshold (currently 0.90)
    - Scan timeouts
    - Worker thread timeouts
    - Database connection timeouts
    - Cache sizes
    - Retry attempts
    - Score weights (40% winrate, 60% pick order)
- [ ] Document each constant with comments
- [ ] Replace hardcoded values throughout codebase

**Example:**

```javascript
// src/constants.js
module.exports = {
    // ML Configuration
    ML_CONFIDENCE_THRESHOLD: 0.9,
    ML_MODEL_WARMUP_TIMEOUT: 10000, // 10 seconds
    ML_PREDICTION_TIMEOUT: 30000, // 30 seconds

    // Scan Configuration
    SCAN_TIMEOUT: 60000, // 60 seconds
    SCAN_RETRY_ATTEMPTS: 3,

    // Score Calculation
    SCORE_WINRATE_WEIGHT: 0.4,
    SCORE_PICK_ORDER_WEIGHT: 0.6,

    // Database
    DB_CONNECTION_TIMEOUT: 5000, // 5 seconds
    DB_BACKUP_RETENTION: 3, // Keep 3 backups

    // Cache
    STATE_CACHE_MAX_SIZE: 100, // Max cached states
    SCAN_RESULT_CACHE_TTL: 300000 // 5 minutes
};
```

---

### 4.2 Memory Usage Monitoring

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Add memory usage logging
- [ ] Monitor tensor allocations in ML worker
- [ ] Add memory usage display in debug mode
- [ ] Implement memory usage warnings
- [ ] Add periodic garbage collection triggers

**Example:**

```javascript
// Log memory usage periodically
setInterval(() => {
    const usage = process.memoryUsage();
    logger.debug('Memory usage:', {
        rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
        external: `${Math.round(usage.external / 1024 / 1024)} MB`
    });

    // Warn if memory usage is high
    if (usage.heapUsed > 500 * 1024 * 1024) {
        // 500 MB
        logger.warn('High memory usage detected');
    }
}, 60000); // Every minute
```

---

### 4.3 Cache Management

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Implement cache size limits in state manager
- [ ] Add cache eviction policy (LRU)
- [ ] Clear screenshot buffers after processing
- [ ] Add periodic cache cleanup
- [ ] Implement cache statistics logging

**Example:**

```javascript
// src/main/cache.js
class LRUCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    set(key, value) {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        // Delete and re-add to move to end (most recent)
        this.cache.delete(key);
        this.cache.set(key, value);
    }

    get(key) {
        if (!this.cache.has(key)) return null;

        // Move to end (most recent)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
}
```

---

### 4.4 Performance Metrics Tracking

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create `src/main/metrics.js` module
- [ ] Track operation durations:
    - Scan duration (total and breakdown)
    - ML inference time
    - Database query time
    - Scraping duration
- [ ] Log metrics in structured format
- [ ] Add metrics display in debug mode
- [ ] Identify performance bottlenecks

**Example:**

```javascript
// src/main/metrics.js
class PerformanceMetrics {
    constructor() {
        this.metrics = new Map();
    }

    startTimer(operation) {
        this.metrics.set(operation, Date.now());
    }

    endTimer(operation) {
        const startTime = this.metrics.get(operation);
        if (!startTime) return null;

        const duration = Date.now() - startTime;
        this.metrics.delete(operation);

        logger.info(`${operation} completed in ${duration}ms`);
        return duration;
    }
}

// Usage
metrics.startTimer('scan');
await performScan();
metrics.endTimer('scan');
```

---

### 4.5 Debug Mode

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Create comprehensive debug mode
- [ ] Add debug menu to main window (when DEBUG=true)
- [ ] Show performance metrics
- [ ] Show memory usage
- [ ] Show cache statistics
- [ ] Show ML model info
- [ ] Show database statistics
- [ ] Add debug log export function

---

## Phase 5: Developer Experience (Low Priority)

**Goal:** Improve developer productivity and onboarding.

**Estimated Duration:** Ongoing

### 5.1 Mock Data Generators

**Status:** 🔴 Not Started

**Purpose:** Enable overlay E2E testing without game/ML

**Tasks:**

- [ ] Create `tests/mocks/scanResultGenerator.js`
- [ ] Generate realistic scan results:
    - Random ability pool (84 abilities)
    - Hero models (12 heroes)
    - Selected abilities (variable)
    - Synergies
    - OP combinations
- [ ] Create mock database with test data
- [ ] Add mock mode to overlay for testing
- [ ] Document mock data usage in DEVELOPER_GUIDE.md

**Example:**

```javascript
// tests/mocks/scanResultGenerator.js
function generateMockScanResult() {
    return {
        abilityPool: generateRandomAbilities(84),
        heroModels: generateRandomHeroes(12),
        selectedAbilities: [],
        synergies: [],
        opCombinations: []
    };
}

function generateRandomAbilities(count) {
    const abilities = getAllAbilities(); // From mock DB
    return sampleRandom(abilities, count);
}
```

---

### 5.2 Hot Reload for Development

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Install electron-reload or electron-reloader
    ```bash
    npm install --save-dev electron-reload
    ```
- [ ] Configure hot reload for renderer process
- [ ] Configure automatic restart for main process changes
- [ ] Document in DEVELOPER_GUIDE.md

**Example:**

```javascript
// main.js (development only)
if (process.env.NODE_ENV !== 'production') {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit'
    });
}
```

---

### 5.3 Improve Build Scripts Documentation

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Document all npm scripts in DEVELOPER_GUIDE.md
- [ ] Add inline comments to build scripts
- [ ] Create troubleshooting section for build issues
- [ ] Document native module rebuild process

---

### 5.4 TypeScript Migration Assessment

**Status:** 🔴 Not Started

**Tasks:**

- [ ] Evaluate benefits of TypeScript migration
- [ ] Estimate migration effort
- [ ] Create migration plan (if proceeding)
- [ ] Start with small modules (e.g., types, interfaces)
- [ ] Gradual migration with JS + TS coexistence

**Benefits:**

- Type safety reduces runtime errors
- Better IDE autocomplete and refactoring
- Improved documentation through types
- Easier onboarding for new developers

**Challenges:**

- Time investment for migration
- Learning curve for team
- Build complexity increases
- Potential issues with native modules

---

## Future Features (Backlog)

### 6.1 Platform Expansion

**Status:** 🔴 Not Started

**Tasks:**

- [ ] macOS support
    - Test screen capture on macOS
    - Build for macOS (electron-builder)
    - Test native modules on macOS
    - Create macOS-specific layout coordinates
- [ ] Linux support
    - Similar process as macOS
    - Handle different window managers
    - Test on multiple distributions

**Estimated Effort:** 2-3 weeks per platform

---

### 6.2 Draft History Tracking

**Status:** 🔴 Not Started

**Features:**

- Track each draft session:
    - Date/time
    - Selected hero and abilities
    - Draft outcome (win/loss - manual input)
    - Opponents' picks (if visible)
- View past drafts
- Analyze personal success rates with specific abilities/synergies
- Export draft history

**Database Schema:**

```sql
CREATE TABLE DraftSessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    selected_hero_id INTEGER,
    outcome TEXT, -- 'win', 'loss', 'unknown'
    notes TEXT
);

CREATE TABLE DraftAbilitySelections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    ability_name TEXT,
    pick_order INTEGER,
    FOREIGN KEY (session_id) REFERENCES DraftSessions(id)
);
```

---

### 6.3 Personal Analytics

**Status:** 🔴 Not Started

**Features:**

- Win rate by ability
- Win rate by synergy
- Most successful heroes
- Draft patterns analysis
- Recommendations based on personal history

**Requires:** Draft history tracking (6.2)

---

### 6.4 Cloud Sync

**Status:** 🔴 Not Started

**Features:**

- Sync preferences across devices
- Sync draft history
- Optional account system
- Privacy controls

**Challenges:**

- Backend infrastructure needed
- Authentication system
- Data privacy considerations
- Costs for hosting

---

### 6.5 Custom Scoring Algorithms

**Status:** 🔴 Not Started

**Features:**

- Allow users to customize scoring weights
- Custom filters (e.g., show only ultimates, hide specific heroes)
- Save custom scoring profiles
- Share scoring profiles with community

**UI:**

```
Scoring Weights:
Win Rate: [====|--] 60%
Pick Order: [==|----] 40%
Personal History: [===|---] 50% (requires draft history)

Filters:
☐ Show only ultimates
☐ Show only high-skill win rates
☑ Hide abilities from same hero
☐ Hide abilities already picked by opponents
```

---

### 6.6 Draft Recommendations Engine

**Status:** 🔴 Not Started

**Features:**

- AI-powered draft suggestions
- Consider team composition
- Counter-pick suggestions (if opponent picks visible)
- Synergy maximization
- Hero model optimization

**Requires:**

- Advanced ML model or rules engine
- Real-time game state tracking
- Opponent pick detection (if possible)

---

## Technical Debt

### Current Technical Debt Items

#### High Priority

1. **No automated testing** - Prevents confident refactoring
2. **Inconsistent error handling** - Some errors silently fail
3. **Magic numbers in code** - Makes maintenance difficult
4. **Incomplete localizations** - 4 TODO comments in renderer.js
5. **No input validation on IPC** - Security and stability risk

#### Medium Priority

6. **God objects** - stateManager and scanProcessor too large
7. **Code duplication** - Error handling patterns repeated
8. **No structured logging** - Debugging production issues is hard
9. **Tight coupling** - Some modules depend on each other circularly
10. **Memory management** - No explicit cleanup for large buffers

#### Low Priority

11. **No hot reload** - Slow development iteration
12. **Build scripts complexity** - Native module handling is fragile
13. **No CI/CD** - Manual testing and releases
14. **Limited documentation** - Some modules lack comments
15. **Windows-only** - Platform limitations

---

## Known Issues

### Active Issues

1. **TensorFlow.js Build Issues**
    - **Issue:** `tfjs_binding.node` and `tensorflow.dll` separated during build
    - **Workaround:** Custom post-install script (`fix-tfjs-node-build.js`)
    - **Status:** ✅ Workaround in place
    - **Ideal Solution:** Upstream fix in TensorFlow.js or electron-builder

2. **Database Locking**
    - **Issue:** Occasional "database is locked" errors
    - **Cause:** Multiple connections or long-running queries
    - **Status:** 🟡 Partially mitigated (try-finally in all queries)
    - **Improvement Needed:** Connection pooling or better concurrency control

3. **Screenshot Capture on Multi-Monitor**
    - **Issue:** Wrong monitor captured if game not on primary
    - **Cause:** screenshot-desktop captures primary monitor only
    - **Status:** 🔴 Known limitation
    - **Workaround:** User must move game to primary monitor
    - **Potential Solution:** Add monitor selection UI

4. **Memory Usage During Scan**
    - **Issue:** Memory spikes to 700-800 MB during inference
    - **Cause:** TensorFlow.js tensor allocations
    - **Status:** 🟡 Acceptable but could be improved
    - **Improvement:** Batch size tuning, more aggressive tensor disposal

5. **Incomplete Error Messages**
    - **Issue:** Some errors lack user-friendly messages
    - **Status:** 🔴 Ongoing issue
    - **Fix:** Part of Phase 2.4 (complete localizations)

---

## Progress Tracking

Use this section to track completion of improvement phases.

### Phase 1: Testing Infrastructure

- [ ] 1.1 Unit Testing Setup
- [ ] 1.2 Unit Tests for Critical Modules
- [ ] 1.3 E2E Testing Setup (Main Menu Only)
- [ ] 1.4 Test Coverage Reporting
- [ ] 1.5 CI/CD Setup

**Progress:** 0/5 (0%)

### Phase 2: Code Quality & Tooling

- [ ] 2.1 ESLint Configuration
- [ ] 2.2 Prettier Configuration
- [ ] 2.3 Husky Pre-commit Hooks
- [ ] 2.4 Complete TODO Localizations
- [ ] 2.5 Input Validation Layer

**Progress:** 0/5 (0%)

### Phase 3: Error Handling & Reliability

- [ ] 3.1 Structured Logging System
- [ ] 3.2 ML Worker Auto-Restart
- [ ] 3.3 Database Backup & Restore
- [ ] 3.4 Graceful Degradation
- [ ] 3.5 Error Recovery Suggestions

**Progress:** 0/5 (0%)

### Phase 4: Performance & Maintenance

- [ ] 4.1 Centralize Configuration Constants
- [ ] 4.2 Memory Usage Monitoring
- [ ] 4.3 Cache Management
- [ ] 4.4 Performance Metrics Tracking
- [ ] 4.5 Debug Mode

**Progress:** 0/5 (0%)

### Phase 5: Developer Experience

- [ ] 5.1 Mock Data Generators
- [ ] 5.2 Hot Reload for Development
- [ ] 5.3 Improve Build Scripts Documentation
- [ ] 5.4 TypeScript Migration Assessment

**Progress:** 0/4 (0%)

---

## Contributing to Improvements

If you'd like to contribute to any of these improvements:

1. Check the progress tracking above for uncompleted items
2. Create an issue on GitHub indicating which item you'd like to work on
3. Fork the repository and create a feature branch
4. Implement the improvement following the guidelines in DEVELOPER_GUIDE.md
5. Add tests for your changes (once testing infrastructure is in place)
6. Submit a pull request with a clear description

**Priority for External Contributors:**

- Phase 1 (Testing) - High impact, clear scope
- Phase 2.4 (Localizations) - Good first issue
- Phase 6 (Future Features) - Flexible and creative

---

**Document Version:** 1.0 **Last Updated:** 2025-01-XX **Maintained By:**
Development Team
