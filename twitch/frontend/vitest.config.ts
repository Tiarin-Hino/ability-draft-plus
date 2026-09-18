import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../../src/core'),
      '@shared': resolve(__dirname, '../../src/shared'),
    },
  },
  define: {
    __EXT_VERSION__: JSON.stringify('test'),
  },
})
