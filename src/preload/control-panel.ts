import { contextBridge, ipcRenderer } from 'electron'
import { preloadBridge } from '@zubridge/electron/preload'
import type { ElectronApi, IpcInvokeMap, IpcSendMap, IpcOnMap } from '@shared/ipc/api'

// @DEV-GUIDE: Preload script for the control panel renderer. Runs in a privileged context
// with Node.js API access but exposes only a typed API via contextBridge (context isolation).
//
// Two things exposed to window:
// 1. 'electronApi': Typed IPC methods (invoke, send, on) — see ElectronApi in api.ts
// 2. 'zubridge': @zubridge preload handlers for reactive state sync
//
// This is the security boundary: renderers cannot access Node.js or Electron APIs directly.
// All communication goes through the typed channel maps defined in src/shared/ipc/.

const api: ElectronApi = {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: IpcInvokeMap[K]['request'] extends void ? [] : [IpcInvokeMap[K]['request']]
  ): Promise<IpcInvokeMap[K]['response']> {
    return ipcRenderer.invoke(channel, ...args)
  },

  send<K extends keyof IpcSendMap>(
    channel: K,
    ...args: IpcSendMap[K] extends void ? [] : [IpcSendMap[K]]
  ): void {
    ipcRenderer.send(channel, ...args)
  },

  on<K extends keyof IpcOnMap>(
    channel: K,
    callback: (data: IpcOnMap[K]) => void,
  ): () => void {
    const listener = (_event: Electron.IpcRendererEvent, data: IpcOnMap[K]): void => {
      callback(data)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
}

contextBridge.exposeInMainWorld('electronApi', api)

// @zubridge state bridge for reactive store sync
const { handlers } = preloadBridge()
contextBridge.exposeInMainWorld('zubridge', handlers)
