/**
 * @file Manages the overlay window's user interface, interactions, and communication with the main process.
 * This includes displaying ability hotspots, tooltips, hero model information, OP combinations,
 * and handling user actions like initiating scans, reporting issues, and closing the overlay.
 */

// --- DOM Element References ---
import * as tooltip from './src/renderer/overlay/tooltip.js';
import * as hotspotManager from './src/renderer/overlay/hotspotManager.js';
import * as buttonManager from './src/renderer/overlay/buttonManager.js';
import * as uiUpdater from './src/renderer/overlay/uiUpdater.js';

const tooltipElement = document.getElementById('tooltip');
const scanStatusPopup = document.getElementById('scan-status-popup');
const closeOverlayButton = document.getElementById('close-overlay-btn');
const initialScanButton = document.getElementById('initial-scan-btn');
const rescanButton = document.getElementById('rescan-btn');
const resetOverlayButton = document.getElementById('reset-overlay-btn');
const reportFailedRecButton = document.getElementById('report-failed-rec-btn');
const snapshotStatusElement = document.getElementById('snapshot-status');
const controlsContainer = document.getElementById('controls-container');
const opCombinationsWindow = document.getElementById('op-combinations-window');
const opCombinationsListElement = document.getElementById('op-combinations-list');
const hideOpCombinationsButton = document.getElementById('hide-op-combinations-btn');
const showOpCombinationsButton = document.getElementById('show-op-combinations-btn');
const trapCombinationsWindow = document.getElementById('trap-combinations-window');
const trapCombinationsListElement = document.getElementById('trap-combinations-list');
const hideTrapCombinationsButton = document.getElementById('hide-trap-combinations-btn');
const showTrapCombinationsButton = document.getElementById('show-trap-combinations-btn');
const reportConfirmPopup = document.getElementById('report-confirm-popup');
const reportConfirmSubmitBtn = document.getElementById('report-confirm-submit-btn');
const reportConfirmCancelBtn = document.getElementById('report-confirm-cancel-btn');
const initialScanConfirmPopup = document.getElementById('initial-scan-confirm-popup');
const confirmScanProceedBtn = document.getElementById('confirm-scan-proceed-btn');
const confirmScanDontShowBtn = document.getElementById('confirm-scan-dont-show-btn');

// --- Constants ---
const LOCAL_STORAGE_HIDE_SCAN_CONFIRM_KEY = 'hideInitialScanConfirm';

// --- Module State ---
/** @type {object | null} Configuration for hotspot coordinates, scaled for the current resolution. */
let currentCoordinatesConfig = null;
/** @type {string | null} The target resolution string (e.g., "1920x1080") for the overlay. */
let currentTargetResolution = null;
/** @type {object} Holds the currently loaded translation strings. */
let currentTranslations = {};
/** @type {number} The display scale factor (e.g., 1, 1.25, 1.5) affecting element sizing. */
let currentScaleFactor = 1; // Default scale factor
/** @type {boolean} True if at least one scan has been successfully performed. */
let scanHasBeenPerformed = false;
/** @type {boolean} True if "OP Combinations" data is available to be shown. */
let opCombinationsAvailable = false;
/** @type {boolean} True if "Trap Combinations" data is available to be shown. */
let trapCombinationsAvailable = false;
/** @type {boolean} User preference to hide the initial scan confirmation popup. */
let hideInitialScanConfirm = false;

/**
 * @type {Array<object>}
 * Holds data for hero models identified on screen, used for creating "My Model" selection buttons.
 * Each object typically contains `dbHeroId`, `heroName`, `screenOrder`, etc.
 */
let currentHeroModelData = []; // Holds data for identified hero models on screen
/**
 * @type {Array<object>}
 * Holds data for heroes available for the "My Spot for Drafting" selection.
 * Each object typically contains `dbHeroId`, `heroName`, `heroOrder` (original 0-9 list index), etc.
 */
let currentHeroesForMySpotUIData = []; // Holds data for the "My Spot" selection buttons

/** @type {number | null} Original 0-9 list order of the hero the user is drafting for. */
let selectedHeroOriginalOrder = null; // Original 0-9 order of the user's drafted hero
/** @type {number | null} Screen order (0-11) of the hero selected as "My Model". */
let selectedModelScreenOrder = null;  // 0-11 screen order of the user-selected "model" hero

