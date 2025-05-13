// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // Hero scraping trigger
  scrapeHeroes: () => ipcRenderer.send('scrape-heroes'),

  // Ability scraping trigger
  scrapeAbilities: () => ipcRenderer.send('scrape-abilities'),

  // Ability Pairs scraping trigger (NEW)
  scrapeAbilityPairs: () => ipcRenderer.send('scrape-ability-pairs'),

  // Screen Scanning trigger (NEW)
  scanDraftScreen: () => ipcRenderer.send('scan-draft-screen'),

  // Listener for status updates (reused for all)
  onUpdateStatus: (callback) => ipcRenderer.on('scrape-status', (_event, message) => callback(message)),

  // Listener for scan results (NEW)
  onScanResults: (callback) => ipcRenderer.on('scan-results', (_event, results) => callback(results)),
});