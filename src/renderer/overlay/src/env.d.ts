/// <reference types="electron-vite/client" />

import type { ElectronApi } from '@shared/ipc/api'

declare global {
  interface Window {
    electronApi: ElectronApi
  }
}