// --- Translation Functions ---
/**
 * Gets a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to search.
 * @param {string} path - The dot-notation path (e.g., 'a.b.c').
 * @returns {any} The value at the path, or the path itself if not found.
 */
function getNested(obj, path) {
    if (!path) return path;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Translates a key into a string using the loaded translations.
 * @param {string} key - The translation key (e.g., 'overlay.controls.rescan').
 * @param {object} [params={}] - Optional parameters to replace in the string (e.g., { count: 5 }).
 * @returns {string} The translated and formatted string.
 */
function translate(key, params = {}) {
    let translated = getNested(currentTranslations, key);
    if (typeof translated !== 'string') {
        console.warn(`[i18n] Translation not found for key: ${key}`);
        return key; // Fallback to the key itself
    }
    for (const [paramKey, paramValue] of Object.entries(params)) {
        translated = translated.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
    }
    return translated;
}

/**
 * Applies all translations to the document based on data-i18n attributes.
 */
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = translate(key);
        if (translation !== key) {
            element.textContent = translation;
        }
    });
}

// --- Popup Management ---
/**
 * Shows a modal popup element and disables mouse pass-through for the overlay.
 * @param {HTMLElement | null} popupElement - The popup element to show.
 */
function showModalPopup(popupElement) {
    if (popupElement) {
        popupElement.style.display = 'flex'; // Assumes flex is used for centering popups
        window.electronAPI?.setOverlayMouseEvents(false); // Capture mouse events
    }
}

/**
 * Hides a modal popup element and re-enables mouse pass-through for the overlay.
 * @param {HTMLElement | null} popupElement - The popup element to hide.
 */
function hideModalPopup(popupElement) {
    if (popupElement) {
        popupElement.style.display = 'none';
        window.electronAPI?.setOverlayMouseEvents(true); // Allow mouse events to pass through
    }
}

// --- Other Helper Functions ---

/**
 * Loads the user's preference for showing the initial scan confirmation popup from localStorage.
 */
function loadScanConfirmPreference() {
    try {
        const storedPref = localStorage.getItem('hideInitialScanConfirm');
        hideInitialScanConfirm = storedPref === 'true';
    } catch (e) {
        console.error("Could not read from localStorage", e);
        hideInitialScanConfirm = false; // Default to showing the confirmation on error
    }
}

/** @returns {number | null} The original 0-9 order of the user's drafted hero. */
function getSelectedHeroOriginalOrder() { return selectedHeroOriginalOrder; }

/**
 * @returns {number | null} The 0-11 screen order of the user-selected "model" hero.
 * This is used by imported modules to highlight or prioritize the selected model.
 */
function getSelectedModelScreenOrder() { return selectedModelScreenOrder; }

// --- Initialization ---

tooltip.initTooltip(tooltipElement);
hotspotManager.initHotspotManager({ getScaleFactor: () => currentScaleFactor, getSelectedHeroOriginalOrder, getSelectedModelScreenOrder, translateFn: translate, tooltip });
buttonManager.initButtonManager({ getScaleFactor: () => currentScaleFactor, getSelectedHeroOriginalOrder, getSelectedModelScreenOrder, translateFn: translate, electronAPI: window.electronAPI });
uiUpdater.initUIUpdater({ scanStatusPopup, opCombinationsWindow, opCombinationsListElement, showOpCombinationsButton, trapCombinationsWindow, trapCombinationsListElement, showTrapCombinationsButton, snapshotStatusElement }, translate);

/**
 * Resets the overlay UI to its initial state.
 */
