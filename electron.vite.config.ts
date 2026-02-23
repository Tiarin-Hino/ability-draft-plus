import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// @DEV-GUIDE: electron-vite configuration for the 3-target build system:
// 1. main: Electron main process (CJS). electron-log bundled; drizzle-orm, sql.js,
//    onnxruntime-node, sharp, screenshot-desktop, koffi are EXTERNALIZED (not bundled).
//    ml-worker.ts is a separate entry point compiled alongside the main process.
// 2. preload: Preload scripts for both windows (CJS, sandboxed context).
// 3. renderer: Two React SPAs (control-panel + overlay) with Tailwind CSS v4 plugin.
//
// Path aliases: @core -> src/core/, @shared -> src/shared/, @ -> control-panel/src/,
// @overlay -> overlay/src/, @renderer -> src/renderer/.

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'workers/ml-worker': resolve(__dirname, 'src/main/workers/ml-worker.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })],
    build: {
      rollupOptions: {
        input: {
          'control-panel': resolve(__dirname, 'src/preload/control-panel.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@': resolve(__dirname, 'src/renderer/control-panel/src'),
        '@overlay': resolve(__dirname, 'src/renderer/overlay/src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@core': resolve(__dirname, 'src/core'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          'control-panel': resolve(__dirname, 'src/renderer/control-panel/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
        },
      },
    },
  },
})
