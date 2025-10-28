const updateAllDataButton = document.getElementById('update-all-data-btn');
const activateOverlayButton = document.getElementById('activate-overlay-btn');
const resolutionSelect = document.getElementById('resolution-select');
const statusMessageElement = document.getElementById('status-message');
const lastUpdatedDateElement = document.getElementById('last-updated-date');
const exportFailedSamplesButton = document.getElementById('export-failed-samples-btn');
const uploadFailedSamplesButton = document.getElementById('upload-failed-samples-btn');
const failedSamplesUploadStatusElement = document.getElementById('failed-samples-upload-status');
const shareFeedbackExtButton = document.getElementById('share-feedback-ext-btn');
const shareSamplesExtButton = document.getElementById('share-samples-ext-btn');
const supportDevButton = document.getElementById('support-dev-btn');
const supportWindrunButton = document.getElementById('support-windrun-btn');
const systemThemeCheckbox = document.getElementById('system-theme-checkbox');
const lightDarkToggle = document.getElementById('light-dark-toggle');
const manualThemeControlsDiv = document.querySelector('.manual-theme-controls');
const newResolutionSection = document.getElementById('new-resolution-request-section');
const submitNewResolutionButton = document.getElementById('submit-new-resolution-btn');
const newResolutionStatusElement = document.getElementById('new-resolution-status');
const customResolutionPopup = document.getElementById('custom-resolution-popup');
const customPopupMessage = document.getElementById('custom-popup-message');
const customPopupSubmitLayoutBtn = document.getElementById('custom-popup-submit-layout-btn');
const customPopupChangeResBtn = document.getElementById('custom-popup-change-res-btn');
const screenshotPreviewPopup = document.getElementById('screenshot-preview-popup');
const screenshotPreviewImage = document.getElementById('screenshot-preview-image');
const screenshotSubmitBtn = document.getElementById('screenshot-submit-btn');
const screenshotRetakeBtn = document.getElementById('screenshot-retake-btn');
const languageSelect = document.getElementById('language-select');
const checkForUpdatesButton = document.getElementById('check-for-updates-btn');
const updateStatusMessageElement = document.getElementById('update-status-message');
const updateAvailablePopup = document.getElementById('update-available-popup');
const updatePopupVersion = document.getElementById('update-popup-version');
const updatePopupReleaseDate = document.getElementById('update-popup-release-date');
const updatePopupNotes = document.getElementById('update-popup-notes');
const updatePopupDownloadBtn = document.getElementById('update-popup-download-btn');
const updatePopupLaterBtn = document.getElementById('update-popup-later-btn');

import * as themeManager from './src/renderer/themeManager.js';
import * as translationUtils from './src/renderer/translationUtils.js';
import * as uiUtils from './src/renderer/uiUtils.js';
import * as initUtils from './src/renderer/initUtils.js';

/** @type {string} Stores the currently selected screen resolution (e.g., "1920x1080"). */
let selectedResolution = '';
/** @type {object | null} Stores system display information (width, height, scaleFactor, resolutionString). */
let systemDisplayInfo = null;
/** @type {string | null} Holds the Data URL of the captured screenshot for layout submission. */
let currentScreenshotDataUrl = null;
/** @type {object} Holds the currently loaded translation strings for the UI. */
let currentTranslations = {};


// --- Translation Functions ---
/**
 * Translates a key into a string using the loaded translations.
 * @param {string} key - The translation key (e.g., 'controlPanel.status.ready').
 * @param {object} [params={}] - Optional parameters to replace in the string (e.g., { count: 5 }).
 * @returns {string} The translated and formatted string.
 */
const translate = (key, params = {}) => translationUtils.translate(currentTranslations, key, params);

/**
 * Applies all translations to the document based on data-i18n attributes.
 */
function applyTranslations() {
    translationUtils.applyTranslationsToDOM(translate);
}

