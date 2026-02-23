import { contextBridge, ipcRenderer } from 'electron'
import { preloadBridge } from '@zubridge/electron/preload'
import type { ElectronApi, IpcInvokeMap, IpcSendMap, IpcOnMap } from '@shared/ipc/api'

// @DEV-GUIDE: Preload script for the overlay renderer. Same pattern as control-panel.ts:
// exposes 'electronApi' (typed IPC) and 'zubridge' (reactive state sync) to window.
// The overlay window uses these to receive scan data pushes and send click-through toggles.

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
