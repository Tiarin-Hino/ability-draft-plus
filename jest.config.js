/**
 * Jest Configuration for ability-draft-plus
 */

module.exports = {
    // Use Node.js environment for testing Electron main process code
    testEnvironment: 'node',

    // Test file patterns
    testMatch: ['**/tests/unit/**/*.test.js', '**/tests/integration/**/*.test.js'],

    // Setup files to run after Jest is initialized
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Coverage collection
    collectCoverageFrom: [
        'src/**/*.js',
        'main.js',
        'config.js',
        'preload.js',
        '!src/app-config.js', // Generated file
        '!**/node_modules/**',
        '!**/tests/**'
    ],

    // Coverage thresholds (aim for these values)
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 60,
            lines: 60,
            statements: 60
        }
    },

    // Coverage output directory
    coverageDirectory: 'coverage',

    // Coverage reporters
    coverageReporters: ['text', 'lcov', 'html'],

    // Module paths
    modulePaths: ['<rootDir>'],

    // Timeout for tests (in milliseconds)
    testTimeout: 10000,

    // Verbose output
    verbose: true
};
