/**
 * @file Input validation utilities for IPC handlers
 * Provides validation functions to ensure IPC method parameters are valid before processing.
 * Helps prevent errors and potential security issues from malformed inputs.
 */

/**
 * Validation error class for IPC parameter validation
 */
class ValidationError extends Error {
    constructor(message, field) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
    }
}

/**
 * Validates that a value is a non-empty string
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 */
function validateString(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError(`${fieldName} must be a non-empty string`, fieldName);
    }
}

/**
 * Validates that a value is a number within optional min/max bounds
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @param {object} options - Optional constraints
 * @param {number} options.min - Minimum allowed value (inclusive)
 * @param {number} options.max - Maximum allowed value (inclusive)
 * @param {boolean} options.integer - Whether the number must be an integer
 * @throws {ValidationError} If validation fails
 */
function validateNumber(value, fieldName, options = {}) {
    if (typeof value !== 'number' || !isFinite(value)) {
        throw new ValidationError(`${fieldName} must be a valid number`, fieldName);
    }

    if (options.integer && !Number.isInteger(value)) {
        throw new ValidationError(`${fieldName} must be an integer`, fieldName);
    }

    if (options.min !== undefined && value < options.min) {
        throw new ValidationError(
            `${fieldName} must be at least ${options.min}`,
            fieldName
        );
    }

    if (options.max !== undefined && value > options.max) {
        throw new ValidationError(
            `${fieldName} must be at most ${options.max}`,
            fieldName
        );
    }
}

/**
 * Validates that a value is a boolean
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 */
function validateBoolean(value, fieldName) {
    if (typeof value !== 'boolean') {
        throw new ValidationError(`${fieldName} must be a boolean`, fieldName);
    }
}

/**
 * Validates that a value is an object (not null, not array)
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 */
function validateObject(value, fieldName) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError(`${fieldName} must be an object`, fieldName);
    }
}

/**
 * Validates that a value is an array
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @param {object} options - Optional constraints
 * @param {number} options.minLength - Minimum array length
 * @param {number} options.maxLength - Maximum array length
 * @throws {ValidationError} If validation fails
 */
function validateArray(value, fieldName, options = {}) {
    if (!Array.isArray(value)) {
        throw new ValidationError(`${fieldName} must be an array`, fieldName);
    }

    if (options.minLength !== undefined && value.length < options.minLength) {
        throw new ValidationError(
            `${fieldName} must have at least ${options.minLength} elements`,
            fieldName
        );
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
        throw new ValidationError(
            `${fieldName} must have at most ${options.maxLength} elements`,
            fieldName
        );
    }
}

/**
 * Validates a resolution string format (e.g., '1920x1080')
 * @param {*} value - The resolution string to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 * @returns {object} Parsed resolution with width and height numbers
 */
function validateResolution(value, fieldName = 'resolution') {
    validateString(value, fieldName);

    const resolutionPattern = /^(\d{3,5})x(\d{3,5})$/;
    const match = value.match(resolutionPattern);

    if (!match) {
        throw new ValidationError(
            `${fieldName} must be in format 'WIDTHxHEIGHT' (e.g., '1920x1080')`,
            fieldName
        );
    }

    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);

    // Sanity check: reasonable resolution bounds
    if (width < 640 || width > 7680 || height < 480 || height > 4320) {
        throw new ValidationError(
            `${fieldName} dimensions out of reasonable bounds (640x480 to 7680x4320)`,
            fieldName
        );
    }

    return { width, height };
}

/**
 * Validates a URL string (http or https only)
 * @param {*} value - The URL string to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 */
function validateUrl(value, fieldName = 'url') {
    validateString(value, fieldName);

    if (!value.startsWith('http:') && !value.startsWith('https:')) {
        throw new ValidationError(
            `${fieldName} must be a valid HTTP or HTTPS URL`,
            fieldName
        );
    }

    // Basic URL validation
    try {
        new URL(value);
    } catch (error) {
        throw new ValidationError(`${fieldName} is not a valid URL`, fieldName);
    }
}

/**
 * Validates a language code (2-letter ISO 639-1 format)
 * @param {*} value - The language code to validate
 * @param {string} fieldName - The name of the field being validated
 * @param {string[]} allowedCodes - Optional array of allowed language codes
 * @throws {ValidationError} If validation fails
 */
function validateLanguageCode(value, fieldName = 'languageCode', allowedCodes = null) {
    validateString(value, fieldName);

    // Must be 2-letter lowercase code
    if (!/^[a-z]{2}$/.test(value)) {
        throw new ValidationError(
            `${fieldName} must be a 2-letter ISO 639-1 language code (e.g., 'en', 'ru')`,
            fieldName
        );
    }

    // Check against allowed codes if provided
    if (allowedCodes && !allowedCodes.includes(value)) {
        throw new ValidationError(
            `${fieldName} must be one of: ${allowedCodes.join(', ')}`,
            fieldName
        );
    }
}

/**
 * Validates a data URL (base64 encoded)
 * @param {*} value - The data URL to validate
 * @param {string} fieldName - The name of the field being validated
 * @throws {ValidationError} If validation fails
 */
function validateDataUrl(value, fieldName = 'dataUrl') {
    validateString(value, fieldName);

    if (!value.startsWith('data:')) {
        throw new ValidationError(`${fieldName} must be a valid data URL`, fieldName);
    }

    // Basic structure check: data:mime/type;base64,data
    const dataUrlPattern = /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-+.]+)?(;base64)?,(.+)$/;
    if (!dataUrlPattern.test(value)) {
        throw new ValidationError(
            `${fieldName} has invalid data URL format`,
            fieldName
        );
    }
}

/**
 * Validates an enum value (must be one of allowed values)
 * @param {*} value - The value to validate
 * @param {string} fieldName - The name of the field being validated
 * @param {Array} allowedValues - Array of allowed values
 * @throws {ValidationError} If validation fails
 */
function validateEnum(value, fieldName, allowedValues) {
    if (!allowedValues.includes(value)) {
        throw new ValidationError(
            `${fieldName} must be one of: ${allowedValues.join(', ')}`,
            fieldName
        );
    }
}

/**
 * Wrapper to create a validated IPC handler
 * Wraps the handler function with automatic parameter validation and error handling
 * @param {Function} validationFn - Function that validates parameters and throws ValidationError
 * @param {Function} handlerFn - The actual handler function to execute after validation
 * @returns {Function} Wrapped handler function
 *
 * @example
 * ipcMain.on('activate-overlay', createValidatedHandler(
 *   (event, resolution) => {
 *     validateResolution(resolution, 'resolution');
 *   },
 *   async (event, resolution) => {
 *     // Handler logic here
 *   }
 * ));
 */
function createValidatedHandler(validationFn, handlerFn) {
    return async (...args) => {
        try {
            // Run validation
            validationFn(...args);

            // If validation passes, run handler
            return await handlerFn(...args);
        } catch (error) {
            if (error instanceof ValidationError) {
                console.error(
                    `[IPC Validation Error] ${error.message} (field: ${error.field})`
                );

                // Send error back to renderer if event is available
                const event = args[0];
                if (event && event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('ipc-validation-error', {
                        field: error.field,
                        message: error.message
                    });
                }

                return {
                    success: false,
                    error: error.message,
                    field: error.field
                };
            }

            // Re-throw non-validation errors
            throw error;
        }
    };
}

module.exports = {
    ValidationError,
    validateString,
    validateNumber,
    validateBoolean,
    validateObject,
    validateArray,
    validateResolution,
    validateUrl,
    validateLanguageCode,
    validateDataUrl,
    validateEnum,
    createValidatedHandler
};
