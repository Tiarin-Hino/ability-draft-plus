const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  scrapeAllWindrunData: () => ipcRenderer.send('scrape-all-windrun-data'),
  getAvailableResolutions: () => ipcRenderer.send('get-available-resolutions'),
  onUpdateStatus: (callback) => ipcRenderer.on('scrape-status', (_event, message) => callback(message)),
  onScanResults: (callback) => ipcRenderer.on('scan-results', (_event, results) => callback(results)),
  onAvailableResolutions: (callback) => ipcRenderer.on('available-resolutions', (_event, resolutions) => callback(resolutions)),
  onLastUpdatedDate: (callback) => ipcRenderer.on('last-updated-date', (_event, dateStr) => callback(dateStr)),
  onSetUIDisabledState: (callback) => ipcRenderer.on('set-ui-disabled-state', (_event, isDisabled) => callback(isDisabled)),
  onOverlayData: (callback) => ipcRenderer.on('overlay-data', (_event, data) => callback(data)),
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  setOverlayMouseEvents: (ignore, forward = true) => ipcRenderer.send('set-overlay-mouse-ignore', ignore, { forward }),
  activateOverlay: (resolution) => ipcRenderer.send('activate-overlay', resolution),
  executeScanFromOverlay: (resolution, selectedHeroOrder) => ipcRenderer.send('execute-scan-from-overlay', resolution, selectedHeroOrder),
  onOverlayClosedResetUI: (callback) => ipcRenderer.on('overlay-closed-reset-ui', () => callback()),
  takeSnapshot: () => ipcRenderer.send('take-snapshot'),
  onSnapshotTaken: (callback) => ipcRenderer.on('snapshot-taken-status', (_event, status) => callback(status)),
  onToggleHotspotBorders: (callback) => ipcRenderer.on('toggle-hotspot-borders', (_event, visible) => callback(visible)),
  exportFailedSamples: () => ipcRenderer.send('export-failed-samples'),
  onExportFailedSamplesStatus: (callback) => ipcRenderer.on('export-failed-samples-status', (_event, status) => callback(status)),
});