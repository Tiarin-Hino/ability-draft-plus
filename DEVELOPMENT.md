## Development Guide

Guide for developers contributing to or maintaining the Ability Draft Plus application.

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Debugging](#debugging)
- [Architecture](#architecture)
- [Best Practices](#best-practices)

## Getting Started

### Prerequisites

See [BUILD.md](BUILD.md#prerequisites) for detailed prerequisites.

Quick checklist:
- ✅ Node.js 16+
- ✅ Python 3.8+
- ✅ Visual Studio Build Tools (Windows)

### Initial Setup

\`\`\`bash
# Clone repository
git clone https://github.com/tiarin-hino/ability-draft-plus.git
cd ability-draft-plus

# Install dependencies
npm install

# Create .env file
cp .env.example .env  # Edit with your API credentials

# Start development mode
npm run dev
\`\`\`

## Project Structure

\`\`\`
ability-draft-plus/
├── src/
│   ├── main/                    # Main process modules
│   │   ├── ipcHandlers/         # IPC method handlers
│   │   ├── logger.js            # Winston logging
│   │   ├── mlManager.js         # ML worker management
│   │   ├── memoryMonitor.js     # Memory tracking
│   │   ├── cacheManager.js      # LRU cache
│   │   ├── performanceMetrics.js # Performance tracking
│   │   ├── debugMode.js         # Debug utilities
│   │   ├── hotReload.js         # Dev hot reload
│   │   └── ...
│   ├── database/                # Database setup and migrations
│   ├── scrapers/                # Web scrapers for data
│   ├── workers/                 # ML worker thread
│   └── test/                    # Test utilities and mocks
├── scripts/                     # Build and utility scripts
├── config/                      # Configuration files
├── model/                       # TensorFlow.js model
├── resources/                   # Images and assets
├── locales/                     # Internationalization
├── main.js                      # Main process entry
├── renderer.js                  # Main window renderer
├── overlay-renderer.js          # Overlay window renderer
├── preload.js                   # Main window preload
├── overlay-preload.js           # Overlay preload
└── config.js                    # App configuration
\`\`\`

### Key Directories

#### `src/main/`
Main process modules. These run in Node.js with full system access.

- **State Management**: `stateManager.js`, `windowManager.js`
- **IPC Handlers**: `ipcHandlers/` - All IPC method implementations
- **ML Integration**: `mlManager.js`, `scanProcessor.js`
- **Monitoring**: `memoryMonitor.js`, `performanceMetrics.js`, `cacheManager.js`
- **Utilities**: `logger.js`, `debugMode.js`, `hotReload.js`

#### `src/database/`
Database schema and setup.

- `setupDatabase.js` - Creates tables and indexes
- `databaseBackup.js` - Backup/restore utilities

#### `src/workers/`
Background worker threads.

- `mlWorker.js` - TensorFlow.js model inference

#### `src/test/`
Testing utilities.

- `mockDataGenerators.js` - Generate mock data
- `testHelpers.js` - Test utilities and mocks

## Development Workflow

### Day-to-Day Development

1. **Start Dev Mode**
   \`\`\`bash
   npm run dev
   \`\`\`

   This enables:
   - Hot reload (automatic reloading on file changes)
   - Fast iteration cycle

2. **Make Changes**
   - Edit source files
   - App automatically reloads

3. **Test Changes**
   - Manual testing in the app
   - Check logs: `logs/combined.log`

4. **Commit**
   \`\`\`bash
   git add .
   git commit -m "feat: Add feature X"
   \`\`\`

### Hot Reload

Hot reload watches for file changes and automatically reloads the app.

**How it works**:
- **Renderer files** (renderer.js, HTML, CSS): Reload renderers only
- **Main process files** (main.js, src/main/): Full app restart
- **500ms debounce**: Prevents reload spam

**Enable**:
\`\`\`bash
npm run dev  # Hot reload enabled
# OR
HOT_RELOAD=true npm start
\`\`\`

**Disable**:
\`\`\`bash
npm start  # Hot reload disabled
\`\`\`

**Manual control** (via IPC):
\`\`\`javascript
// In renderer
await window.api.invoke('enable-hot-reload', { debounceDelay: 1000 });
await window.api.invoke('disable-hot-reload');
await window.api.invoke('reload-renderers');  // Manual reload
\`\`\`

### Debug Mode

Debug mode provides enhanced logging and diagnostics.

**Enable**:
\`\`\`bash
npm run dev:debug  # Hot reload + debug mode
# OR
DEBUG=true npm start
\`\`\`

**Features**:
- Verbose logging (LOG_LEVEL=debug)
- Operation interception
- Performance tracking
- Memory monitoring
- Diagnostic snapshots

**Manual control** (via IPC):
\`\`\`javascript
// In renderer
await window.api.invoke('enable-debug-mode', {
  verboseLogging: true,
  operationLogging: true
});

const report = await window.api.invoke('get-debug-report');
console.log(report.report);
\`\`\`

### Environment Variables

Set in `.env` file:

\`\`\`env
# Required for production
API_ENDPOINT_URL=https://your-api.com
CLIENT_API_KEY=your-key
CLIENT_SHARED_SECRET=your-secret

# Development flags
HOT_RELOAD=true        # Enable hot reload
DEBUG=true             # Enable debug mode
LOG_LEVEL=debug        # Logging level

# Optional
NODE_ENV=development
\`\`\`

### Generating Mock Data

For testing without real data:

\`\`\`bash
npm run generate-mock-data ./test-data
\`\`\`

Creates:
- 100 abilities
- 25 heroes
- 50 ability pairs
- Scan results
- Predictions
- Test scenarios

**Use in code**:
\`\`\`javascript
const { mockGen } = require('./src/test/testHelpers');

// Generate fresh data
const abilities = mockGen.generateAbilities(20);
const scanResult = mockGen.generateScanResult({ isInitialScan: true });

// Load pre-generated
const data = mockGen.loadMockData('./test-data/abilities.json');
\`\`\`

## Code Standards

### JavaScript Style

- **ES6+ features**: Use modern JavaScript
- **Async/await**: Prefer over callbacks
- **Arrow functions**: For short functions
- **Const/let**: Never use `var`
- **Destructuring**: Use where appropriate
- **Template literals**: For string interpolation

**Example**:
\`\`\`javascript
// Good
const { data, error } = await fetchData();
if (error) {
  logger.error('Fetch failed', { error });
  return;
}

// Avoid
fetchData(function(err, data) {
  if (err) console.log(err);
});
\`\`\`

### Documentation

**JSDoc comments** for all exported functions:

\`\`\`javascript
/**
 * Generate mock ability data
 * @param {object} options - Generation options
 * @param {string} options.name - Ability name (optional)
 * @param {number} options.id - Ability ID (optional)
 * @returns {object} Mock ability object
 */
function generateAbility(options = {}) {
  // Implementation
}
\`\`\`

### Logging

Use the Winston logger, not `console.log`:

\`\`\`javascript
const { createLogger } = require('./logger');
const logger = createLogger('ModuleName');

// Different levels
logger.debug('Debug info', { details });
logger.info('Operation completed', { duration });
logger.warn('Warning occurred', { context });
logger.error('Error happened', { error: err.message, stack: err.stack });
\`\`\`

### Error Handling

Always handle errors properly:

\`\`\`javascript
// In async functions
try {
  const result = await riskyOperation();
  return { success: true, result };
} catch (error) {
  logger.error('Operation failed', { error: error.message });
  return { success: false, error: error.message };
}

// In IPC handlers
ipcMain.handle('my-operation', async (event, arg) => {
  try {
    const result = await doSomething(arg);
    return { success: true, result };
  } catch (error) {
    logger.error('IPC operation failed', { error: error.message });
    return { success: false, error: error.message };
  }
});
\`\`\`

### Constants

Use centralized constants from `src/constants.js`:

\`\`\`javascript
const {
  ML_CONFIDENCE_THRESHOLD,
  NETWORK_RETRY_MAX_ATTEMPTS
} = require('../constants');

// Don't hardcode values
if (confidence > ML_CONFIDENCE_THRESHOLD) { ... }
\`\`\`

## Testing

### Manual Testing

1. **Start dev mode**: `npm run dev`
2. **Test feature**: Use the UI to exercise the feature
3. **Check logs**: `logs/combined.log` for errors
4. **Verify behavior**: Ensure feature works as expected

### Using Mock Data

\`\`\`javascript
const { mockGen, createMockDatabase } = require('./src/test/testHelpers');

// Mock database
const db = createMockDatabase();
const abilities = db.prepare('SELECT * FROM abilities').all();

// Generate mock scan
const scan = mockGen.generateScanResult({ abilityCount: 15 });

// Simulate IPC event
const event = mockGen.generateMockIPCEvent('test-channel', { data: 'test' });
\`\`\`

### Test Utilities

\`\`\`javascript
const {
  waitFor,
  createSpy,
  measureTime,
  assert
} = require('./src/test/testHelpers');

// Wait for condition
await waitFor(() => window.isReady(), 5000);

// Spy on function calls
const spy = createSpy((arg) => console.log(arg));
spy('test');
console.log(spy.callCount);  // 1

// Measure performance
const { result, duration } = await measureTime(async () => {
  return await heavyOperation();
});

// Assert
assert(result.success, 'Operation should succeed');
\`\`\`

## Debugging

### Built-in Debug Mode

\`\`\`bash
npm run dev:debug
\`\`\`

### Electron DevTools

- **Main window**: Opens automatically in dev mode
- **Overlay window**: Press `Ctrl+Shift+I` when focused
- **Console**: View logs, errors, network requests
- **Debugger**: Set breakpoints, step through code

### VSCode Debugging

Create `.vscode/launch.json`:

\`\`\`json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "outputCapture": "std"
    }
  ]
}
\`\`\`

### Logging

**View logs**:
- Development: `logs/combined.log`
- Production: `%APPDATA%/Dota 2 Ability Draft Plus/logs/`

**Log levels**:
- `debug`: Detailed info (dev only)
- `info`: General info
- `warn`: Warnings
- `error`: Errors

**Filter logs**:
\`\`\`bash
# View only errors
grep "error" logs/combined.log

# View specific module
grep "MLManager" logs/combined.log

# Last 50 lines
tail -n 50 logs/combined.log
\`\`\`

### Performance Profiling

\`\`\`javascript
const performanceMetrics = require('./src/main/performanceMetrics');

// Start timer
const timerId = performanceMetrics.startTimer('operation', 'myOp', { context: 'test' });

// ... do work ...

// Stop timer
const metric = performanceMetrics.stopTimer(timerId);
console.log(metric.duration);  // Duration in ms

// Get stats
const stats = performanceMetrics.getStats();
console.log(stats.scans.avg);  // Average scan duration
\`\`\`

### Memory Debugging

\`\`\`javascript
const memoryMonitor = require('./src/main/memoryMonitor');

// Get current usage
const usage = memoryMonitor.getMemoryUsage();
console.log(memoryMonitor.formatBytes(usage.heapUsed));

// Force GC (requires --expose-gc)
memoryMonitor.forceGarbageCollection();

// Get stats
const stats = memoryMonitor.getStats();
console.log(stats.peaks.heapUsed);
\`\`\`

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

### Key Patterns

#### IPC Communication

Main process exposes methods via IPC handlers:

\`\`\`javascript
// Main process (src/main/ipcHandlers/myHandlers.js)
ipcMain.handle('my-method', async (event, arg) => {
  try {
    const result = await doSomething(arg);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Renderer process
const result = await window.api.invoke('my-method', { data: 'test' });
if (result.success) {
  console.log(result.result);
}
\`\`\`

#### State Management

Centralized state in `stateManager.js`:

\`\`\`javascript
const stateManager = require('./stateManager');

// Get state
const dbPath = stateManager.getActiveDbPath();

// Set state
stateManager.setIsScanInProgress(true);

// Update multiple properties
stateManager.updateStateProperties({
  lastScanTargetResolution: '1920x1080',
  lastUsedScaleFactor: 1.5
});
\`\`\`

#### Worker Threads

ML processing runs in a separate thread:

\`\`\`javascript
// Main process posts message
mlManager.postMessage({
  action: 'scan',
  screenshotData: dataUrl,
  isInitialScan: true
});

// Worker processes and sends result
// Main process receives via callback
function handleMlWorkerMessage(result) {
  if (result.status === 'success') {
    // Process results
  }
}
\`\`\`

## Best Practices

### Performance

- **Debounce**: Rapid events (file watchers, user input)
- **Cache**: Expensive computations (database queries, ML predictions)
- **Lazy load**: Heavy modules (only when needed)
- **Worker threads**: CPU-intensive tasks (ML inference)
- **Async operations**: Don't block the main thread

### Security

- **Input validation**: Validate all IPC inputs
- **Path sanitization**: Check paths before file operations
- **SQL injection**: Use prepared statements
- **XSS prevention**: Sanitize user-provided content
- **Context isolation**: Keep renderer process isolated

### Memory

- **Cleanup listeners**: Remove event listeners when done
- **Close resources**: Close files, databases, watchers
- **Limit cache size**: Use LRU eviction
- **Monitor usage**: Track with memoryMonitor
- **GC on critical**: Force GC when memory critical

### Errors

- **Always catch**: Never let errors crash the app
- **Log errors**: Use logger with context
- **User-friendly**: Show helpful error messages
- **Recovery**: Provide recovery suggestions
- **Fallbacks**: Graceful degradation

### Git Workflow

1. **Feature branch**: `git checkout -b feature/my-feature`
2. **Commit often**: Small, logical commits
3. **Clear messages**: `feat: Add X`, `fix: Fix Y`, `docs: Update Z`
4. **Pull request**: Open PR when ready
5. **Code review**: Address review comments
6. **Merge**: Squash and merge to main

### Commit Messages

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Code style (no logic change)
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `test:` Tests
- `chore:` Maintenance

Examples:
- `feat: Add hot reload for development`
- `fix: Resolve memory leak in cache manager`
- `docs: Update build instructions`

## Additional Resources

- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [JavaScript Clean Code](https://github.com/ryanmcdermott/clean-code-javascript)
- [Debugging Electron](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)

## Getting Help

- **Documentation**: Read [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md)
- **Code**: Search the codebase for examples
- **Issues**: Check [GitHub Issues](https://github.com/tiarin-hino/ability-draft-plus/issues)
- **Community**: Open a discussion or issue