if (window.electronAPI) {
    console.log('[Renderer] Electron API available. Setting up listeners.');

    // Initialize Renderer Modules
    themeManager.initThemeManager({
        systemThemeCheckbox,
        lightDarkToggle,
        manualThemeControlsDiv,
        body: document.body,
    });

    uiUtils.initUIUtils({
        updateAllDataButton, activateOverlayButton, exportFailedSamplesButton,
        uploadFailedSamplesButton, shareFeedbackExtButton, shareSamplesExtButton,
        supportDevButton, supportWindrunButton, submitNewResolutionButton,
        resolutionSelect, languageSelect, systemThemeCheckbox, lightDarkToggle,
        statusMessageElement, customResolutionPopup, customPopupMessage, manualThemeControlsDiv,
    }, translate);

    initUtils.initConditionalUIManager({
        newResolutionSection,
        uploadFailedSamplesButton,
        exportFailedSamplesButton,
        shareSamplesExtButton,
    }, window.electronAPI);
    initUtils.initConditionalUI();

    window.electronAPI.getSystemDisplayInfo()
        .then(info => {
            systemDisplayInfo = info;
            console.log('[Renderer] System Display Info received:', systemDisplayInfo);
            window.electronAPI.getAvailableResolutions();
        })
        .catch(error => {
            console.error('[Renderer] Error getting system display info:', error);
            uiUtils.updateStatusMessage(translate('controlPanel.status.errorDisplayInfo'), true);
            window.electronAPI.getAvailableResolutions();
        });

    // Request initial data on load (e.g., last updated date, potentially other config)
    window.electronAPI.getInitialData();

    // --- IPC Event Handlers (Listening to Main Process) ---

    window.electronAPI.onTranslationsLoaded((translations) => {
        console.log('[Renderer] Translations loaded/updated.');
        currentTranslations = translations;
        applyTranslations();
        // After translations are loaded, update any UI elements that depend on them initially.
        uiUtils.updateStatusMessage({ key: 'controlPanel.status.ready' });
    });

    window.electronAPI.onUploadFailedSamplesStatus((status) => {
        console.log('[Renderer] Failed Samples Upload Status:', status);
        if (failedSamplesUploadStatusElement) {
            failedSamplesUploadStatusElement.textContent = status.message;
            failedSamplesUploadStatusElement.style.display = 'block';
            failedSamplesUploadStatusElement.classList.toggle('error-message', status.error);
        }
        if (status.error || !status.inProgress) {
            uiUtils.setButtonsState(false);
        }
    });

    window.electronAPI.onInitialSystemTheme(settings => {
        console.log('[Theme] Received initial system theme settings:', settings);
        themeManager.updateSystemPreference(settings.shouldUseDarkColors);
        themeManager.applyEffectiveTheme();
    });

    window.electronAPI.onSystemThemeUpdated(settings => {
        console.log('[Theme] System theme updated by OS:', settings);
        const oldSystemPrefersDark = themeManager.getCurrentSystemPrefersDark();
        themeManager.updateSystemPreference(settings.shouldUseDarkColors);
        if (themeManager.isUsingSystemTheme() && oldSystemPrefersDark !== settings.shouldUseDarkColors) {
            themeManager.applyEffectiveTheme();
        }
    });

    window.electronAPI.onAvailableResolutions((resolutions) => {
        if (!resolutionSelect) return;
        resolutionSelect.innerHTML = '';
        let resolutionEffectivelySelected = false;

        if (resolutions && resolutions.length > 0) {
            resolutions.forEach(res => {
                const option = document.createElement('option');
                option.value = res;
                option.textContent = res;
                resolutionSelect.appendChild(option);
            });

            if (systemDisplayInfo && systemDisplayInfo.resolutionString) {
                const systemResString = systemDisplayInfo.resolutionString;
                if (resolutions.includes(systemResString)) {
                    resolutionSelect.value = systemResString;
                    selectedResolution = systemResString;
                    uiUtils.updateStatusMessage({ key: 'controlPanel.status.resolutionsLoaded', params: { res: systemResString } });
                    resolutionEffectivelySelected = true;
                } else {
                    resolutionSelect.value = resolutions[0];
                    selectedResolution = resolutions[0];
                    uiUtils.showResolutionMismatchPopup(systemResString, selectedResolution);
                }
            } else {
                resolutionSelect.value = resolutions[0];
                selectedResolution = resolutions[0];
                uiUtils.updateStatusMessage(translate('controlPanel.status.resolutionDefaulted', { resolution: selectedResolution }));
                resolutionEffectivelySelected = true;
            }
        } else {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = translate('controlPanel.status.resolutionsNone');
            resolutionSelect.appendChild(option);
            selectedResolution = "";

            const errorMsg = (systemDisplayInfo && systemDisplayInfo.resolutionString)
                ? translate('controlPanel.status.noSupportedResolutionsWithSystem', { systemRes: systemDisplayInfo.resolutionString })
                : translate('controlPanel.status.noSupportedResolutions');
            uiUtils.updateStatusMessage(errorMsg, true);
            resolutionEffectivelySelected = false;
        }

        if (activateOverlayButton) {
            activateOverlayButton.disabled = !selectedResolution || (customResolutionPopup?.classList.contains('visible'));
        }

        if (exportFailedSamplesButton && exportFailedSamplesButton.style.display !== 'none') exportFailedSamplesButton.disabled = false;
        if (uploadFailedSamplesButton && uploadFailedSamplesButton.style.display !== 'none') uploadFailedSamplesButton.disabled = false;
        if (shareFeedbackExtButton) shareFeedbackExtButton.disabled = false;
        if (shareSamplesExtButton) shareSamplesExtButton.disabled = false;
        if (supportDevButton) supportDevButton.disabled = false;
        if (supportWindrunButton) supportWindrunButton.disabled = false;
        if (submitNewResolutionButton && newResolutionSection && newResolutionSection.style.display !== 'none') submitNewResolutionButton.disabled = false;
    });

    // Listener for status updates from Windrun.io data scraping
    window.electronAPI.onScrapeStatus((message) => {
        uiUtils.updateStatusMessage(message);
        if (uiUtils.isOperationFinishedMessage(message)) {
            uiUtils.setButtonsState(false);
        }
    });

    window.electronAPI.onExportFailedSamplesStatus((status) => {
        console.log('[Renderer] Export Failed Samples Status:', status);
        uiUtils.updateStatusMessage(status.message, status.error);
        if (status.error || !status.inProgress) {
            uiUtils.setButtonsState(false);
        }
        if (!status.error && !status.inProgress && status.filePath) {
            uiUtils.updateStatusMessage({ key: 'ipcMessages.exportSuccess', params: { count: status.count, filePath: status.filePath } });
        }
    });

    window.electronAPI.onLastUpdatedDate((dateStr) => {
        if (lastUpdatedDateElement) {
            lastUpdatedDateElement.textContent = dateStr || translate('controlPanel.data.lastUpdatedNever');
        }
    });

    window.electronAPI.onSetUIDisabledState((isDisabled) => {
        uiUtils.setButtonsState(isDisabled, isDisabled ? updateAllDataButton : null);
        if (isDisabled) {
            const syncingMsg = translate('controlPanel.status.syncingWindrun');
            uiUtils.updateStatusMessage(syncingMsg);
            if (updateAllDataButton) updateAllDataButton.textContent = syncingMsg; // Or a shorter version
        }
    });

    window.electronAPI.onScanResults((results) => {
        // This primarily handles errors during overlay activation or if the main process sends an error status for a scan.
        // Detailed scan results are typically handled by overlayRenderer.js.
        console.log('[Renderer] Scan-related message from main:', results);
        if (results && results.error) {
            uiUtils.setButtonsState(false);
            const resolution = results.resolution || selectedResolution || 'N/A';
            const errorMessage = translate('controlPanel.status.overlayScanErrorWithResolution', {
                error: results.error,
                resolution: resolution
            });
            uiUtils.updateStatusMessage(errorMessage, true);
        }
        // Non-error scan results are typically handled by overlayRenderer.js
    });

    window.electronAPI.onOverlayClosedResetUI(() => {
        console.log('[Renderer] Overlay closed signal received. Re-enabling main window UI.');
        uiUtils.setButtonsState(false);
        uiUtils.updateStatusMessage({ key: 'controlPanel.status.ready' });
    });

    window.electronAPI.onNewLayoutScreenshot((dataUrl) => {
        if (dataUrl) {
            currentScreenshotDataUrl = dataUrl;
            if (screenshotPreviewImage) screenshotPreviewImage.src = dataUrl;
            if (screenshotPreviewPopup) screenshotPreviewPopup.classList.add('visible');
            uiUtils.setGlobalControlsDisabledForModal(true);
            if (newResolutionStatusElement) newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusCaptured');
        } else {
            uiUtils.updateStatusMessage(translate('controlPanel.newResolution.statusCaptureFailed'), true);
            uiUtils.setButtonsState(false);
        }
    });

    window.electronAPI.onSubmitNewResolutionStatus((status) => {
        console.log('[Renderer] New Resolution Submission Status:', status);
        const statusElemToUse = (newResolutionSection?.style.display !== 'none' && newResolutionStatusElement)
            ? newResolutionStatusElement
            : null;

        if (statusElemToUse) {
            statusElemToUse.textContent = status.message; // Assuming message is already translated or a key handled by main
            statusElemToUse.style.display = 'block';
            statusElemToUse.classList.toggle('error-message', status.error);
        } else {
            uiUtils.updateStatusMessage(translate('controlPanel.newResolution.submissionStatusPrefix', { message: status.message }), status.error);
        }

        if (!status.inProgress) {
            uiUtils.setButtonsState(false);
            uiUtils.setGlobalControlsDisabledForModal(false);
        }
    });

    window.electronAPI.onAppUpdateNotification((updateInfo) => {
        console.log('[Renderer] App Update Notification from main:', updateInfo);

        // Hide "update available" popup by default, show only if status is 'available' or 'downloaded'
        if (updateInfo.status !== 'available' && updateInfo.status !== 'downloaded') {
            if (updateAvailablePopup) updateAvailablePopup.classList.remove('visible');
        }

        if (updateStatusMessageElement) {
            updateStatusMessageElement.classList.remove('error-message'); // Reset error styling

            switch (updateInfo.status) {
                case 'checking':
                    updateStatusMessageElement.textContent = translate('controlPanel.update.checking');
                    updateStatusMessageElement.style.display = 'block';
                    break;
                case 'error':
                    let finalErrorMessage;
                    const genericNetworkErrorMsg = translate('controlPanel.update.networkError');
                    const githubSpecificErrorMsg = translate('controlPanel.update.githubUnreachableError');

                    if (updateInfo.error) {
                        const errorStr = String(updateInfo.error).toLowerCase();
                        // Check for GitHub specific server errors (like 500, 502, 503, 504)
                        if (errorStr.includes('github.com') && (errorStr.includes('httperror: 500') || errorStr.includes('httperror: 502') || errorStr.includes('httperror: 503') || errorStr.includes('httperror: 504'))) {
                            finalErrorMessage = githubSpecificErrorMsg;
                            // Check for common general network errors
                        } else if (errorStr.includes('enotfound') || errorStr.includes('etimedout') || errorStr.includes('econnrefused') || errorStr.includes('net::err_internet_disconnected') || errorStr.includes('failed to fetch')) {
                            finalErrorMessage = genericNetworkErrorMsg;
                        } else {
                            // For other errors, use the detailed message from electron-updater if available
                            finalErrorMessage = updateInfo.error || translate('controlPanel.update.unknownError');
                        }
                    } else {
                        finalErrorMessage = translate('controlPanel.update.unknownError');
                    }
                    updateStatusMessageElement.textContent = `${translate('controlPanel.update.errorOccurred')}: ${finalErrorMessage}`.trim();
                    updateStatusMessageElement.style.display = 'block';
                    updateStatusMessageElement.classList.add('error-message');
                    break;
                case 'not-available':
                    // updateInfo.message is now the key 'controlPanel.update.latestVersion'
                    // The fallback `|| translate(...)` is technically redundant if main always sends the key.
                    updateStatusMessageElement.textContent = translate(updateInfo.message || 'controlPanel.update.latestVersion');
                    updateStatusMessageElement.style.display = 'block';
                    break;
                case 'available':
                case 'downloaded':
                    // The "update available" or "ready to install" popup will be shown by uiUtils.handleAppUpdateNotifications.
                    // Hide the general status message element for these cases.
                    updateStatusMessageElement.style.display = 'none';
                    break;
                case 'downloading':
                    updateStatusMessageElement.textContent = updateInfo.progress ?
                        translate('controlPanel.update.downloading', { percent: Math.round(updateInfo.progress.percent) }) :
                        // updateInfo.message is now the key 'controlPanel.update.downloadingNoProgress'
                        translate(updateInfo.message || 'controlPanel.update.downloadingNoProgress');
                    updateStatusMessageElement.style.display = 'block';
                    break;
                default:
                    updateStatusMessageElement.style.display = 'none';
            }
        }

        // Call uiUtils.handleAppUpdateNotifications to manage the "Update Available" popup
        uiUtils.handleAppUpdateNotifications(
            updateInfo,
            updateAvailablePopup, // The popup element itself
            { // Content elements within the popup
                updatePopupVersion,
                updatePopupReleaseDate,
                updatePopupNotes,
                updatePopupDownloadBtn,
                updatePopupLaterBtn
            },
            () => window.electronAPI.startDownloadUpdate(),    // Callback for "Download" button
            () => window.electronAPI.quitAndInstallUpdate()   // Callback for "Restart & Install" button
        );
    });

    // --- DOM Event Listeners (User Interactions) ---

    if (languageSelect) {
        languageSelect.addEventListener('change', (event) => {
            const langCode = event.target.value;
            console.log(`[Renderer] Language changed to: ${langCode}`);
            window.electronAPI.changeLanguage(langCode);
        });
    }

    if (customPopupChangeResBtn) {
        customPopupChangeResBtn.addEventListener('click', () => {
            uiUtils.hideResolutionMismatchPopup();
            if (resolutionSelect) {
                resolutionSelect.focus();
                uiUtils.updateStatusMessage(translate('controlPanel.status.selectSupportedResolution'));
            }
            if (activateOverlayButton) {
                activateOverlayButton.disabled = !selectedResolution;
            }
        });
    }

    if (uploadFailedSamplesButton) {
        uploadFailedSamplesButton.addEventListener('click', () => {
            console.log('[Renderer] "Upload Failed Samples" button clicked.');
            const confirmed = confirm(
                translate('controlPanel.feedback.uploadConfirmTitle') + "\n\n" +
                translate('controlPanel.feedback.uploadConfirmBody')
            );

            if (confirmed) {
                if (failedSamplesUploadStatusElement) {
                    failedSamplesUploadStatusElement.textContent = translate('controlPanel.feedback.uploadStatusZipping');
                    failedSamplesUploadStatusElement.style.display = 'block';
                    failedSamplesUploadStatusElement.classList.remove('error-message');
                }
                uiUtils.setButtonsState(true, uploadFailedSamplesButton);
                window.electronAPI.uploadFailedSamples();
            } else {
                if (failedSamplesUploadStatusElement) {
                    failedSamplesUploadStatusElement.textContent = translate('controlPanel.feedback.uploadCancelled');
                    failedSamplesUploadStatusElement.style.display = 'block';
                    failedSamplesUploadStatusElement.classList.remove('error-message');
                }
            }
        });
    }

    if (customPopupSubmitLayoutBtn) {
        customPopupSubmitLayoutBtn.addEventListener('click', () => {
            uiUtils.hideResolutionMismatchPopup();

            if (newResolutionSection && newResolutionSection.style.display !== 'none' && submitNewResolutionButton) {
                console.log('[Renderer] Mismatch popup "Submit Resolution" delegating to main submit button.');
                submitNewResolutionButton.click();
            } else {
                console.warn('[Renderer] Mismatch popup "Submit Resolution": Main submit section not visible. User will be prompted directly.');
                const resolutionText = systemDisplayInfo ? `${systemDisplayInfo.width}x${systemDisplayInfo.height}` : translate('terms.yourCurrentResolution');
                const directConfirmMessage = translate('controlPanel.newResolution.directSubmitConfirm', { resolution: resolutionText });

                const confirmed = confirm(directConfirmMessage);
                if (confirmed) {
                    uiUtils.updateStatusMessage(translate('controlPanel.newResolution.statusTakingSnapshot'), false);
                    uiUtils.setButtonsState(true, null);
                    window.electronAPI.requestNewLayoutScreenshot();
                } else {
                    uiUtils.updateStatusMessage(translate('controlPanel.newResolution.statusCancelled'), false);
                }
            }
        });
    }

    if (resolutionSelect) {
        resolutionSelect.addEventListener('change', (event) => {
            selectedResolution = event.target.value;
            console.log(`[Renderer] Selected resolution: ${selectedResolution}`);
            if (activateOverlayButton) {
                activateOverlayButton.disabled = !selectedResolution;
            }
        });
    }

    if (updateAllDataButton) {
        updateAllDataButton.addEventListener('click', () => {
            console.log('[Renderer] "Update Windrun Data" button clicked.');
            uiUtils.updateStatusMessage(translate('controlPanel.status.requestingWindrunUpdate'));
            uiUtils.setButtonsState(true, updateAllDataButton);
            window.electronAPI.scrapeAllWindrunData();
        });
    }

    if (activateOverlayButton) {
        activateOverlayButton.addEventListener('click', () => {
            if (!selectedResolution) {
                uiUtils.updateStatusMessage(translate('controlPanel.status.selectResolutionFirst'), true);
                return;
            }
            console.log(`[Renderer] "Activate Overlay" button clicked for resolution: ${selectedResolution}`);
            uiUtils.updateStatusMessage({ key: 'controlPanel.activation.activating' });
            uiUtils.setButtonsState(true, activateOverlayButton);
            window.electronAPI.activateOverlay(selectedResolution);
        });
    }

    if (exportFailedSamplesButton) {
        exportFailedSamplesButton.addEventListener('click', () => {
            console.log('[Renderer] "Export Failed Samples" button clicked.');
            uiUtils.updateStatusMessage(translate('controlPanel.feedback.exportButtonPreparing'));
            uiUtils.setButtonsState(true, exportFailedSamplesButton);
            window.electronAPI.exportFailedSamples();
        });
    }

    if (shareFeedbackExtButton) {
        shareFeedbackExtButton.addEventListener('click', () => {
            console.log('[Renderer] "Share Feedback" button clicked.');
            window.electronAPI.openExternalLink('https://tiarinhino.com/feedback.html');
        });
    }

    if (shareSamplesExtButton) {
        shareSamplesExtButton.addEventListener('click', () => {
            console.log('[Renderer] "Share Samples" button clicked.');
            window.electronAPI.openExternalLink('https://forms.gle/14Fmz6py7dAMMhKW9');
        });
    }

    if (supportDevButton) {
        supportDevButton.addEventListener('click', () => {
            console.log('[Renderer] "Support Developer" button clicked.');
            window.electronAPI.openExternalLink('https://ko-fi.com/tiarinhino');
        });
    }

    if (supportWindrunButton) {
        supportWindrunButton.addEventListener('click', () => {
            console.log('[Renderer] "Support Windrun.io" button clicked.');
            window.electronAPI.openExternalLink('https://ko-fi.com/datdota');
        });
    }

    if (systemThemeCheckbox) {
        systemThemeCheckbox.addEventListener('change', () => {
            if (systemThemeCheckbox.checked) {
                themeManager.saveUserPreference(themeManager.THEMES.SYSTEM);
            } else {
                // Switch to manual mode based on current light/dark toggle state
                themeManager.saveUserPreference(lightDarkToggle.checked ? themeManager.THEMES.DARK : themeManager.THEMES.LIGHT);
            }
            themeManager.applyEffectiveTheme();
        });
    }

    if (lightDarkToggle) {
        lightDarkToggle.addEventListener('click', () => { // Listen to click for immediate visual feedback before change fires
            if (lightDarkToggle.disabled) return;

            if (themeManager.isUsingSystemTheme()) {
                if (systemThemeCheckbox) systemThemeCheckbox.checked = false; // Uncheck system pref
            }
            themeManager.saveUserPreference(lightDarkToggle.checked ? themeManager.THEMES.DARK : themeManager.THEMES.LIGHT);
            themeManager.applyEffectiveTheme();
        });
    }

    if (submitNewResolutionButton) {
        submitNewResolutionButton.addEventListener('click', async () => {
            console.log('[Renderer] Section "Submit Current Screen Layout" button clicked.');

            let currentResInfo = systemDisplayInfo;
            if (!currentResInfo) {
                try { currentResInfo = await window.electronAPI.getSystemDisplayInfo(); systemDisplayInfo = currentResInfo; }
                catch (e) { console.error("Failed to get system info for confirmation", e); }
            }
            const resolutionString = currentResInfo ? `${currentResInfo.width}x${currentResInfo.height}` : translate('terms.yourCurrentResolution');
            const scaleFactorString = currentResInfo ? translate('terms.displayScale', { scale: Math.round(currentResInfo.scaleFactor * 100) }) : "";

            const confirmed = confirm(translate('controlPanel.newResolution.submitConfirm',
                { resolutionString, scaleFactorString })
            );

            if (confirmed) {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusTakingSnapshot');
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
                uiUtils.setButtonsState(true, submitNewResolutionButton);
                window.electronAPI.requestNewLayoutScreenshot();
            } else {
                if (newResolutionStatusElement) {
                    newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusCancelled');
                    newResolutionStatusElement.style.display = 'block';
                    newResolutionStatusElement.classList.remove('error-message');
                }
            }
        });
    }

    if (screenshotRetakeBtn) {
        screenshotRetakeBtn.addEventListener('click', () => {
            if (screenshotPreviewPopup) screenshotPreviewPopup.classList.remove('visible');
            currentScreenshotDataUrl = null; // Clear old data

            if (newResolutionStatusElement) newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusRetaking');
            window.electronAPI.requestNewLayoutScreenshot();
        });
    }

    if (screenshotSubmitBtn) {
        screenshotSubmitBtn.addEventListener('click', () => {
            if (currentScreenshotDataUrl) {
                if (screenshotPreviewPopup) screenshotPreviewPopup.classList.remove('visible');
                if (newResolutionStatusElement) newResolutionStatusElement.textContent = translate('controlPanel.newResolution.statusSubmitting');
                window.electronAPI.submitConfirmedLayout(currentScreenshotDataUrl);
            }
        });
    }

    if (checkForUpdatesButton) {
        checkForUpdatesButton.addEventListener('click', () => {
            console.log('[Renderer] Check for updates clicked.');
            if (updateStatusMessageElement) {
                updateStatusMessageElement.textContent = translate('controlPanel.update.checking');
                updateStatusMessageElement.style.display = 'block';
            }
            window.electronAPI.checkForUpdates();
        });
    }

    if (updatePopupDownloadBtn) {
        updatePopupDownloadBtn.addEventListener('click', () => {
            if (updateAvailablePopup) updateAvailablePopup.classList.remove('visible');
            if (updateStatusMessageElement) {
                updateStatusMessageElement.textContent = translate('controlPanel.update.downloading', { percent: 0 });
                updateStatusMessageElement.style.display = 'block';
            }
            window.electronAPI.startDownloadUpdate();
        });
    }

    if (updatePopupLaterBtn) {
        updatePopupLaterBtn.addEventListener('click', () => {
            if (updateAvailablePopup) updateAvailablePopup.classList.remove('visible');
        });
    }

} else {
    // Critical error: Electron API not exposed
    console.error('[Renderer] FATAL: Electron API not found. Preload script might not be configured or failed.');
    if (statusMessageElement) statusMessageElement.textContent = 'Error: Application setup issue. Cannot communicate with main process.'; // Raw message
    uiUtils.setButtonsState(true); // Attempt to disable all controls
    if (lastUpdatedDateElement) lastUpdatedDateElement.textContent = 'Error';
    if (activateOverlayButton) activateOverlayButton.disabled = true;
    if (exportFailedSamplesButton) exportFailedSamplesButton.disabled = true;
    if (shareFeedbackExtButton) shareFeedbackExtButton.disabled = true;
    if (shareSamplesExtButton) shareSamplesExtButton.disabled = true;
    if (supportDevButton) supportDevButton.disabled = true;
    if (supportWindrunButton) supportWindrunButton.disabled = true;
    document.body.classList.remove('dark-mode'); // Default to light
    if (systemThemeCheckbox) systemThemeCheckbox.disabled = true;
    if (lightDarkToggle) lightDarkToggle.disabled = true;
    if (manualThemeControlsDiv) manualThemeControlsDiv.classList.add('disabled');
}