function resetOverlayUI() {
    console.log('[OverlayRenderer] Resetting Overlay UI to initial state.');

    hotspotManager.clearAllHotspots();
    buttonManager.clearDynamicButtons();

    // Reset state variables
    scanHasBeenPerformed = false;
    selectedHeroOriginalOrder = null;
    selectedModelScreenOrder = null;
    currentHeroModelData = [];
    currentHeroesForMySpotUIData = [];
    opCombinationsAvailable = false;

    // Reset button visibility and states
    if (initialScanButton) { initialScanButton.style.display = 'inline-block'; initialScanButton.disabled = false; }
    if (rescanButton) { rescanButton.style.display = 'none'; }
    if (reportFailedRecButton) { reportFailedRecButton.style.display = 'none'; reportFailedRecButton.disabled = true; }
    if (resetOverlayButton) { resetOverlayButton.style.display = 'none'; }

    tooltip.hideTooltip();
    uiUpdater.updateOPCombinationsDisplay([], false); // Resets OP Combos
    opCombinationsAvailable = false; // Ensure state is also reset

    if (snapshotStatusElement) { snapshotStatusElement.textContent = ''; snapshotStatusElement.style.display = 'none'; }
    if (scanStatusPopup) { scanStatusPopup.textContent = ''; scanStatusPopup.style.display = 'none'; }

    uiUpdater.toggleAllDynamicBordersForSnapshot(true); // Show borders initially
    uiUpdater.updateVisualHighlights(selectedHeroOriginalOrder, selectedModelScreenOrder, tooltip.isTooltipVisible(), (visible) => uiUpdater.toggleAllDynamicBordersForSnapshot(visible));

    console.log('[OverlayRenderer] Overlay UI reset complete.');
}

/**
 * Triggers a scan (initial or rescan) by sending a request to the main process.
 * @param {boolean} isInitialScan - True if it's the first scan, false for a rescan.
 */
function triggerScan(isInitialScan) {
    const scanButtonToDisable = isInitialScan ? initialScanButton : rescanButton;

    if (scanButtonToDisable && scanButtonToDisable.disabled) return;

    if (scanButtonToDisable) scanButtonToDisable.disabled = true;
    if (reportFailedRecButton) reportFailedRecButton.disabled = true;
    if (resetOverlayButton && resetOverlayButton.style.display !== 'none') resetOverlayButton.style.display = 'none';
    hotspotManager.clearAllHotspots(); // Clear previous hotspots

    uiUpdater.updateOPCombinationsDisplay([], false); // Clears OP Combos
    opCombinationsAvailable = false;

    tooltip.hideTooltip();
    uiUpdater.toggleAllDynamicBordersForSnapshot(false); // Hide borders during scan

    if (!currentTargetResolution) {
        console.error('[OverlayRenderer] Cannot scan: target resolution not set.');
        uiUpdater.showScanStatusPopup('Error: Resolution not set.', true);
        if (scanButtonToDisable) scanButtonToDisable.disabled = false;
        if (reportFailedRecButton && initialScanButton && initialScanButton.style.display === 'none') reportFailedRecButton.disabled = false;
        return;
    }

    uiUpdater.showScanStatusPopup({ key: 'overlay.status.scanning', params: { resolution: currentTargetResolution } });
    console.log(`[OverlayRenderer] Triggering scan. Initial: ${isInitialScan}, Hero Order for Drafting: ${selectedHeroOriginalOrder}`);
    window.electronAPI.executeScanFromOverlay(currentTargetResolution, selectedHeroOriginalOrder, isInitialScan);
}

// --- IPC Event Handlers (from Main Process) ---

