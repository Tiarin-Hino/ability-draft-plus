// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Hero scraping trigger
  scrapeHeroes: () => ipcRenderer.send('scrape-heroes'),
  // Ability scraping trigger
  scrapeAbilities: () => ipcRenderer.send('scrape-abilities'),
  // Ability Pairs scraping trigger
  scrapeAbilityPairs: () => ipcRenderer.send('scrape-ability-pairs'),
  // Request available resolutions
  getAvailableResolutions: () => ipcRenderer.send('get-available-resolutions'),

  // Listener for status updates (reused for all)
  onUpdateStatus: (callback) => ipcRenderer.on('scrape-status', (_event, message) => callback(message)),
  // Listener for scan results (for the main window, now mostly for status)
  onScanResults: (callback) => ipcRenderer.on('scan-results', (_event, results) => callback(results)),
  // Listener for available resolutions
  onAvailableResolutions: (callback) => ipcRenderer.on('available-resolutions', (_event, resolutions) => callback(resolutions)),

  // --- Overlay Specific ---
  onOverlayData: (callback) => ipcRenderer.on('overlay-data', (_event, data) => callback(data)),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  setOverlayMouseEvents: (ignore, forward = true) => ipcRenderer.send('set-overlay-mouse-ignore', ignore, { forward }),
  activateOverlay: (resolution) => ipcRenderer.send('activate-overlay', resolution),
  executeScanFromOverlay: (resolution) => ipcRenderer.send('execute-scan-from-overlay', resolution),
  onOverlayClosedResetUI: (callback) => ipcRenderer.on('overlay-closed-reset-ui', () => callback()),

  // --- Snapshot Feature ---
  takeSnapshot: () => ipcRenderer.send('take-snapshot'),
  onSnapshotTaken: (callback) => ipcRenderer.on('snapshot-taken-status', (_event, status) => callback(status)),
  onToggleHotspotBorders: (callback) => ipcRenderer.on('toggle-hotspot-borders', (_event, visible) => callback(visible)),
});