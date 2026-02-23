import type {
  Hero,
  AbilityDetail,
  ScanResult,
  SystemDisplayInfo,
  AppSettings,
  OverlayDataPayload,
  UpdateNotification,
  ResolutionLayout,
} from '../types'
import type { InitialScanResults } from '../types/ml'
import type { CalibrationAnchors, ValidationResult } from '@core/resolution/types'
import type { MlModelGaps } from '@core/ml/staleness-detector'

// @DEV-GUIDE: Type definitions for ALL IPC channels. Three maps define the contract:
// - IpcInvokeMap: Request/response (renderer awaits result). E.g., hero:getAll -> Hero[]
// - IpcSendMap: Fire-and-forget (renderer sends, no response). E.g., ml:scan, overlay:close
// - IpcOnMap: Push from main -> renderer (events). E.g., overlay:data, ml:scanResults
//
// ElectronApi: The typed interface exposed to renderers via contextBridge.
// Renderers call window.electronApi.invoke/send/on() with full type safety.
// Preload scripts (src/preload/) implement this interface.
//
// OverlayDataPayload: The main data structure pushed from main to overlay after each scan.
// Contains enriched ability data, synergy panels, hero models, and layout coordinates.

export type LayoutSource = 'preset' | 'custom' | 'auto-scaled' | 'none'

// Request/Response type mapping for invoke (two-way) channels
export interface IpcInvokeMap {
  'hero:getAll': { request: void; response: Hero[] }
  'hero:getById': { request: { id: number }; response: Hero | null }
  'ability:getDetails': { request: { names: string[] }; response: AbilityDetail[] }
  'ability:getAll': { request: void; response: AbilityDetail[] }
  'ability:getByHeroId': { request: { heroId: number }; response: AbilityDetail[] }
  'settings:get': { request: void; response: AppSettings }
  'settings:set': { request: Partial<AppSettings>; response: void }
  'resolution:getAll': {
    request: void
    response: Array<{ resolution: string; source: LayoutSource }>
  }
  'resolution:getLayout': {
    request: { resolution: string }
    response: { layout: ResolutionLayout | null; source: LayoutSource }
  }
  'resolution:save': {
    request: { resolution: string; layout: ResolutionLayout; method: string }
    response: { success: boolean; error?: string }
  }
  'resolution:calibrate': {
    request: { resolution: string; anchors: CalibrationAnchors }
    response: { layout: ResolutionLayout; validation: ValidationResult }
  }
  'resolution:deleteCustom': {
    request: { resolution: string }
    response: { success: boolean }
  }
  'resolution:captureScreenshot': {
    request: void
    response: { imageBase64: string; width: number; height: number }
  }
  'resolution:submitScreenshot': {
    request: { imageBase64: string; width: number; height: number }
    response: { success: boolean; message?: string; error?: string }
  }
  'app:getVersion': { request: void; response: string }
  'app:getSystemInfo': { request: void; response: SystemDisplayInfo }
  'app:isPackaged': { request: void; response: boolean }
  'theme:get': { request: void; response: { shouldUseDarkColors: boolean } }
  'backup:create': { request: void; response: { success: boolean; backupPath?: string; error?: string } }
  'backup:list': {
    request: void
    response: Array<{ name: string; path: string; date: string; size: number }>
  }
  'backup:restore': {
    request: { backupPath: string }
    response: { success: boolean; error?: string }
  }
  'backup:stats': {
    request: void
    response: { count: number; totalSize: number; oldestBackup?: string; newestBackup?: string }
  }
  'ml:init': { request: void; response: { success: boolean; error?: string } }
  'ml:getModelGaps': { request: void; response: MlModelGaps | null }
  'overlay:getInitialData': { request: void; response: OverlayDataPayload | null }
  'overlay:activate': {
    request: void
    response: { success: boolean; resolution?: string; source?: LayoutSource; error?: string }
  }
}

// Send (fire-and-forget) channels from renderer to main
export interface IpcSendMap {
  'scraper:start': void
  'scraper:startLiquipedia': void
  'overlay:close': void
  'overlay:setMouseIgnore': { ignore: boolean; forward?: boolean }
  'ml:scan': { heroOrder: number; isInitialScan: boolean }
  'draft:selectMySpot': { heroOrder: number; dbHeroId: number }
  'draft:selectMyModel': { heroOrder: number; dbHeroId: number }
  'app:openExternal': { url: string }
  'app:checkUpdate': void
  'app:downloadUpdate': void
  'app:installUpdate': void
  'i18n:changeLanguage': { language: string }
  'feedback:takeSnapshot': void
  'feedback:exportSamples': void
  'feedback:uploadSamples': void
}

// Main-to-renderer event channels
export interface IpcOnMap {
  'overlay:data': OverlayDataPayload
  'scraper:status': string | { key: string; params?: Record<string, string> }
  'scraper:lastUpdated': string | null
  'scraper:liquipediaStatus': string
  'theme:changed': { shouldUseDarkColors: boolean }
  'app:updateNotification': UpdateNotification
  'i18n:translationsLoaded': Record<string, unknown>
  'ml:scanResults': {
    error?: string
    results?: InitialScanResults | ScanResult[]
    isInitialScan?: boolean
  }
  'draft:selectMySpot': { selectedHeroOrderForDrafting: number | null }
  'draft:selectMyModel': { selectedModelHeroOrder: number | null }
  'feedback:snapshotStatus': { message: string; error?: boolean; allowRetry?: boolean }
  'feedback:exportStatus': { message: string; error?: boolean }
  'feedback:uploadStatus': { message: string; error?: boolean }
}

// The typed API exposed to renderers via contextBridge
export interface ElectronApi {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: IpcInvokeMap[K]['request'] extends void ? [] : [IpcInvokeMap[K]['request']]
  ): Promise<IpcInvokeMap[K]['response']>

  send<K extends keyof IpcSendMap>(
    channel: K,
    ...args: IpcSendMap[K] extends void ? [] : [IpcSendMap[K]]
  ): void

  on<K extends keyof IpcOnMap>(
    channel: K,
    callback: (data: IpcOnMap[K]) => void,
  ): () => void // Returns an unsubscribe function
}