if (window.electronAPI) {
    window.electronAPI.onTranslationsLoaded((translations) => {
        console.log('[OverlayRenderer] Translations loaded/updated.');
        currentTranslations = translations;
        applyTranslations();
    });
    window.electronAPI.onOverlayData((data) => {
        console.log('[OverlayRenderer] === New Overlay Data Received ===', data);

        // Update core configuration and scale factor first
        if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) currentScaleFactor = data.scaleFactor;
        if (data.coordinatesConfig) currentCoordinatesConfig = data.coordinatesConfig;
        if (data.targetResolution) currentTargetResolution = data.targetResolution;

        // Handle errors immediately
        if (data.error) {
            console.error('[OverlayRenderer] Error message received from main process:', data.error);
            uiUpdater.showScanStatusPopup(`Error: ${data.error}`, true);
            if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
            if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
            if (reportFailedRecButton && reportFailedRecButton.disabled && initialScanButton && initialScanButton.style.display === 'none') {
                reportFailedRecButton.disabled = false;
            }
            if (resetOverlayButton && scanHasBeenPerformed) resetOverlayButton.style.display = 'inline-block';
            return;
        }

        // Process discrete data updates
        if (typeof data.opCombinations !== 'undefined') {
            const hasAbilityCombos = data.opCombinations && data.opCombinations.length > 0;
            const hasHeroSynergies = data.heroSynergies && data.heroSynergies.length > 0;
            const newOpCombosAvailable = hasAbilityCombos || hasHeroSynergies;
            uiUpdater.updateOPCombinationsDisplay(data.opCombinations, data.heroSynergies || []);
            opCombinationsAvailable = newOpCombosAvailable;
        }
        if (typeof data.trapCombinations !== 'undefined') {
            const hasAbilityCombos = data.trapCombinations && data.trapCombinations.length > 0;
            const hasHeroTraps = data.heroTraps && data.heroTraps.length > 0;
            const newTrapCombosAvailable = hasAbilityCombos || hasHeroTraps;
            uiUpdater.updateTrapCombinationsDisplay(data.trapCombinations, data.heroTraps || []);
            trapCombinationsAvailable = newTrapCombosAvailable;
        }
        if (data.heroModels) currentHeroModelData = data.heroModels;
        if (data.heroesForMySpotUI) currentHeroesForMySpotUIData = data.heroesForMySpotUI;

        // Update selected hero/model states based on data from main process
        if (typeof data.selectedHeroForDraftingDbId !== 'undefined') {
            const mySpotEntry = currentHeroesForMySpotUIData.find(h => h.dbHeroId === data.selectedHeroForDraftingDbId);
            selectedHeroOriginalOrder = mySpotEntry ? mySpotEntry.heroOrder : null;
        }
        if (typeof data.selectedModelHeroOrder !== 'undefined') {
            selectedModelScreenOrder = data.selectedModelHeroOrder;
            // If model selection changed via main process, ensure buttons reflect this
            buttonManager.updateHeroModelButtons(currentHeroModelData, currentCoordinatesConfig, currentTargetResolution);
        }

        // Process major data payloads: initial setup or scan results
        if (data.initialSetup) {
            console.log('[OverlayRenderer] Processing initialSetup...');
            resetOverlayUI();
        } else if (data.scanData) {
            console.log('[OverlayRenderer] Processing scanData...');
            scanHasBeenPerformed = true;
            if (scanStatusPopup) scanStatusPopup.style.display = 'none';

            if (!currentCoordinatesConfig || !currentTargetResolution) {
                console.error('[OverlayRenderer] Crucial config missing (coordinates/resolution). Cannot display hotspots.');
                uiUpdater.showScanStatusPopup('Error: Layout data missing.', true);
                if (initialScanButton && initialScanButton.disabled) initialScanButton.disabled = false;
                else if (rescanButton && rescanButton.disabled) rescanButton.disabled = false;
                return;
            }

            hotspotManager.clearAllHotspots();
            buttonManager.clearDynamicButtons();

            hotspotManager.createAbilityHotspots(data.scanData.ultimates, 'ultimates');
            hotspotManager.createAbilityHotspots(data.scanData.standard, 'standard');

            if (data.scanData.selectedAbilities) {
                hotspotManager.createAbilityHotspots(data.scanData.selectedAbilities, 'selected', true);
            }

            if (currentHeroModelData && currentHeroModelData.length > 0) {
                hotspotManager.createHeroModelHotspots(currentHeroModelData);
            }

            buttonManager.updateHeroModelButtons(currentHeroModelData, currentCoordinatesConfig, currentTargetResolution);
            buttonManager.updateMySpotButtons(currentHeroesForMySpotUIData, currentCoordinatesConfig, currentTargetResolution);
            uiUpdater.updateVisualHighlights(selectedHeroOriginalOrder, selectedModelScreenOrder, tooltip.isTooltipVisible(), (visible) => uiUpdater.toggleAllDynamicBordersForSnapshot(visible));

            if (initialScanButton) initialScanButton.style.display = 'none';
            if (rescanButton) { rescanButton.style.display = 'inline-block'; rescanButton.disabled = false; }
            if (reportFailedRecButton) { reportFailedRecButton.style.display = 'block'; reportFailedRecButton.disabled = false; }
            if (resetOverlayButton) resetOverlayButton.style.display = 'inline-block';

            tooltip.hideTooltip();
            uiUpdater.toggleAllDynamicBordersForSnapshot(true); // Show borders after scan processing

            if (snapshotStatusElement) snapshotStatusElement.style.display = 'none';
            console.log('[OverlayRenderer] Scan data processing finished.');
        }
    });

    window.electronAPI.onMyModelSelectionChanged(({ selectedModelHeroOrder }) => {
        console.log('[OverlayRenderer] My Model selection changed in main. New selection:', selectedModelHeroOrder);
        selectedModelScreenOrder = selectedModelHeroOrder;
        buttonManager.updateHeroModelButtons(currentHeroModelData, currentCoordinatesConfig, currentTargetResolution);
        uiUpdater.updateVisualHighlights(selectedHeroOriginalOrder, selectedModelScreenOrder, tooltip.isTooltipVisible(), (visible) => uiUpdater.toggleAllDynamicBordersForSnapshot(visible));
    });

    window.electronAPI.onMySpotForDraftingSelectionChanged(({ selectedHeroOrderForDrafting }) => {
        console.log('[OverlayRenderer] My Spot (for drafting) selection changed in main. New selection:', selectedHeroOrderForDrafting);
        selectedHeroOriginalOrder = selectedHeroOrderForDrafting;
        buttonManager.updateMySpotButtons(currentHeroesForMySpotUIData, currentCoordinatesConfig, currentTargetResolution);
        uiUpdater.updateVisualHighlights(selectedHeroOriginalOrder, selectedModelScreenOrder, tooltip.isTooltipVisible(), (visible) => uiUpdater.toggleAllDynamicBordersForSnapshot(visible));
    });

    window.electronAPI.onSnapshotTaken((status) => {
        uiUpdater.showSnapshotStatus(status.message, status.error);
        if (reportFailedRecButton && (!status.error || status.allowRetry)) {
            reportFailedRecButton.disabled = false;
        }
    });

    window.electronAPI.onToggleHotspotBorders((visible) => {
        console.log(`[OverlayRenderer] onToggleHotspotBorders received: ${visible}`);
        uiUpdater.toggleAllDynamicBordersForSnapshot(visible);

        // If borders are being made visible (typically after a snapshot or scan completion),
        // refresh visual highlights to ensure the correct state, respecting tooltip visibility.
        // This ensures that if a tooltip was active (which also hides borders), the borders
        // don't reappear incorrectly if the tooltip should still be hiding them,
        // or they do reappear if the tooltip is no longer active.
        if (visible) {
            uiUpdater.updateVisualHighlights(
                selectedHeroOriginalOrder,
                selectedModelScreenOrder,
                tooltip.isTooltipVisible(),
                (v) => uiUpdater.toggleAllDynamicBordersForSnapshot(v) // Pass the correct toggler function
            );
        }
    });

} else {
    console.error('[OverlayRenderer] Electron API not found. Preload script might not be configured correctly.');
    uiUpdater.showScanStatusPopup('Error: Application integration issue.', true);
}


