/**
 * @module utils
 * @description Provides utility functions for common tasks such as creating delays,
 * generating HMAC signatures, and sending IPC messages to renderer processes.
 */

const crypto = require('crypto');

/**
 * Creates a promise that resolves after a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to delay.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates an HMAC SHA256 signature.
 * This is typically used for securing API requests by creating a message authentication code.
 * @param {string} sharedSecret - The secret key used for generating the HMAC.
 * @param {string} httpMethod - The HTTP method of the request (e.g., 'GET', 'POST').
 * @param {string} requestPath - The path of the request URL (e.g., '/api/v1/users').
 * @param {string} timestamp - A timestamp for the request, often in ISO 8601 format or Unix epoch.
 * @param {string} nonce - A unique, randomly generated string (number used once) to prevent replay attacks.
 * @param {string} apiKey - The API key associated with the client making the request.
 * @returns {string} The generated HMAC signature, encoded as a hexadecimal string.
 */
function generateHmacSignature(sharedSecret, httpMethod, requestPath, timestamp, nonce, apiKey) {
    const stringToSign = `${httpMethod}\n${requestPath}\n${timestamp}\n${nonce}\n${apiKey}`;
    return crypto.createHmac('sha256', sharedSecret)
        .update(stringToSign)
        .digest('hex');
}
/**
 * Sends an IPC message to a target Electron WebContents or BrowserWindow.
 *
 * This function intelligently handles two types of targets:
 * 1. If `target` is a `BrowserWindow` instance: It sends the message to `target.webContents`.
 *    It checks that both the `BrowserWindow` and its `webContents` are not destroyed and have the necessary methods.
 * 2. If `target` is a `WebContents` instance: It sends the message directly to `target`.
 *    It checks that the `WebContents` is not destroyed and has a `send` method.
 *
 * If the target is null, undefined, destroyed, or not a recognized IPC target,
 * the message will not be sent.
 *
 * @param {?(import('electron').WebContents | import('electron').BrowserWindow)} target -
 *        The target for the IPC message. Can be an Electron `WebContents` instance,
 *        an Electron `BrowserWindow` instance, or `null`/`undefined`.
 * @param {string} channel - The IPC channel name to send the message on.
 * @param {any} message - The payload of the message to send.
 */
function sendStatusUpdate(target, channel, message) {
    // Case 1: Target is likely a BrowserWindow.
    // Check if target itself is valid, has webContents, and its webContents is valid and sendable.
    if (target && typeof target.isDestroyed === 'function' && !target.isDestroyed() &&
        target.webContents && typeof target.webContents.isDestroyed === 'function' && !target.webContents.isDestroyed() &&
        typeof target.webContents.send === 'function') {
        target.webContents.send(channel, message);
    }
    // Case 2: Target is likely a WebContents instance directly.
    // Check if target is valid and sendable.
    else if (target && typeof target.isDestroyed === 'function' && !target.isDestroyed() &&
        typeof target.send === 'function') {
        target.send(channel, message);
    }
    // Note: No action if target is null, destroyed, or doesn't match expected structures.
}

module.exports = {
    delay,
    generateHmacSignature,
    sendStatusUpdate,
};
