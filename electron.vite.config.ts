import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

// Every runtime dependency is externalized EXCEPT electron-log (bundled on purpose).
// 'electron' itself must also be external: electron-log requires it, and if the
// bundler resolves that to the electron npm package it inlines the launcher shim,
// which throws "Electron failed to install correctly" at app load. A function
// matcher (not an array) so subpath imports like 'drizzle-orm/sql-js' match too.
const BUNDLED_DEPS = ['electron-log']
const externalDeps = ['electron', ...Object.keys(pkg.dependencies).filter((d) => !BUNDLED_DEPS.includes(d))]
const isExternal = (id: string): boolean =>
  externalDeps.some((dep) => id === dep || id.startsWith(`${dep}/`))

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
    build: {
      rollupOptions: {
        external: isExternal,
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
    build: {
      rollupOptions: {
        external: isExternal,
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
          // Streamer views: served over HTTP by stream-server-service (OBS browser
          // sources), NOT loaded into an Electron window. No preload, no electron API.
          stream: resolve(__dirname, 'src/renderer/stream/index.html'),
          picks: resolve(__dirname, 'src/renderer/picks/index.html'),
        },
      },
    },
  },
})
