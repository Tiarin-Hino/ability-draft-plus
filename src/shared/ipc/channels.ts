// @DEV-GUIDE: Central registry of all IPC channel name constants. Using string constants
// prevents typos and enables find-all-references across the codebase.
// Naming convention: 'domain:action' (e.g., 'hero:getAll', 'ml:scan').
// Domains: hero, ability, draft, settings, scraper, ml, resolution, app, overlay,
// theme, i18n, feedback, backup.
export const IpcChannels = {
  // Hero domain
  'hero:getAll': 'hero:getAll',
  'hero:getById': 'hero:getById',

  // Ability domain
  'ability:getDetails': 'ability:getDetails',
  'ability:getSynergies': 'ability:getSynergies',
  'ability:getByHeroId': 'ability:getByHeroId',

  // Draft domain
  'draft:analyze': 'draft:analyze',
  'draft:getTopPicks': 'draft:getTopPicks',
  'draft:selectMySpot': 'draft:selectMySpot',
  'draft:selectMyModel': 'draft:selectMyModel',

  // Settings domain
  'settings:get': 'settings:get',
  'settings:set': 'settings:set',

  // Scraper domain
  'scraper:start': 'scraper:start',
  'scraper:startLiquipedia': 'scraper:startLiquipedia',
  'scraper:status': 'scraper:status',
  'scraper:liquipediaStatus': 'scraper:liquipediaStatus',
  'scraper:lastUpdated': 'scraper:lastUpdated',

  // ML domain
  'ml:init': 'ml:init',
  'ml:scan': 'ml:scan',
  'ml:scanResults': 'ml:scanResults',
  'ml:getModelGaps': 'ml:getModelGaps',

  // Resolution domain
  'resolution:getAll': 'resolution:getAll',
  'resolution:getLayout': 'resolution:getLayout',
  'resolution:save': 'resolution:save',
  'resolution:calibrate': 'resolution:calibrate',
  'resolution:deleteCustom': 'resolution:deleteCustom',
  'resolution:captureScreenshot': 'resolution:captureScreenshot',
  'resolution:submitScreenshot': 'resolution:submitScreenshot',

  // App domain
  'app:getVersion': 'app:getVersion',
  'app:checkUpdate': 'app:checkUpdate',
  'app:downloadUpdate': 'app:downloadUpdate',
  'app:installUpdate': 'app:installUpdate',
  'app:updateNotification': 'app:updateNotification',
  'app:getSystemInfo': 'app:getSystemInfo',
  'app:openExternal': 'app:openExternal',
  'app:isPackaged': 'app:isPackaged',

  // Overlay domain
  'overlay:activate': 'overlay:activate',
  'overlay:close': 'overlay:close',
  'overlay:data': 'overlay:data',
  'overlay:setMouseIgnore': 'overlay:setMouseIgnore',

  // Theme domain
  'theme:get': 'theme:get',
  'theme:changed': 'theme:changed',

  // Localization domain
  'i18n:changeLanguage': 'i18n:changeLanguage',
  'i18n:translationsLoaded': 'i18n:translationsLoaded',

  // Feedback domain
  'feedback:takeSnapshot': 'feedback:takeSnapshot',
  'feedback:snapshotStatus': 'feedback:snapshotStatus',
  'feedback:exportSamples': 'feedback:exportSamples',
  'feedback:exportStatus': 'feedback:exportStatus',
  'feedback:uploadSamples': 'feedback:uploadSamples',
  'feedback:uploadStatus': 'feedback:uploadStatus',

  // Backup domain
  'backup:create': 'backup:create',
  'backup:list': 'backup:list',
  'backup:restore': 'backup:restore',
  'backup:stats': 'backup:stats',
} as const

export type IpcChannel = keyof typeof IpcChannels