// --- Event Listeners for Overlay Controls ---
if (initialScanButton) {
    initialScanButton.addEventListener('click', () => {
        if (hideInitialScanConfirm) {
            triggerScan(true); // Proceed directly if preference is set
        } else {
            showModalPopup(initialScanConfirmPopup);
        }
    });
}
if (rescanButton) {
    rescanButton.addEventListener('click', () => triggerScan(false));
}
if (resetOverlayButton) {
    resetOverlayButton.addEventListener('click', resetOverlayUI);
}
if (reportFailedRecButton) {
    reportFailedRecButton.addEventListener('click', () => {
        if (!scanHasBeenPerformed || reportFailedRecButton.disabled) return;

        showModalPopup(reportConfirmPopup);
    });
}
if (closeOverlayButton) {
    closeOverlayButton.addEventListener('click', () => window.electronAPI?.closeOverlay());
}
if (hideOpCombinationsButton && opCombinationsWindow && showOpCombinationsButton) {
    hideOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'none';
        opCombinationsWindow.setAttribute('aria-hidden', 'true');
        if (opCombinationsAvailable) {
            showOpCombinationsButton.style.display = 'block';
            showOpCombinationsButton.setAttribute('aria-expanded', 'false');
        }
    });
}
if (showOpCombinationsButton && opCombinationsWindow) {
    showOpCombinationsButton.addEventListener('click', () => {
        opCombinationsWindow.style.display = 'block';
        opCombinationsWindow.setAttribute('aria-hidden', 'false');
        showOpCombinationsButton.style.display = 'none';
        showOpCombinationsButton.setAttribute('aria-expanded', 'true');
    });
}
if (hideTrapCombinationsButton && trapCombinationsWindow && showTrapCombinationsButton) {
    hideTrapCombinationsButton.addEventListener('click', () => {
        trapCombinationsWindow.style.display = 'none';
        trapCombinationsWindow.setAttribute('aria-hidden', 'true');
        if (trapCombinationsAvailable) {
            showTrapCombinationsButton.style.display = 'block';
            showTrapCombinationsButton.setAttribute('aria-expanded', 'false');
        }
    });
}
if (showTrapCombinationsButton && trapCombinationsWindow) {
    showTrapCombinationsButton.addEventListener('click', () => {
        trapCombinationsWindow.style.display = 'block';
        trapCombinationsWindow.setAttribute('aria-hidden', 'false');
        showTrapCombinationsButton.style.display = 'none';
        showTrapCombinationsButton.setAttribute('aria-expanded', 'true');
    });
}
if (confirmScanProceedBtn) {
    confirmScanProceedBtn.addEventListener('click', () => {
        hideModalPopup(initialScanConfirmPopup);
        triggerScan(true);
    });
}
if (confirmScanDontShowBtn) {
    confirmScanDontShowBtn.addEventListener('click', () => {
        hideModalPopup(initialScanConfirmPopup); // Hide popup first
        hideInitialScanConfirm = true;
        try {
            localStorage.setItem(LOCAL_STORAGE_HIDE_SCAN_CONFIRM_KEY, 'true');
        } catch (e) {
            console.error("Could not write to localStorage", e);
        }
        // Allow clicks to pass through again and trigger the scan
        window.electronAPI?.setOverlayMouseEvents(true);
        triggerScan(true);
    });
}
if (reportConfirmSubmitBtn) {
    reportConfirmSubmitBtn.addEventListener('click', () => {
        hideModalPopup(reportConfirmPopup);

        // Now perform the original snapshot logic
        if (reportFailedRecButton) {
            reportFailedRecButton.disabled = true;
        }
        if (snapshotStatusElement) {
            snapshotStatusElement.textContent = translate('overlay.status.snapshotTaking');
            snapshotStatusElement.style.backgroundColor = 'rgba(0,100,200,0.8)';
            snapshotStatusElement.style.display = 'block';
        }
        window.electronAPI?.takeSnapshot();

        // Note: setOverlayMouseEvents(true) is handled by hideModalPopup
    });
}
if (reportConfirmCancelBtn) {
    reportConfirmCancelBtn.addEventListener('click', () => {
        hideModalPopup(reportConfirmPopup);
    });
}

// --- Global Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    window.electronAPI?.getInitialData();
    loadScanConfirmPreference();

    // Elements that should temporarily block mouse pass-through when hovered,
    // allowing interaction with overlay controls themselves.
    // Popups are handled by showModalPopup/hideModalPopup.
    const staticInteractiveElements = [
        controlsContainer,
        opCombinationsWindow,
        showOpCombinationsButton,
        trapCombinationsWindow,
        showTrapCombinationsButton,
        initialScanConfirmPopup,
        reportConfirmPopup
    ];
    staticInteractiveElements.forEach(element => {
        if (element) {
            element.addEventListener('mouseenter', () => window.electronAPI?.setOverlayMouseEvents(false));
            element.addEventListener('mouseleave', () => window.electronAPI?.setOverlayMouseEvents(true));
        }
    });
    window.electronAPI?.setOverlayMouseEvents(true); // Ensure pass-through is enabled by default
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.electronAPI?.closeOverlay();
    }
});