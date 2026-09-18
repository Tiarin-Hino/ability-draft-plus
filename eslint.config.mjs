import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    ignores: [
      'out/',
      'dist/',
      'node_modules/',
      'scripts/',
      '.claude/',
      // twitch/ packages lint themselves (own package.json + config)
      'twitch/**/dist/',
      'twitch/**/.aws-sam/',
      'twitch/**/node_modules/',
      'twitch/catalog/dist/',
      // Node ESM scripts (same reason scripts/ is ignored: no node globals in this config)
      'twitch/**/*.mjs',
    ],
  },
)
