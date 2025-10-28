/**
 * @file Test helpers and utilities
 * Provides common utilities for testing the application
 */

const mockGen = require('./mockDataGenerators');

/**
 * Create a mock database connection for testing
 * @returns {object} Mock database
 */
function createMockDatabase() {
    const mockData = {
        abilities: mockGen.generateAbilities(50),
        heroes: mockGen.SAMPLE_HEROES.map((name, i) =>
            mockGen.generateHero({ name, id: i + 1 })
        ),
        pairs: []
    };

    // Generate some ability pairs
    for (let i = 0; i < 30; i++) {
        const ability1 = mockGen.randomPick(mockGen.SAMPLE_ABILITIES);
        const ability2 = mockGen.randomPick(
            mockGen.SAMPLE_ABILITIES.filter((a) => a !== ability1)
        );
        mockData.pairs.push(mockGen.generateAbilityPair(ability1, ability2));
    }

    return {
        prepare: (query) => ({
            all: () => {
                if (query.includes('abilities')) return mockData.abilities;
                if (query.includes('heroes')) return mockData.heroes;
                if (query.includes('pairs')) return mockData.pairs;
                return [];
            },
            get: () => {
                if (query.includes('abilities'))
                    return mockGen.randomPick(mockData.abilities);
                if (query.includes('heroes'))
                    return mockGen.randomPick(mockData.heroes);
                return null;
            },
            run: () => ({ changes: 1 })
        }),
        close: () => {},
        exec: () => {}
    };
}

/**
 * Create a mock state manager for testing
 * @returns {object} Mock state manager
 */
function createMockStateManager() {
    const state = {
        isScanInProgress: false,
        activeDbPath: '/mock/path/to/database.db',
        layoutCoordinatesPath: '/mock/path/to/layout.json',
        lastScanTargetResolution: '1920x1080',
        lastUsedScaleFactor: 1.0,
        isFirstAppRun: false,
        classNamesCache: mockGen.SAMPLE_ABILITIES.slice(0, 20),
        fullLayoutConfigCache: mockGen.generateLayoutCoordinates('1920x1080'),
        initialPoolAbilitiesCache: [],
        identifiedHeroModelsCache: [],
        mySelectedSpotDbIdForDrafting: null,
        mySelectedSpotOriginalOrder: null,
        mySelectedModelDbHeroId: null,
        mySelectedModelScreenOrder: null
    };

    return {
        getIsScanInProgress: () => state.isScanInProgress,
        setIsScanInProgress: (value) => {
            state.isScanInProgress = value;
        },
        getActiveDbPath: () => state.activeDbPath,
        setActiveDbPath: (value) => {
            state.activeDbPath = value;
        },
        getLayoutCoordinatesPath: () => state.layoutCoordinatesPath,
        setLayoutCoordinatesPath: (value) => {
            state.layoutCoordinatesPath = value;
        },
        getLastScanTargetResolution: () => state.lastScanTargetResolution,
        setLastScanTargetResolution: (value) => {
            state.lastScanTargetResolution = value;
        },
        getLastUsedScaleFactor: () => state.lastUsedScaleFactor,
        setLastUsedScaleFactor: (value) => {
            state.lastUsedScaleFactor = value;
        },
        getIsFirstAppRun: () => state.isFirstAppRun,
        setIsFirstAppRun: (value) => {
            state.isFirstAppRun = value;
        },
        getClassNamesCache: () => state.classNamesCache,
        setClassNamesCache: (value) => {
            state.classNamesCache = value;
        },
        getFullLayoutConfigCache: () => state.fullLayoutConfigCache,
        setFullLayoutConfigCache: (value) => {
            state.fullLayoutConfigCache = value;
        },
        getInitialPoolAbilitiesCache: () => state.initialPoolAbilitiesCache,
        setInitialPoolAbilitiesCache: (value) => {
            state.initialPoolAbilitiesCache = value;
        },
        getIdentifiedHeroModelsCache: () => state.identifiedHeroModelsCache,
        setIdentifiedHeroModelsCache: (value) => {
            state.identifiedHeroModelsCache = value;
        },
        getMySelectedSpotDbIdForDrafting: () =>
            state.mySelectedSpotDbIdForDrafting,
        setMySelectedSpotDbIdForDrafting: (value) => {
            state.mySelectedSpotDbIdForDrafting = value;
        },
        getMySelectedSpotOriginalOrder: () => state.mySelectedSpotOriginalOrder,
        setMySelectedSpotOriginalOrder: (value) => {
            state.mySelectedSpotOriginalOrder = value;
        },
        getMySelectedModelDbHeroId: () => state.mySelectedModelDbHeroId,
        setMySelectedModelDbHeroId: (value) => {
            state.mySelectedModelDbHeroId = value;
        },
        getMySelectedModelScreenOrder: () => state.mySelectedModelScreenOrder,
        setMySelectedModelScreenOrder: (value) => {
            state.mySelectedModelScreenOrder = value;
        },
        updateStateProperties: (updates) => {
            Object.assign(state, updates);
        },
        // Direct access to state for testing
        _getState: () => state,
        _setState: (newState) => {
            Object.assign(state, newState);
        }
    };
}

