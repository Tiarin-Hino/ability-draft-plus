/**
 * Launches electron-vite dev with ELECTRON_RUN_AS_NODE removed from env.
 * VS Code sets ELECTRON_RUN_AS_NODE=1 (since it's an Electron app), which
 * prevents child Electron processes from initializing properly.
 */
import { spawn } from 'child_process'

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
