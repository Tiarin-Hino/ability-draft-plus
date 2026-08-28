import type {
  Hero,
  AbilityDetail,
  ScanResult,
  SystemDisplayInfo,
  AppSettings,
  OverlayDataPayload,
  ResolutionLayout,
  PlayerProfileInfo,
} from '../types'
import type { InitialScanResults } from '../types/ml'
import type { StreamServerStatusInfo } from '../types/stream'
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

export interface FeedbackStatus {
  messageKey: string
  params?: Record<string, string | number>
  error?: boolean
}

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
  'backup:create': {
    request: void
    response: { success: boolean; backupPath?: string; error?: string }
  }
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
  'ml:exportModelGaps': {
    request: void
    response: { success: boolean; path?: string; count?: number; error?: string }
  }
  'overlay:getInitialData': { request: void; response: OverlayDataPayload | null }
  // Dev-only ML pipeline cockpit (handlers exist only in unpackaged builds)
  'dev:runGatherScript': {
    request: {
      dryRun: boolean
      /** Engine hero names for a targeted gather (icon reworks: --heroes mode).
       *  When set, the model-gaps export is skipped entirely. */
      heroes?: string[]
      /** With heroes: archive the heroes' existing dataset images to _purged/
       *  before gathering (--purge-existing). */
      purgeExisting?: boolean
    }
    response: { success: boolean; output?: string; error?: string }
  }
  'dev:runModelsGather': {
    request: {
      dryRun: boolean
      /** Target model-tile images per hero (default 24). */
      sets?: number
    }
    response: { success: boolean; output?: string; error?: string }
  }
  'dev:runDiagnosticCycle': {
    request: {
      dryRun: boolean
      /** Bot drafts to run; 0 = one full roster pass (default 3). */
      iterations?: number
      /** AD per-turn pick timer in seconds; 0 (default) = no timer commands,
       *  the game's own defaults (60s prep / 7s pick / 5s round break). */
      pickTimeS?: number
    }
    response: { success: boolean; output?: string; error?: string }
  }
  'dev:analyzeDiagnostics': {
    request: void
    response: { success: boolean; output?: string; error?: string }
  }
  'dev:uploadDataset': {
    request: void
    response: { success: boolean; error?: string }
  }
  'dev:triggerRetrain': {
    request: { datasetVersion: string; fineTune: boolean }
    response: { success: boolean; output?: string; error?: string }
  }
  'overlay:activate': {
    request: void
    response: { success: boolean; resolution?: string; source?: LayoutSource; error?: string }
  }
  // Streamer view server (see src/main/services/stream-server-service.ts)
  'stream:start': {
    request: { port: number }
    response: { success: boolean; errorKey?: string }
  }
  'stream:stop': { request: void; response: { success: boolean } }
  'stream:getStatus': { request: void; response: StreamServerStatusInfo }
  'stream:prefetchIcons': {
    request: void
    response: {
      success: boolean
      total?: number
      fetched?: number
      alreadyCached?: number
      failed?: number
    }
  }
  // Dota GSI cfg management (see src/main/services/gsi-cfg-service.ts)
  'gsi:detect': {
    request: void
    response: {
      dotaPath: string | null
      cfgPath: string | null
      cfgExists: boolean
      /** Port pinned in the existing cfg's uri; null if absent/unparseable. */
      cfgPort: number | null
    }
  }
  'gsi:writeCfg': {
    request: { dotaDir?: string }
    response: { success: boolean; path?: string; errorKey?: string }
  }
  // title is translated in the renderer (native dialogs can't use renderer i18n)
  'gsi:pickDotaFolder': { request: { title: string }; response: { dir: string | null } }
  // Linked Windrun profile for personalized suggestions (player-stats-service).
  // error keys are i18n keys in the settings namespace, translated in the renderer.
  'player:getProfile': { request: void; response: PlayerProfileInfo | null }
  'player:linkProfile': {
    request: { input: string }
    response: {
      success: boolean
      profile?: PlayerProfileInfo
      stats?: PlayerStatsRefreshInfo
      errorKey?: string
    }
  }
  'player:unlinkProfile': { request: void; response: void }
  'player:refreshStats': { request: void; response: PlayerStatsRefreshInfo }
}

/** Result of a personal-stats fetch (player:linkProfile / player:refreshStats).
 * matchedAbilityCount of 0 with a non-zero abilityCount means the local DB
 * predates windrun_id — a Windrun data update enables ability matching. */
export interface PlayerStatsRefreshInfo {
  success: boolean
  abilityCount?: number
  heroCount?: number
  matchedAbilityCount?: number
  errorKey?: string
}

// Send (fire-and-forget) channels from renderer to main
export interface IpcSendMap {
  // Cached-source capture responses (overlay capture-agent -> main). Handled
  // inside cached-window-capture-service (request/response correlation lives
  // there), NOT in src/main/ipc/. data is tightly-packed RGBA at the captured
  // size (getImageData output — no stride padding, alpha always 255).
  'capture:frameResult': {
    requestId: number
    ok: boolean
    width?: number
    height?: number
    data?: Uint8Array
    error?: string
  }
  // The capture track died (game window closed/recreated, e.g. resolution
  // change) — main must drop the cached source id and re-resolve.
  'capture:sessionEnded': void
  'scraper:start': void
  'scraper:startLiquipedia': void
  'overlay:close': void
  'overlay:reset': void
  'overlay:setMouseIgnore': { ignore: boolean; forward?: boolean }
  'ml:scan': { heroOrder: number; isInitialScan: boolean }
  'draft:selectMySpot': { heroOrder: number; dbHeroId: number }
  'draft:selectMyModel': { heroOrder: number; dbHeroId: number }
  'app:openExternal': { url: string }
  'app:checkUpdate': void
  'app:downloadUpdate': void
  'app:installUpdate': void
  'feedback:takeSnapshot': void
  'feedback:exportSamples': void
  'feedback:uploadSamples': void
}

// Main-to-renderer event channels.
// Scraper/theme/i18n/update state intentionally has NO push channels here —
// it flows through the @zubridge-synced AppStore.
export interface IpcOnMap {
  // Cached-source capture requests (main -> overlay capture-agent): grab one
  // frame of the desktopCapturer source `sourceId` from a persistent
  // getUserMedia stream and answer on 'capture:frameResult' with the same
  // requestId. max* bound the stream resolution (never upscaled).
  'capture:frame': {
    requestId: number
    sourceId: string
    maxWidth: number
    maxHeight: number
  }
  // Stop the capture stream (scans idle — draft over). The cached source id
  // in main stays valid; the next request restarts the stream.
  'capture:stop': void
  'overlay:data': OverlayDataPayload
  'overlay:hotkey': { action: 'scan' | 'rescan' }
  'ml:scanResults': {
    error?: string
    results?: InitialScanResults | ScanResult[]
    isInitialScan?: boolean
  }
  'draft:selectMySpot': { selectedHeroOrderForDrafting: number | null }
  'draft:selectMyModel': { selectedModelHeroOrder: number | null }
  // Feedback statuses carry i18n keys (resolved in the receiving renderer's namespace)
  // so main-process code never hardcodes display language.
  'feedback:snapshotStatus': FeedbackStatus
  'feedback:exportStatus': FeedbackStatus
  'feedback:uploadStatus': FeedbackStatus
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

  on<K extends keyof IpcOnMap>(channel: K, callback: (data: IpcOnMap[K]) => void): () => void // Returns an unsubscribe function
}
