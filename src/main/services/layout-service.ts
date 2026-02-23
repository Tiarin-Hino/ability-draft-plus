import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { app, screen } from 'electron'
import log from 'electron-log/main'
import type { LayoutCoordinatesConfig, ResolutionLayout } from '@shared/types'
import type { LayoutSource } from '@shared/ipc/api'
import {
  scaleCoordinates,
  parseResolution,
  getAspectFamily,
  SCALING_BASES,
} from '@core/resolution/scaling-engine'

// @DEV-GUIDE: Manages resolution-to-coordinate mappings for ML slot detection and overlay positioning.
// Three-tier cascade for getLayout(resolution):
//   1. Custom layouts -- user-calibrated, stored in %APPDATA%/custom_layouts.json
//   2. Preset layouts -- 28 pre-computed resolutions in resources/config/layout_coordinates.json
//   3. Auto-scaled -- mathematical scaling from the best base for the aspect ratio family
//      (16:9 from 1920x1080, 16:10 from 1920x1200, 4:3 from 1920x1440, 21:9 from 3440x1440)
//
// getScaleFactor() returns the DPI scale factor (e.g. 1.25 at 125% Windows scaling).
// This is NOT height/1080 -- the JSON coords are already in physical pixels per resolution.
// The DPI factor is needed only to convert physical pixel coords to CSS pixels for the overlay.
//
// Custom layouts use atomic write (write .tmp then rename) for crash safety.

const logger = log.scope('layout')

export interface LayoutService {
  getConfig(): LayoutCoordinatesConfig
  getAvailableResolutions(): string[]
  getScaleFactor(): number
  getLayout(resolution: string): ResolutionLayout | null
  getLayoutSource(resolution: string): LayoutSource
  getAllResolutionsWithSources(): Array<{ resolution: string; source: LayoutSource }>
  saveCustomLayout(resolution: string, layout: ResolutionLayout, method: string): void
  deleteCustomLayout(resolution: string): boolean
}

interface CustomLayoutEntry {
  layout: ResolutionLayout
  method: string
  savedAt: string
}

type CustomLayoutsFile = Record<string, CustomLayoutEntry>

export function createLayoutService(): LayoutService {
  let config: LayoutCoordinatesConfig | null = null
  let customLayouts: CustomLayoutsFile | null = null

  function loadConfig(): LayoutCoordinatesConfig {
    if (config) return config

    const basePath = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    const configPath = join(basePath, 'config', 'layout_coordinates.json')

    logger.info('Loading layout coordinates', { path: configPath })
    const data = readFileSync(configPath, 'utf-8')
    config = JSON.parse(data) as LayoutCoordinatesConfig

    const resolutions = Object.keys(config.resolutions)
    logger.info('Layout coordinates loaded', {
      resolutions: resolutions.length,
    })
    return config
  }

  function getCustomLayoutsPath(): string {
    return join(app.getPath('userData'), 'custom_layouts.json')
  }

  function loadCustomLayouts(): CustomLayoutsFile {
    if (customLayouts) return customLayouts

    const filePath = getCustomLayoutsPath()
    if (existsSync(filePath)) {
      try {
        const data = readFileSync(filePath, 'utf-8')
        customLayouts = JSON.parse(data) as CustomLayoutsFile
        logger.info('Custom layouts loaded', {
          count: Object.keys(customLayouts).length,
        })
      } catch (err) {
        logger.warn('Failed to load custom layouts, using empty', { err })
        customLayouts = {}
      }
    } else {
      customLayouts = {}
    }
    return customLayouts
  }

  function saveCustomLayoutsFile(layouts: CustomLayoutsFile): void {
    const filePath = getCustomLayoutsPath()
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Atomic write: write to temp file then rename
    const tmpPath = filePath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(layouts, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)

    // Invalidate cache
    customLayouts = layouts
  }

  return {
    getConfig: () => loadConfig(),

    getAvailableResolutions(): string[] {
      const presets = Object.keys(loadConfig().resolutions)
      const custom = Object.keys(loadCustomLayouts())
      const all = new Set([...presets, ...custom])
      return [...all].sort()
    },

    getScaleFactor(): number {
      // JSON coords are in physical pixels for the selected resolution.
      // The overlay BrowserWindow viewport is in logical (DPI-scaled) CSS pixels.
      // Conversion: cssPixel = physicalPixel / dpiScale
      return screen.getPrimaryDisplay().scaleFactor
    },

    getLayout(resolution: string): ResolutionLayout | null {
      // Cascade: custom → preset → auto-scale
      const custom = loadCustomLayouts()
      if (custom[resolution]) {
        logger.debug('Using custom layout', { resolution })
        return custom[resolution].layout
      }

      const preset = loadConfig().resolutions[resolution]
      if (preset) {
        logger.debug('Using preset layout', { resolution })
        return preset
      }

      // Try auto-scaling from the best base for this aspect ratio family
      const parsed = parseResolution(resolution)
      if (parsed) {
        const family = getAspectFamily(parsed.width, parsed.height)
        if (family) {
          const base = SCALING_BASES[family]
          const baseKey = `${base.width}x${base.height}`
          const baseLayout = loadConfig().resolutions[baseKey]
          if (baseLayout) {
            logger.info('Auto-scaling layout', { resolution, base: baseKey, family })
            return scaleCoordinates(baseLayout, parsed.width, parsed.height, base.width, base.height)
          }
        }
      }

      logger.warn('No layout available', { resolution })
      return null
    },

    getLayoutSource(resolution: string): LayoutSource {
      const custom = loadCustomLayouts()
      if (custom[resolution]) return 'custom'

      const preset = loadConfig().resolutions[resolution]
      if (preset) return 'preset'

      const parsed = parseResolution(resolution)
      if (parsed) {
        const family = getAspectFamily(parsed.width, parsed.height)
        if (family) {
          const base = SCALING_BASES[family]
          const baseKey = `${base.width}x${base.height}`
          if (loadConfig().resolutions[baseKey]) return 'auto-scaled'
        }
      }

      return 'none'
    },

    getAllResolutionsWithSources(): Array<{ resolution: string; source: LayoutSource }> {
      const presets = Object.keys(loadConfig().resolutions)
      const custom = Object.keys(loadCustomLayouts())
      const allKeys = new Set([...presets, ...custom])

      return [...allKeys]
        .sort()
        .map((resolution) => ({
          resolution,
          source: this.getLayoutSource(resolution),
        }))
    },

    saveCustomLayout(resolution: string, layout: ResolutionLayout, method: string): void {
      const layouts = { ...loadCustomLayouts() }
      layouts[resolution] = {
        layout,
        method,
        savedAt: new Date().toISOString(),
      }
      saveCustomLayoutsFile(layouts)
      logger.info('Custom layout saved', { resolution, method })
    },

    deleteCustomLayout(resolution: string): boolean {
      const layouts = { ...loadCustomLayouts() }
      if (!layouts[resolution]) return false

      delete layouts[resolution]
      saveCustomLayoutsFile(layouts)
      logger.info('Custom layout deleted', { resolution })
      return true
    },
  }
}