/**
 * Create a mock window manager for testing
 * @returns {object} Mock window manager
 */
function createMockWindowManager() {
    const windows = {
        main: null,
        overlay: null
    };

    return {
        getMainWindow: () => windows.main,
        getOverlayWindow: () => windows.overlay,
        setMainWindow: (win) => {
            windows.main = win;
        },
        setOverlayWindow: (win) => {
            windows.overlay = win;
        },
        createMockWindow: (type = 'main') => {
            const mockWindow = {
                webContents: {
                    send: (channel, data) => {
                        console.log(`[Mock ${type} window] ${channel}:`, data);
                    },
                    isDestroyed: () => false,
                    on: () => {},
                    once: () => {}
                },
                isDestroyed: () => false,
                show: () => {},
                hide: () => {},
                close: () => {},
                on: () => {},
                once: () => {}
            };

            if (type === 'main') {
                windows.main = mockWindow;
            } else if (type === 'overlay') {
                windows.overlay = mockWindow;
            }

            return mockWindow;
        }
    };
}

/**
 * Create a mock ML manager for testing
 * @returns {object} Mock ML manager
 */
function createMockMLManager() {
    let isInitialized = false;
    let messageCallback = null;

    return {
        initialize: async (onMessage, onError, onExit, dirname) => {
            isInitialized = true;
            messageCallback = onMessage;
            return Promise.resolve();
        },
        postMessage: (message) => {
            // Simulate async response
            setTimeout(() => {
                if (messageCallback) {
                    if (message.action === 'scan') {
                        const result = mockGen.generateScanResult({
                            isInitialScan: message.isInitialScan || false
                        });
                        messageCallback(result);
                    }
                }
            }, 100);
        },
        terminate: () => {
            isInitialized = false;
            messageCallback = null;
        },
        isInitialized: () => isInitialized
    };
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Condition function that returns boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<boolean>} True if condition met, false if timeout
 */
async function waitFor(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        if (condition()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return false;
}

/**
 * Create a spy function that tracks calls
 * @param {Function} implementation - Optional implementation
 * @returns {Function} Spy function with call tracking
 */
function createSpy(implementation = () => {}) {
    const spy = function (...args) {
        spy.calls.push(args);
        spy.callCount++;
        return implementation(...args);
    };

    spy.calls = [];
    spy.callCount = 0;
    spy.reset = () => {
        spy.calls = [];
        spy.callCount = 0;
    };

    return spy;
}

/**
 * Measure execution time of a function
 * @param {Function} fn - Function to measure
 * @returns {Promise<object>} Result and duration
 */
async function measureTime(fn) {
    const startTime = Date.now();
    let result;
    let error;

    try {
        result = await fn();
    } catch (err) {
        error = err;
    }

    const duration = Date.now() - startTime;

    return {
        result,
        error,
        duration
    };
}

/**
 * Assert utility for tests
 * @param {boolean} condition - Condition to check
 * @param {string} message - Error message if condition is false
 */
function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * Deep equality check for objects
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if deeply equal
 */
function deepEqual(a, b) {
    if (a === b) return true;

    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }

    return true;
}

module.exports = {
    // Mock creators
    createMockDatabase,
    createMockStateManager,
    createMockWindowManager,
    createMockMLManager,

    // Test utilities
    waitFor,
    createSpy,
    measureTime,
    assert,
    deepEqual,

    // Re-export mock generators
    mockGen
};
