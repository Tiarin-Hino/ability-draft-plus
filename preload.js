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

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Sends a request to the main process to scrape all data from Windrun.io.
   */
  scrapeAllWindrunData: () => ipcRenderer.send('scrape-all-windrun-data'),

  /**
   * Sends a request to the main process to get the list of available screen resolutions
   * defined in the layout_coordinates.json configuration file.
   */
  getAvailableResolutions: () => ipcRenderer.send('get-available-resolutions'),

  /**
   * Registers a callback function to be invoked when the main process sends a scrape status update.
   * The message can be a string or an object with a translation key and params.
   * @param {(message: string | object) => void} callback - The function to call with the status message.
   */
  onUpdateStatus: (callback) => ipcRenderer.on('scrape-status', (_event, message) => callback(message)),

  /**
   * Registers a callback function to be invoked when the main process sends scan results
   * or error information related to a screen scan.
   * @param {(results: object) => void} callback - The function to call with the scan results or error object.
   */
  onScanResults: (callback) => ipcRenderer.on('scan-results', (_event, results) => callback(results)),

  /**
   * Registers a callback function to be invoked when the main process sends the list
   * of available screen resolutions.
   * @param {(resolutions: string[]) => void} callback - The function to call with an array of resolution strings.
   */
  onAvailableResolutions: (callback) => ipcRenderer.on('available-resolutions', (_event, resolutions) => callback(resolutions)),

  /**
   * Registers a callback function to be invoked when the main process sends the
   * last updated date for the scraped data.
   * @param {(dateStr: string | null) => void} callback - The function to call with the formatted date string or null.
   */
  onLastUpdatedDate: (callback) => ipcRenderer.on('last-updated-date', (_event, dateStr) => callback(dateStr)),

  /**
   * Registers a callback function to be invoked when the main process requests to
   * enable or disable UI elements in the main control panel (e.g., during initial data sync).
   * @param {(isDisabled: boolean) => void} callback - The function to call with a boolean indicating if UI should be disabled.
   */
  onSetUIDisabledState: (callback) => ipcRenderer.on('set-ui-disabled-state', (_event, isDisabled) => callback(isDisabled)),

  /**
   * (For Overlay Renderer) Registers a callback function to be invoked when the main process sends
   * data to the overlay (e.g., scan results, configuration).
   * @param {(data: object) => void} callback - The function to call with the overlay data object.
   */
  onOverlayData: (callback) => ipcRenderer.on('overlay-data', (_event, data) => callback(data)),

  /**
   * (For Overlay Renderer) Sends a request to the main process to close the overlay window.
   */
  closeOverlay: () => ipcRenderer.send('close-overlay'),

  /**
   * (For Overlay Renderer) Sends a request to the main process to set whether mouse events
   * should be ignored by the overlay window (allowing clicks to pass through).
   * @param {boolean} ignore - True to ignore mouse events, false to capture them.
   * @param {boolean} [forward=true] - (Windows specific) Whether to forward mouse move messages when ignored.
   */
  setOverlayMouseEvents: (ignore, forward = true) => ipcRenderer.send('set-overlay-mouse-ignore', ignore, { forward }),

  /**
   * Sends a request to the main process to activate the overlay for a specified screen resolution.
   * @param {string} resolution - The selected screen resolution string (e.g., "1920x1080").
   */
  activateOverlay: (resolution) => ipcRenderer.send('activate-overlay', resolution),

  /**
   * (For Overlay Renderer) Sends a request to the main process to execute a screen scan.
   * @param {string} resolution - The target screen resolution for the scan.
   * @param {number | null} selectedHeroOrder - The original list order (0-9) of the hero the user is drafting for, if selected.
   * @param {boolean} isInitialScan - True if this is the first scan after overlay activation.
   */
  executeScanFromOverlay: (resolution, selectedHeroOrder, isInitialScan) => ipcRenderer.send('execute-scan-from-overlay', resolution, selectedHeroOrder, isInitialScan),

  /**
   * Registers a callback function to be invoked when the main process signals that
   * the overlay window has been closed, allowing the main control panel UI to reset.
   * @param {() => void} callback - The function to call.
   */
  onOverlayClosedResetUI: (callback) => ipcRenderer.on('overlay-closed-reset-ui', () => callback()),

  /**
   * (For Overlay Renderer) Sends a request to the main process to take a snapshot of the
   * current ability icons on screen for feedback purposes.
   */
  takeSnapshot: () => ipcRenderer.send('take-snapshot'),

  /**
   * (For Overlay Renderer) Registers a callback function to be invoked when the main process
   * sends the status of a snapshot operation.
   * @param {(status: SnapshotStatus) => void} callback - The function to call with the snapshot status.
   */
  onSnapshotTaken: (callback) => ipcRenderer.on('snapshot-taken-status', (_event, status) => callback(status)),

  /**
   * (For Overlay Renderer) Registers a callback function to be invoked when the main process
   * requests to toggle the visibility of hotspot borders (e.g., before taking a snapshot).
   * @param {(visible: boolean) => void} callback - The function to call with a boolean indicating if borders should be visible.
   */
  onToggleHotspotBorders: (callback) => ipcRenderer.on('toggle-hotspot-borders', (_event, visible) => callback(visible)),

  /**
   * Sends a request to the main process to export images of misidentified abilities
   * that were saved via the "Take Snapshot" feature.
   */
  exportFailedSamples: () => ipcRenderer.send('export-failed-samples'),

  /**
   * Registers a callback function to be invoked when the main process sends status updates
   * about the "Export Failed Samples" operation.
   * @param {(status: ExportFailedSamplesStatus) => void} callback - The function to call with the export status.
   */
  onExportFailedSamplesStatus: (callback) => ipcRenderer.on('export-failed-samples-status', (_event, status) => callback(status)),

  /**
   * (For Overlay Renderer) Sends the user's "My Model" selection (a hero model whose abilities
   * might be prioritized for suggestions) to the main process.
   * @param {MyModelSelectionData} data - Object containing heroOrder and dbHeroId of the selected model.
   */
  selectMyModel: (data) => ipcRenderer.send('select-my-model', data),

  /**
   * (For Overlay Renderer) Registers a callback function to be invoked when the "My Model"
   * selection is changed in the main process, so the overlay UI can update.
   * @param {(data: { selectedModelHeroOrder: number | null }) => void} callback - The function to call with the updated selection.
   */
  onMyModelSelectionChanged: (callback) => ipcRenderer.on('my-model-selection-changed', (_event, data) => callback(data)),

  /**
   * (For Overlay Renderer) Sends the user's own hero selection for the current draft to the main process.
   * This helps tailor statistics and suggestions.
   * @param {MySpotForDraftingSelectionData} data - Object containing heroOrder (original 0-9 list index) and dbHeroId.
   */
  selectMySpotForDrafting: (data) => ipcRenderer.send('select-my-spot-for-drafting', data),

  /**
   * (For Overlay Renderer) Registers a callback function to be invoked when the "My Spot for Drafting"
   * selection is changed in the main process, so the overlay UI can update.
   * @param {(data: { selectedHeroOrderForDrafting: number | null, selectedHeroDbId: number | null }) => void} callback - The function to call with the updated selection.
   */
  onMySpotForDraftingSelectionChanged: (callback) => ipcRenderer.on('my-spot-for-drafting-selection-changed', (_event, data) => callback(data)),

  /**
  * Sends a request to the main process to open the given URL in the default external browser.
  * @param {string} url - The URL to open.
  */
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  /**
   * Registers a callback to receive the initial system theme setting when the window loads.
   * This is pushed by the main process.
   * @param {(settings: {shouldUseDarkColors: boolean}) => void} callback
   */
  onInitialSystemTheme: (callback) => ipcRenderer.on('initial-system-theme', (_event, settings) => callback(settings)),

  /**
   * Registers a callback function to be invoked when the system's theme preference
   * is updated by the operating system.
   * @param {(settings: {shouldUseDarkColors: boolean}) => void} callback
   */
  onSystemThemeUpdated: (callback) => ipcRenderer.on('system-theme-updated', (_event, settings) => callback(settings)),

  /**
   * Gets the current system theme settings on demand.
   * @returns {Promise<{shouldUseDarkColors: boolean}>}
   */
  getCurrentSystemTheme: () => ipcRenderer.invoke('get-current-system-theme'),

  /**
   * Registers a callback function to be invoked when the main process sends status updates
   * about the "Submit New Resolution Snapshot" operation.
   * @param {(status: {message: string, error: boolean, inProgress: boolean}) => void} callback
   */
  onSubmitNewResolutionStatus: (callback) => ipcRenderer.on('submit-new-resolution-status', (_event, status) => callback(status)),

  /**
   * Checks if the application is currently running in a packaged state.
   * @returns {Promise<boolean>} True if packaged, false otherwise.
   */
  isAppPackaged: () => ipcRenderer.invoke('is-app-packaged'),

  /**
   * Sends a request to the main process to zip and upload failed samples.
   */
  uploadFailedSamples: () => ipcRenderer.send('upload-failed-samples'),

  /**
   * Registers a callback for status updates during failed samples upload.
   * @param {(status: {message: string, error: boolean, inProgress: boolean}) => void} callback
   */
  onUploadFailedSamplesStatus: (callback) => ipcRenderer.on('upload-failed-samples-status', (_event, status) => callback(status)),

  /**
   * Gets the primary display's current resolution and scale factor.
   * @returns {Promise<{width: number, height: number, scaleFactor: number, resolutionString: string}>}
   */
  getSystemDisplayInfo: () => ipcRenderer.invoke('get-system-display-info'),

  /**
   * Requests that the main process take a screenshot for the new layout preview.
   */
  requestNewLayoutScreenshot: () => ipcRenderer.send('request-new-layout-screenshot'),

  /**
   * Registers a callback for when the main process sends back the captured screenshot data.
   * @param {(dataUrl: string | null) => void} callback
   */
  onNewLayoutScreenshot: (callback) => ipcRenderer.on('new-layout-screenshot-taken', (_event, dataUrl) => callback(dataUrl)),

  /**
   * Sends the confirmed screenshot (as a data URL) to the main process for API submission.
   * @param {string} dataUrl - The screenshot data URL to submit.
   */
  submitConfirmedLayout: (dataUrl) => ipcRenderer.send('submit-confirmed-layout', dataUrl),

  // --- Localization ---
  /**
   * Notifies the main process that the user has changed the language.
   * @param {string} langCode - The new language code (e.g., "en", "ru").
   */
  changeLanguage: (langCode) => ipcRenderer.send('change-language', langCode),

  /**
   * Registers a callback to receive translation data from the main process.
   * This is triggered on initial load and when the language is changed.
   * @param {(translations: object) => void} callback
   */
  onTranslationsLoaded: (callback) => ipcRenderer.on('translations-loaded', (_event, translations) => callback(translations)),

  /**
   * Requests initial data (including translations) from the main process.
   */
  getInitialData: () => ipcRenderer.send('get-initial-data'),
});