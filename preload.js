const { contextBridge, ipcRenderer } = require('electron');

/**
 * @typedef {object} SnapshotStatus
 * @property {string} message - A message describing the status of the snapshot operation.
 * @property {boolean} [error] - True if an error occurred, otherwise false or undefined.
 * @property {boolean} [allowRetry] - True if the operation can be retried, otherwise false or undefined.
 */

/**
 * @typedef {object} ExportFailedSamplesStatus
 * @property {string} message - A message describing the status of the export operation.
 * @property {boolean} error - True if an error occurred.
 * @property {boolean} inProgress - True if the operation is still in progress.
 * @property {string | null} [filePath] - The path to the exported file if successful.
 */

/**
 * @typedef {object} MyModelSelectionData
 * @property {number | null} heroOrder - The screen order (0-11) of the selected hero model.
 * @property {number | null} dbHeroId - The database ID of the selected hero model.
 */

/**
 * @typedef {object} MySpotForDraftingSelectionData
 * @property {number | null} selectedHeroOrderForDrafting - The original list order (0-9) of the hero selected for drafting.
 * @property {number | null} selectedHeroDbId - The database ID of the hero selected for drafting.
 */

//! IMPORTANT:
//! When adding new IPC channels, ensure they are unique and descriptive.
//! Corresponding handlers must be set up in the main process (e.g., in relevant ipcHandler files).

