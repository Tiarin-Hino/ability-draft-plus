/**
 * @file Registers IPC handlers for feedback-related features.
 * This includes uploading failed OCR samples, taking snapshots of ability regions for feedback,
 * exporting these samples, and handling submission of new screen layouts/resolutions.
 */

const { ipcMain, app, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const archiver = require('archiver');
const sharp = require('sharp');
const axios = require('axios');
const screenshotDesktop = require('screenshot-desktop');
const crypto = require('crypto');

const stateManager = require('../stateManager');
const windowManager = require('../windowManager');
const { delay, generateHmacSignature, sendStatusUpdate } = require('../utils');
const { API_ENDPOINT_URL, CLIENT_API_KEY, CLIENT_SHARED_SECRET } = require('../../../config');

const FAILED_SAMPLES_DIR_NAME = 'failed-samples';

/**
 * Registers all feedback-related IPC handlers.
 */
function registerFeedbackHandlers() {
    /**
     * Handles the 'upload-failed-samples' IPC call from the renderer.
     * Zips and uploads images from the FAILED_SAMPLES_DIR_NAME directory to a remote server for analysis.
     */
    ipcMain.on('upload-failed-samples', async (event) => {
        const sendUploadStatus = (message, error = false, inProgress = true) => {
            const mainWindow = windowManager.getMainWindow();
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                sendStatusUpdate(mainWindow.webContents, 'upload-failed-samples-status', { message, error, inProgress });
            }
        };

        const userDataPath = app.getPath('userData');
        const failedSamplesDir = path.join(userDataPath, FAILED_SAMPLES_DIR_NAME);

        sendUploadStatus('Starting failed samples upload process...', false, true);
        console.log('[FeedbackHandlers] Received request to upload failed samples.');

        try {
            await fsPromises.access(failedSamplesDir);
            const imageFiles = (await fsPromises.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png')); // NOSONAR - toLowerCase is fine for simple extension check

            if (imageFiles.length === 0) {
                sendUploadStatus('No image files found in failed-samples directory to upload.', false, false);
                return;
            }

            sendUploadStatus(`Found ${imageFiles.length} samples. Zipping...`, false, true);

            const archive = archiver('zip', { zlib: { level: 9 } });
            const buffers = [];

            const archivePromise = new Promise((resolve, reject) => {
                archive.on('data', (buffer) => buffers.push(buffer));
                archive.on('end', () => resolve(Buffer.concat(buffers)));
                archive.on('error', (err) => reject(err));
            });

            for (const fileName of imageFiles) {
                const filePath = path.join(failedSamplesDir, fileName);
                archive.file(filePath, { name: fileName });
            }
            archive.finalize();

            const zipBuffer = await archivePromise;
            sendUploadStatus('Zip complete. Preparing to upload...', false, true);

            const timestamp = new Date().toISOString();
            const nonce = crypto.randomBytes(16).toString('hex');
            const httpMethod = 'POST';
            const requestPath = '/failed-samples-upload';

            const signature = generateHmacSignature(
                CLIENT_SHARED_SECRET,
                httpMethod,
                requestPath,
                timestamp,
                nonce,
                CLIENT_API_KEY
            );

            const headers = {
                'Content-Type': 'application/zip',
                'x-api-key': CLIENT_API_KEY,
                'x-request-timestamp': timestamp,
                'x-nonce': nonce,
                'x-signature': signature,
            };

            const response = await axios.post(`${API_ENDPOINT_URL}/failed-samples-upload`, zipBuffer, {
                headers: headers,
                responseType: 'json',
            });

            if (response.status === 200 && response.data.message) {
                sendUploadStatus(response.data.message, false, false);
            } else {
                throw new Error(response.data.error || `API returned status ${response.status}`);
            }

        } catch (error) {
            let errorMessage = 'Failed to upload failed samples.';
            if (error.code === 'ENOENT' && error.path === failedSamplesDir) {
                errorMessage = 'Failed samples directory not found. No samples to upload.';
            } else if (error.response && error.response.data && (error.response.data.error || error.response.data.message)) {
                errorMessage = `API Error: ${error.response.data.error || error.response.data.message}`;
            } else if (error.message) {
                errorMessage = error.message;
            }
            console.error('[FeedbackHandlers] Error uploading failed samples:', error);
            sendUploadStatus(errorMessage, true, false);
        }
    });

    /**
     * Handles the 'take-snapshot' IPC call, typically from the overlay.
     * Captures the current screen, extracts images of ability slots based on the last scan results
     * and layout configuration, and saves them to the FAILED_SAMPLES_DIR_NAME directory.
     */
    ipcMain.on('take-snapshot', async () => {
        const overlayWin = windowManager.getOverlayWindow();
        const sendSnapshotStatus = (message, error = false, allowRetry = true) => {
            if (overlayWin?.webContents && !overlayWin.webContents.isDestroyed()) {
                sendStatusUpdate(overlayWin.webContents, 'snapshot-taken-status', { message, error, allowRetry });
            } else {
                console.warn('[FeedbackHandlersSnapshot] Overlay window not available to send status.');
            }
        };

        if (!stateManager.getLastRawScanResults() || !stateManager.getLastScanTargetResolution()) {
            sendSnapshotStatus('Error: No scan data available for snapshot.', true, true);
            return;
        }

        const userDataPath = app.getPath('userData');
        const failedSamplesDir = path.join(userDataPath, FAILED_SAMPLES_DIR_NAME);

        try {
            if (overlayWin?.webContents && !overlayWin.webContents.isDestroyed()) {
                overlayWin.webContents.send('toggle-hotspot-borders', false);
                // Allow UI to update (e.g., hide borders) before taking screenshot
                await delay(150);
            }

            await fsPromises.mkdir(failedSamplesDir, { recursive: true });
            const fullScreenshotBuffer = await screenshotDesktop({ format: 'png' });
            const layoutConfig = JSON.parse(await fsPromises.readFile(stateManager.getLayoutCoordinatesPath(), 'utf-8'));
            const targetResolution = stateManager.getLastScanTargetResolution();
            const coordsConfig = layoutConfig.resolutions?.[targetResolution];

            if (!coordsConfig) {
                throw new Error(`Snapshot coordinates not found for resolution: ${targetResolution}.`);
            }

            const allSlotsForSnapshot = [];
            /**
             * Helper to add slot coordinates and predicted names to the snapshot list.
             * @param {string} slotType - Type of slot (e.g., 'ult', 'std', 'sel').
             * @param {Array<object>} coordsArray - Array of coordinate objects for this slot type.
             * @param {Array<object>} resultsArray - Array of OCR result objects for this slot type.
             */
            const addSlots = (slotType, coordsArray, resultsArray) => {
                if (coordsArray && resultsArray) {
                    coordsArray.forEach((coord, i) => {
                        // Only process if a result exists for this slot index
                        if (resultsArray[i]) {
                            const resultName = resultsArray[i].name;
                            allSlotsForSnapshot.push({
                                ...coord, // Includes x, y, width, height, hero_order, ability_order from layout
                                predictedName: resultName || `unknown_${slotType}_ho${coord.hero_order || 'X'}_idx${i}`,
                                type: slotType
                            });
                        }
                    });
                }
            };

            const currentLastRawScanResults = stateManager.getLastRawScanResults();
            addSlots('ult', coordsConfig.ultimate_slots_coords, currentLastRawScanResults.ultimates);
            addSlots('std', coordsConfig.standard_slots_coords, currentLastRawScanResults.standard);

            // Handle selected abilities with potentially complex mapping to coordinates
            if (coordsConfig.selected_abilities_params && currentLastRawScanResults.selectedAbilities) {
                // Pre-group selected ability coordinates by hero_order for efficient lookup
                const groupedSelectedCoords = (coordsConfig.selected_abilities_coords || []).reduce((acc, coord) => {
                    const heroOrderKey = String(coord.hero_order);
                    if (!acc[heroOrderKey]) acc[heroOrderKey] = [];
                    // Assuming coords are already sorted by their intended slot order for a hero.
                    acc[heroOrderKey].push(coord);
                    return acc;
                }, {});

                const heroAbilitySlotIndices = {}; // Tracks the next available slot index for each hero

                currentLastRawScanResults.selectedAbilities.forEach((abilityResult) => {
                    const heroOrderKey = String(abilityResult.hero_order);
                    const currentSlotIndex = heroAbilitySlotIndices[heroOrderKey] || 0;
                    const coordsForThisHero = groupedSelectedCoords[heroOrderKey] || [];

                    if (currentSlotIndex < coordsForThisHero.length) {
                        const specificCoord = coordsForThisHero[currentSlotIndex]; // This is the layout coord for the Nth ability of this hero
                        allSlotsForSnapshot.push({
                            x: specificCoord.x,
                            y: specificCoord.y,
                            hero_order: specificCoord.hero_order, // From layout coordinate
                            ability_order: currentSlotIndex,     // Nth detected ability for this hero
                            width: coordsConfig.selected_abilities_params.width,  // Common width from params
                            height: coordsConfig.selected_abilities_params.height, // Common height from params
                            predictedName: abilityResult.name || `unknown_sel_ho${specificCoord.hero_order}_idx${currentSlotIndex}`,
                            type: 'sel'
                        });
                        heroAbilitySlotIndices[heroOrderKey] = currentSlotIndex + 1;
                    } else {
                        console.warn(`[FeedbackHandlersSnapshot] More selected abilities for hero ${heroOrderKey} than layout slots defined. OCR result: ${abilityResult.name}`);
                    }
                });
            }
            let savedCount = 0;
            for (const slot of allSlotsForSnapshot) {
                if (typeof slot.x !== 'number' || typeof slot.y !== 'number' || typeof slot.width !== 'number' || typeof slot.height !== 'number' || slot.width <= 0 || slot.height <= 0) {
                    console.warn(`[FeedbackHandlersSnapshot] Skipping slot with invalid dims:`, slot); continue;
                }
                try {
                    const randomString = crypto.randomBytes(3).toString('hex');
                    const safePredictedName = (slot.predictedName || `unknown_${slot.type}_ho${slot.hero_order || 'X'}_ao${slot.ability_order || 'N'}`).replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
                    const filename = `${safePredictedName}-${randomString}.png`;
                    await sharp(fullScreenshotBuffer)
                        .extract({ left: Math.round(slot.x), top: Math.round(slot.y), width: Math.round(slot.width), height: Math.round(slot.height) })
                        .toFile(path.join(failedSamplesDir, filename));
                    savedCount++;
                } catch (cropError) {
                    console.error(`[FeedbackHandlersSnapshot] Snapshot crop error for ${slot.predictedName}: ${cropError.message}`);
                }
            }
            sendSnapshotStatus(`Snapshot: ${savedCount} images saved to app data.`, false, true);
        } catch (error) {
            console.error('[FeedbackHandlersSnapshot] Error taking snapshot:', error);
            sendSnapshotStatus(`Snapshot Error: ${error.message}`, true, true);
        } finally {
            if (overlayWin?.webContents && !overlayWin.webContents.isDestroyed()) {
                overlayWin.webContents.send('toggle-hotspot-borders', true);
            }
        }
    });

    /**
     * Handles the 'export-failed-samples' IPC call from the renderer.
     * Zips images from the FAILED_SAMPLES_DIR_NAME directory and prompts the user to save the zip file locally.
     * @param {Electron.IpcMainEvent} event - The IPC event.
     */
    ipcMain.on('export-failed-samples', async (event) => {
        const sendExportStatus = (message, error = false, inProgress = true, filePath = null, count = 0) => {
            sendStatusUpdate(event.sender, 'export-failed-samples-status', { message, error, inProgress, filePath, count });
        };

        const userDataPath = app.getPath('userData');
        const failedSamplesDir = path.join(userDataPath, FAILED_SAMPLES_DIR_NAME);

        try {
            await fsPromises.access(failedSamplesDir);
            const imageFiles = (await fsPromises.readdir(failedSamplesDir)).filter(f => f.toLowerCase().endsWith('.png')); // NOSONAR

            if (imageFiles.length === 0) {
                sendExportStatus('No image files found in the failed samples directory to export.', false, false);
                return;
            }

            const currentMainWindow = windowManager.getMainWindow();
            const { filePath, canceled } = await dialog.showSaveDialog(currentMainWindow, {
                title: 'Save Failed Samples Zip',
                defaultPath: path.join(app.getPath('downloads'), `adplus-failed-samples-${new Date().toISOString().split('T')[0]}.zip`),
                filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
            });

            if (canceled || !filePath) {
                sendExportStatus('Export canceled by user.', false, false);
                return;
            }

            sendExportStatus(`Zipping ${imageFiles.length} samples...`, false, true);
            const output = fs.createWriteStream(filePath); // Use non-promise fs for stream compatibility with archiver
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.on('warning', (warn) => console.warn("[FeedbackHandlersExport] Archiver warning:", warn));
                archive.pipe(output);
                for (const fileName of imageFiles) {
                    archive.file(path.join(failedSamplesDir, fileName), { name: fileName });
                }
                archive.finalize();
            });

            sendExportStatus(`Exported ${imageFiles.length} samples to ${filePath}`, false, false, filePath, imageFiles.length);

        } catch (error) {
            if (error.code === 'ENOENT' && error.path === failedSamplesDir) {
                sendExportStatus('No failed samples directory found. Take some snapshots first.', false, false);
            } else {
                console.error('[FeedbackHandlersExport] Error exporting failed samples:', error);
                sendExportStatus(`Export Error: ${error.message}`, true, false);
            }
        }
    });

    /**
     * Handles the 'request-new-layout-screenshot' IPC call from the renderer.
     * Hides the main window (if visible), takes a full desktop screenshot,
     * and sends it back to the renderer as a data URL for preview.
     * @param {Electron.IpcMainEvent} event - The IPC event.
     */
    ipcMain.on('request-new-layout-screenshot', async (event) => {
        let wasMainWindowVisible = false;
        try {
            if (windowManager.isMainWindowVisible()) {
                wasMainWindowVisible = true;
                windowManager.hideMainWindow();
                // Allow main window to fully hide before taking screenshot
                await delay(500);
            }
            const screenshotBuffer = await screenshotDesktop({ format: 'png' });
            const dataUrl = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('new-layout-screenshot-taken', dataUrl);
            }
        } catch (error) {
            console.error('[FeedbackHandlers] Error taking new layout screenshot:', error);
            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('new-layout-screenshot-taken', null);
            }
        } finally {
            if (wasMainWindowVisible && windowManager.getMainWindow() && !windowManager.getMainWindow().isDestroyed()) {
                windowManager.showMainWindow();
            }
        }
    });

    /**
     * Handles the 'submit-confirmed-layout' IPC call from the renderer.
     * Receives a screenshot (as a data URL) and metadata (resolution, scale factor),
     * and submits it to a remote server for new layout/resolution requests.
     * @param {Electron.IpcMainEvent} event - The IPC event.
     * @param {string} dataUrl - The screenshot image as a base64 data URL.
     */
    ipcMain.on('submit-confirmed-layout', async (event, dataUrl) => {
        const sendSubmissionStatus = (message, error = false, inProgress = true) => {
            const mainWindow = windowManager.getMainWindow();
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                sendStatusUpdate(mainWindow.webContents, 'submit-new-resolution-status', { message, error, inProgress });
            }
        };

        try {
            if (!dataUrl) throw new Error("Screenshot data URL is missing for submission.");

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;
            const scaleFactor = primaryDisplay.scaleFactor;
            const resolutionString = `${width}x${height}`;
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
            const screenshotBuffer = Buffer.from(base64Data, 'base64');
            const timestamp = new Date().toISOString();
            const nonce = crypto.randomBytes(16).toString('hex');
            const httpMethod = 'POST';
            const requestPath = '/resolution-request';
            const signature = generateHmacSignature(CLIENT_SHARED_SECRET, httpMethod, requestPath, timestamp, nonce, CLIENT_API_KEY);
            const headers = {
                'Content-Type': 'image/png', 'x-resolution-string': resolutionString, 'x-scale-factor': scaleFactor.toString(),
                'x-api-key': CLIENT_API_KEY, 'x-request-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': signature
            };

            sendSubmissionStatus('Submitting screenshot to API...', false, true);
            const response = await axios.post(`${API_ENDPOINT_URL}${requestPath}`, screenshotBuffer, { headers, responseType: 'json' });

            if (response.status === 200 && response.data.message) {
                sendSubmissionStatus(response.data.message, false, false);
            } else {
                throw new Error(response.data.error || `API returned status ${response.status}`);
            }
        } catch (error) {
            console.error('[FeedbackHandlers] Error submitting new resolution snapshot:', error);
            let errorMessage = 'Failed to submit snapshot.';
            if (error.response && error.response.data && (error.response.data.error || error.response.data.message)) {
                errorMessage = `API Error: ${error.response.data.error || error.response.data.message}`;
            } else if (error.message) {
                errorMessage = error.message;
            }
            sendSubmissionStatus(errorMessage, true, false);
        }
    });
}

module.exports = { registerFeedbackHandlers };