/**
 * Launches electron-vite preview with ELECTRON_RUN_AS_NODE removed from env.
 * See electron-dev.mjs for details on why this is needed.
 */
import { spawn } from 'child_process'

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'preview'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