contextBridge.exposeInMainWorld('electronAPI', {
  getInitialData: () => ipcRenderer.send('get-initial-data'),

  // --- Application Lifecycle & Updates ---
  /**
   * Sends a request to the main process to check for application updates.
   */
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  /**
   * Sends a request to the main process to start downloading an available update.
   */
  startDownloadUpdate: () => ipcRenderer.send('start-download-update'),
  /**
   * Sends a request to the main process to quit the application and install a downloaded update.
   */
  quitAndInstallUpdate: () => ipcRenderer.send('quit-and-install-update'),
  /**
   * Registers a callback for application update notifications from the main process.
   * @param {(updateInfo: {status: string, info?: any, error?: any, progress?: any}) => void} callback - Function to call with update details.
   * @remarks Ensure 'renderer.js' uses this for app updates and the main process sends on 'app-update-notification'.
   */
  onAppUpdateNotification: (callback) => ipcRenderer.on('app-update-notification', (_event, updateInfo) => callback(updateInfo)),
  /**
   * Checks if the application is currently running in a packaged state.
   * @returns {Promise<boolean>} True if packaged, false otherwise.
   */
  isAppPackaged: () => ipcRenderer.invoke('is-app-packaged'),

  // --- Main Window: Data & State ---
  /**
   * Sends a request to the main process to scrape all data from Windrun.io.
   */
  scrapeAllWindrunData: () => ipcRenderer.send('scrape-all-windrun-data'),
  /**
   * Registers a callback for status updates during Windrun.io data scraping.
   * The message can be a string or an object with a translation key and params.
   * @param {(message: string | object) => void} callback - The function to call with the scrape status message.
   */
  onScrapeStatus: (callback) => ipcRenderer.on('scrape-status', (_event, message) => callback(message)),
  /**
   * Sends a request to get available screen resolutions from the configuration.
   */
  getAvailableResolutions: () => ipcRenderer.send('get-available-resolutions'),
  /**
   * Registers a callback for when the main process sends the list of available screen resolutions.
   * @param {(resolutions: string[]) => void} callback - Function to call with an array of resolution strings.
   */
  onAvailableResolutions: (callback) => ipcRenderer.on('available-resolutions', (_event, resolutions) => callback(resolutions)),
  /**
   * Registers a callback for when the main process sends the last updated date for scraped data.
   * @param {(dateStr: string | null) => void} callback - Function to call with the formatted date string or null.
   */
  onLastUpdatedDate: (callback) => ipcRenderer.on('last-updated-date', (_event, dateStr) => callback(dateStr)),
  /**
   * Gets the primary display's current resolution and scale factor.
   * @returns {Promise<{width: number, height: number, scaleFactor: number, resolutionString: string} | null>}
   */
  getSystemDisplayInfo: () => ipcRenderer.invoke('get-system-display-info'),

  // --- Main Window: UI & Interaction ---
  /**
   * Registers a callback for requests from the main process to enable/disable UI elements.
   * @param {(isDisabled: boolean) => void} callback - Function to call with a boolean indicating UI disable state.
   */
  onSetUIDisabledState: (callback) => ipcRenderer.on('set-ui-disabled-state', (_event, isDisabled) => callback(isDisabled)),
  /**
   * Registers a callback for when the overlay window is closed, to reset the main window UI.
   * @param {() => void} callback - The function to call.
   */
  onOverlayClosedResetUI: (callback) => ipcRenderer.on('overlay-closed-reset-ui', () => callback()),
  /**
  * Sends a request to open a URL in the default external browser.
  * @param {string} url - The URL to open.
  */
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  // --- Main Window: Theme Management ---
  /**
   * Registers a callback to receive the initial system theme setting.
   * @param {(settings: {shouldUseDarkColors: boolean}) => void} callback
   */
  onInitialSystemTheme: (callback) => ipcRenderer.on('initial-system-theme', (_event, settings) => callback(settings)),
  /**
   * Registers a callback for updates to the system's theme preference.
   * @param {(settings: {shouldUseDarkColors: boolean}) => void} callback
   */
  onSystemThemeUpdated: (callback) => ipcRenderer.on('system-theme-updated', (_event, settings) => callback(settings)),
  /**
   * Gets the current system theme settings on demand.
   * @returns {Promise<{shouldUseDarkColors: boolean}>}
   */
  getCurrentSystemTheme: () => ipcRenderer.invoke('get-current-system-theme'),

  // --- Main Window: Localization ---
  /**
   * Notifies the main process of a language change.
   * @param {string} langCode - The new language code (e.g., "en", "ru").
   */
  changeLanguage: (langCode) => ipcRenderer.send('change-language', langCode),
  /**
   * Registers a callback to receive translation data.
   * Triggered on initial load and on language change.
   * @param {(translations: object) => void} callback
   */
  onTranslationsLoaded: (callback) => ipcRenderer.on('translations-loaded', (_event, translations) => callback(translations)),

  // --- Main Window: Feedback & Layout Submission ---
  /**
   * Sends a request to export images of misidentified abilities.
   */
  exportFailedSamples: () => ipcRenderer.send('export-failed-samples'),
  /**
   * Registers a callback for status updates on the "Export Failed Samples" operation.
   * @param {(status: ExportFailedSamplesStatus) => void} callback - Function to call with export status.
   */
  onExportFailedSamplesStatus: (callback) => ipcRenderer.on('export-failed-samples-status', (_event, status) => callback(status)),
  /**
   * Sends a request to zip and upload failed samples.
   */
  uploadFailedSamples: () => ipcRenderer.send('upload-failed-samples'),
  /**
   * Registers a callback for status updates during failed samples upload.
   * @param {(status: {message: string, error: boolean, inProgress: boolean}) => void} callback
   */
  onUploadFailedSamplesStatus: (callback) => ipcRenderer.on('upload-failed-samples-status', (_event, status) => callback(status)),
  /**
   * Requests the main process to take a screenshot for new layout preview.
   */
  requestNewLayoutScreenshot: () => ipcRenderer.send('request-new-layout-screenshot'),
  /**
   * Registers a callback for when the main process sends captured screenshot data.
   * @param {(dataUrl: string | null) => void} callback - Function to call with screenshot data URL or null.
   */
  onNewLayoutScreenshot: (callback) => ipcRenderer.on('new-layout-screenshot-taken', (_event, dataUrl) => callback(dataUrl)),
  /**
   * Sends a confirmed screenshot (as data URL) to the main process for API submission.
   * @param {string} dataUrl - The screenshot data URL.
   */
  submitConfirmedLayout: (dataUrl) => ipcRenderer.send('submit-confirmed-layout', dataUrl),
  /**
   * Registers a callback for status updates on "Submit New Resolution Snapshot" operation.
   * @param {(status: {message: string, error: boolean, inProgress: boolean}) => void} callback
   */
  onSubmitNewResolutionStatus: (callback) => ipcRenderer.on('submit-new-resolution-status', (_event, status) => callback(status)),

  // --- Overlay Window API ---
  /**
   * Sends a request to activate the overlay for a specified screen resolution.
   * @param {string} resolution - The selected screen resolution string (e.g., "1920x1080").
   */
  activateOverlay: (resolution) => ipcRenderer.send('activate-overlay', resolution),
  /**
   * Sends the user-configured OP threshold percentage to the main process.
   * @param {number} threshold - The threshold as a decimal (e.g., 0.13 for 13%).
   */
  setOpThreshold: (threshold) => ipcRenderer.send('set-op-threshold', threshold),
  /**
   * Registers a callback for data sent from the main process to the overlay (e.g., scan results, config).
   * @param {(data: object) => void} callback - Function to call with overlay data.
   */
  onOverlayData: (callback) => ipcRenderer.on('overlay-data', (_event, data) => callback(data)),
  /**
   * Sends a request to close the overlay window.
   */
  closeOverlay: () => ipcRenderer.send('close-overlay'),
  /**
   * Sends a request to set mouse event pass-through for the overlay window.
   * @param {boolean} ignore - True to ignore mouse events (pass-through), false to capture.
   * @param {boolean} [forward=true] - (Windows specific) Whether to forward mouse move messages when ignored.
   */
  setOverlayMouseEvents: (ignore, forward = true) => ipcRenderer.send('set-overlay-mouse-ignore', ignore, { forward }),
  /**
   * Sends a request to execute a screen scan from the overlay.
   * @param {string} resolution - Target screen resolution for the scan.
   * @param {number | null} selectedHeroOrder - Original list order (0-9) of the hero being drafted for.
   * @param {boolean} isInitialScan - True if this is the first scan after overlay activation.
   */
  executeScanFromOverlay: (resolution, selectedHeroOrder, isInitialScan) => ipcRenderer.send('execute-scan-from-overlay', resolution, selectedHeroOrder, isInitialScan),
  /**
   * Registers a callback for scan results or errors, typically for the main window before detailed processing.
   * @param {(results: object) => void} callback - Function to call with scan results/error object.
   */
  onScanResults: (callback) => ipcRenderer.on('scan-results', (_event, results) => callback(results)),
  /**
   * Sends a request to take a snapshot of ability icons for feedback.
   */
  takeSnapshot: () => ipcRenderer.send('take-snapshot'),
  /**
   * Registers a callback for the status of a snapshot operation.
   * @param {(status: SnapshotStatus) => void} callback - Function to call with snapshot status.
   */
  onSnapshotTaken: (callback) => ipcRenderer.on('snapshot-taken-status', (_event, status) => callback(status)),
  /**
   * Registers a callback for requests to toggle hotspot border visibility (e.g., for snapshots).
   * @param {(visible: boolean) => void} callback - Function to call with visibility state.
   */
  onToggleHotspotBorders: (callback) => ipcRenderer.on('toggle-hotspot-borders', (_event, visible) => callback(visible)),
  /**
   * Sends the user's "My Model" selection to the main process.
   * @param {MyModelSelectionData} data - Data of the selected model.
   */
  selectMyModel: (data) => ipcRenderer.send('select-my-model', data),
  /**
   * Registers a callback for when "My Model" selection changes in the main process.
   * @param {(data: { selectedModelHeroOrder: number | null }) => void} callback - Function to call with updated selection.
   */
  onMyModelSelectionChanged: (callback) => ipcRenderer.on('my-model-selection-changed', (_event, data) => callback(data)),
  /**
   * Sends the user's hero selection for the current draft to the main process.
   * @param {MySpotForDraftingSelectionData} data - Data of the hero selected for drafting.
   */
  selectMySpotForDrafting: (data) => ipcRenderer.send('select-my-spot-for-drafting', data),
  /**
   * Registers a callback for when "My Spot for Drafting" selection changes in the main process.
   * @param {(data: { selectedHeroOrderForDrafting: number | null, selectedHeroDbId: number | null }) => void} callback
   */
  onMySpotForDraftingSelectionChanged: (callback) => ipcRenderer.on('my-spot-for-drafting-selection-changed', (_event, data) => callback(data)),
});