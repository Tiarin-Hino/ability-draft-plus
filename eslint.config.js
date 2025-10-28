/**
 * ESLint Configuration for ability-draft-plus
 * Using ESLint 9+ flat config format
 */

const js = require('@eslint/js');
const jestPlugin = require('eslint-plugin-jest');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Global configuration for all files
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2021,
      }
    },
    rules: {
      // Possible Errors
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_'
      }],

      // Best Practices
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-return-await': 'error',
      'require-await': 'warn',
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',

      // Variables
      'no-shadow': ['error', { builtinGlobals: false, hoist: 'functions' }],
      'no-undef': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true }],

      // Stylistic
      'curly': ['error', 'all'],
      'brace-style': ['error', '1tbs', { allowSingleLine: false }],
      'comma-dangle': ['error', 'never'],
      'comma-spacing': ['error', { before: false, after: true }],
      'comma-style': ['error', 'last'],
      'indent': ['error', 4, { SwitchCase: 1 }],
      'key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'keyword-spacing': ['error', { before: true, after: true }],
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'semi': ['error', 'always'],
      'semi-spacing': ['error', { before: false, after: true }],
      'space-before-blocks': ['error', 'always'],
      'space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',

      // ES6
      'arrow-spacing': ['error', { before: true, after: true }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-template': 'warn',
      'object-shorthand': ['warn', 'always'],

      // Node.js specific
      'callback-return': 'off', // Can be too strict
      'handle-callback-err': ['error', '^(err|error)$'],
      'no-new-require': 'error',
      'no-path-concat': 'error'
    }
  },

  // Electron main process files
  {
    files: ['main.js', 'preload.js', 'config.js', 'src/main/**/*.js', 'src/database/**/*.js', 'src/scraper/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'off' // Allow console in main process
    }
  },

  // Electron renderer process files (ES Modules)
  {
    files: ['renderer.js', 'overlayRenderer.js', 'src/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        electronAPI: 'readonly',
        window: 'readonly',
        document: 'readonly'
      }
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },

  // Worker thread files
  {
    files: ['src/ml.worker.js', 'src/**/*.worker.js'],
    languageOptions: {
      globals: {
        ...globals.worker,
        ...globals.node
      }
    }
  },

  // Test files
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    plugins: {
      jest: jestPlugin
    },
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node
      }
    },
    rules: {
      ...jestPlugin.configs.recommended.rules,
      'no-console': 'off', // Allow console in tests
      'jest/expect-expect': 'warn',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/valid-expect': 'error'
    }
  },

  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'failed-samples/**',
      'training_data/**',
      'model/**',
      '*.min.js',
      'src/app-config.js', // Generated file
      'scripts/fix-tfjs-node-build.js' // External script
    ]
  },

  // Prettier integration - disable formatting rules that conflict
  prettierConfig
];
