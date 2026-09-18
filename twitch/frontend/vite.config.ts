import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

// Twitch hosts the bundle itself (zip upload) at a hashed path -> relative asset URLs.
// Review rule: JS must be human-readable -> no minification. Mobile guideline: initial
// load <= 1 MB -> the size guard fails the build when an entry (js+css) exceeds the cap.

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

const MAX_ENTRY_BYTES = 900_000

// A locally TRUSTED certificate (mkcert) beats the self-signed one from basic-ssl: Chrome
// does not reliably honour a click-through exception for subframes, and Twitch loads the
// extension inside an iframe. Generate with:
//   mkcert -install
//   mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1
const CERT_DIR = resolve(__dirname, 'certs')
const trustedCert = {
  key: resolve(CERT_DIR, 'localhost-key.pem'),
  cert: resolve(CERT_DIR, 'localhost.pem'),
}
const hasTrustedCert = existsSync(trustedCert.key) && existsSync(trustedCert.cert)
const https = hasTrustedCert
  ? { key: readFileSync(trustedCert.key), cert: readFileSync(trustedCert.cert) }
  : undefined

// Files a viewer never downloads: the demo chunk and its assets are imported
// only for ?demo=<mode>, so counting them against a budget that exists to
// protect the VIEWER's initial load overstates it. They are reported instead.
const isDemoOnly = (fileName: string): boolean => /(^|\/)demo-/.test(fileName)

function sizeGuard(): Plugin {
  return {
    name: 'adplus-size-guard',
    generateBundle(_options, bundle) {
      const sizeOf = (chunk: (typeof bundle)[string]): number => {
        if (chunk.type === 'chunk') return Buffer.byteLength(chunk.code, 'utf8')
        if (typeof chunk.source === 'string') return Buffer.byteLength(chunk.source, 'utf8')
        return chunk.source.byteLength
      }
      let total = 0
      let demo = 0
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (isDemoOnly(fileName)) demo += sizeOf(chunk)
        else total += sizeOf(chunk)
      }
      if (demo > 0) {
        this.info(
          `viewer bundle ${(total / 1024).toFixed(0)} KB, demo-only ${(demo / 1024).toFixed(0)} KB (not budgeted)`,
        )
      }
      if (total > MAX_ENTRY_BYTES) {
        this.error(
          `Bundle is ${(total / 1024).toFixed(0)} KB, above the ${MAX_ENTRY_BYTES / 1024} KB budget. ` +
            'Consider aliasing react/react-dom to preact/compat.',
        )
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    sizeGuard(),
    ...(command === 'serve' && !hasTrustedCert ? [basicSsl()] : []),
  ],
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../../src/core'),
      '@shared': resolve(__dirname, '../../src/shared'),
    },
  },
  define: {
    __EXT_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 8080,
    strictPort: true,
    ...(https ? { https } : {}),
  },
  preview: {
    port: 8080,
    ...(https ? { https } : {}),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'es2020',
    modulePreload: { polyfill: false },
    // Per-entry CSS (vite's default). Merging the two entries' stylesheets into one
    // file made every page load BOTH: the overlay's fullscreen reset
    // (html,body{height:100%;overflow:hidden}) then clipped the config page inside
    // Twitch's iframe with no way to scroll. Dev links each page's own CSS, so a
    // merged build is also a bug the dev server cannot reproduce.
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        video_overlay: resolve(__dirname, 'video_overlay.html'),
        config: resolve(__dirname, 'config.html'),
      },
      output: {
        // FLAT output — no assets/ directory. Twitch's zip ingestion kept only
        // the root-level files and silently dropped everything under assets/
        // (verified 2026-09-04: both .html served 200 from the CDN while every
        // asset path returned 404), which renders the extension as a blank
        // frame. Emitting at the root removes the dependency on the archiver
        // writing directory entries at all. pack.mjs enforces it.
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'zustand'],
        },
      },
    },
  },
}))
