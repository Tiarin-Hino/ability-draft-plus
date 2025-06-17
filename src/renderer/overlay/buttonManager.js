/**
 * @module buttonManager
 * @description Manages the creation, update, and removal of dynamic buttons
 * (e.g., "Select My Spot", "Select My Model") on the overlay.
 * These buttons allow user interaction with specific game elements.
 */

let currentScaleFactor = 1;
let getSelectedHeroOriginalOrderFn = () => null;
let getSelectedModelScreenOrderFn = () => null;
let translateFn = (key) => key;
let electronAPIInstance = null;

const MY_SPOT_BUTTON_MARGIN = 5; // px
const MY_MODEL_BUTTON_MARGIN = 3; // px

/**
 * Initializes the button manager with necessary configurations and callbacks.
 * @param {object} config - Configuration object.
 * @param {function(): number} [config.getScaleFactor] - Function to get the current UI scale factor. Defaults to 1.
 * @param {function(): number | null} config.getSelectedHeroOriginalOrder - Function to get the original order of the selected hero spot.
 * @param {function(): number | null} config.getSelectedModelScreenOrder - Function to get the screen order of the selected hero model.
 * @param {function(string): string} config.translateFn - Function for translating UI strings.
 * @param {object} config.electronAPI - Instance of the Electron API for IPC communication.
 * @param {function(boolean, object=): void} [config.electronAPI.setOverlayMouseEvents] - Function to toggle mouse event passthrough for the overlay.
 * @param {function(object): void} [config.electronAPI.selectMySpotForDrafting] - Function to call when a "my spot" button is clicked.
 * @param {function(object): void} [config.electronAPI.selectMyModel] - Function to call when a "my model" button is clicked.
 */
export function initButtonManager(config) {
    currentScaleFactor = config.getScaleFactor ? config.getScaleFactor() : 1;
    getSelectedHeroOriginalOrderFn = config.getSelectedHeroOriginalOrder;
    getSelectedModelScreenOrderFn = config.getSelectedModelScreenOrder;
    translateFn = config.translateFn;
    electronAPIInstance = config.electronAPI;
}

/**
 * Creates a generic button element with specified properties and appends it to the document body.
 * @private
 * @param {object} params - Parameters for creating the button.
 * @param {number | string} params.dataHeroOrder - The hero order associated with this button.
 * @param {number | string | null} params.dataDbHeroId - The database hero ID, if applicable.
 * @param {string} params.baseClassName - CSS class for the button in its default state.
 * @param {string} params.changeClassName - CSS class for the button when it represents a "change choice" state.
 * @param {string} params.baseKey - Translation key for the button's default text.
 * @param {boolean} params.isSelected - Whether this button corresponds to the currently selected item.
 * @param {boolean} params.anySelected - Whether any button of this type is currently selected.
 * @param {object} params.positionStyle - CSS style object for positioning the button.
 * @param {function} params.onClickCallback - Callback function to execute when the button is clicked.
 * @returns {HTMLButtonElement} The created button element.
 */
function createButtonElement({
    dataHeroOrder, dataDbHeroId, baseClassName, changeClassName, baseKey,
    isSelected, anySelected, positionStyle, onClickCallback
}) {
    const button = document.createElement('button');

    if (isSelected) {
        button.classList.add(changeClassName);
        button.textContent = translateFn('overlay.dynamicButtons.changeChoice');
    } else {
        button.classList.add(baseClassName);
        button.textContent = translateFn(baseKey);
    }
    button.classList.add('overlay-button'); // Common class for all overlay buttons

    button.dataset.heroOrder = dataHeroOrder;
    if (dataDbHeroId !== null) button.dataset.dbHeroId = dataDbHeroId;

    button.style.position = 'absolute';
    Object.assign(button.style, positionStyle);

    button.style.display = (isSelected || !anySelected) ? 'inline-flex' : 'none';

    button.addEventListener('click', onClickCallback);
    button.addEventListener('mouseenter', () => electronAPIInstance?.setOverlayMouseEvents(false));
    button.addEventListener('mouseleave', () => electronAPIInstance?.setOverlayMouseEvents(true));

    document.body.appendChild(button);
    return button;
}

/**
 * Updates or creates "Select My Spot" buttons based on hero data and screen coordinates.
 * Removes existing "My Spot" buttons before creating new ones.
 * @param {Array<object>} heroesForMySpotUIData - Array of hero data for UI display,
 *        each object containing `heroOrder` and `dbHeroId`.
 * @param {object} currentCoordinatesConfig - The full coordinates configuration object.
 * @param {string} currentTargetResolution - The key for the current target display resolution (e.g., "1920x1080").
 */
export function updateMySpotButtons(heroesForMySpotUIData, currentCoordinatesConfig, currentTargetResolution) {
    document.querySelectorAll('.my-spot-btn-original, .change-my-spot-btn-original').forEach(btn => btn.remove());

    if (!currentCoordinatesConfig || !currentTargetResolution || !heroesForMySpotUIData || heroesForMySpotUIData.length === 0) {
        return;
    }
    const resolutionCoords = currentCoordinatesConfig.resolutions[currentTargetResolution];
    if (!resolutionCoords || !resolutionCoords.heroes_coords || !resolutionCoords.heroes_params) {
        return;
    }

    heroesForMySpotUIData.forEach(heroDataForUI => {
        const heroCoordInfo = resolutionCoords.heroes_coords.find(hc => hc.hero_order === heroDataForUI.heroOrder);
        if (heroCoordInfo && heroDataForUI.dbHeroId !== null) {
            const heroBoxX = heroCoordInfo.x / currentScaleFactor;
            const heroBoxY = heroCoordInfo.y / currentScaleFactor;
            const heroBoxWidth = resolutionCoords.heroes_params.width / currentScaleFactor;
            const isLeftSide = heroDataForUI.heroOrder <= 4;

            const positionStyle = {
                top: `${heroBoxY + (resolutionCoords.heroes_params.height / currentScaleFactor / 2)}px`,
                transform: `translateY(-50%)`,
                left: isLeftSide
                    ? `${heroBoxX - MY_SPOT_BUTTON_MARGIN}px`
                    : `${heroBoxX + heroBoxWidth + MY_SPOT_BUTTON_MARGIN}px`
            };
            if (isLeftSide) positionStyle.transform += ' translateX(-100%)';

            createButtonElement({
                dataHeroOrder: heroDataForUI.heroOrder, dataDbHeroId: heroDataForUI.dbHeroId,
                baseClassName: 'my-spot-btn-original', changeClassName: 'change-my-spot-btn-original',
                baseKey: 'overlay.dynamicButtons.mySpot',
                isSelected: getSelectedHeroOriginalOrderFn() === heroDataForUI.heroOrder,
                anySelected: getSelectedHeroOriginalOrderFn() !== null,
                positionStyle,
                onClickCallback: () => electronAPIInstance?.selectMySpotForDrafting({ heroOrder: heroDataForUI.heroOrder, dbHeroId: heroDataForUI.dbHeroId })
            });
        }
    });
}

/**
 * Updates or creates "Select My Model" buttons based on identified hero model data.
 * Removes existing "My Model" buttons before creating new ones.
 * Buttons are positioned relative to their corresponding hero model hotspot elements.
 * @param {Array<object>} heroModelData - Array of hero model data, each object containing `heroOrder`, `dbHeroId`, and `heroDisplayName`.
 */
export function updateHeroModelButtons(heroModelData) {
    document.querySelectorAll('.my-model-btn, .change-my-model-btn').forEach(btn => btn.remove());

    if (!heroModelData || heroModelData.length === 0) return;

    heroModelData.forEach(heroModel => {
        if (heroModel.dbHeroId === null && heroModel.heroDisplayName === "Unknown Hero") return;

        const modelHotspotElement = document.getElementById(`hero-model-hotspot-${heroModel.heroOrder}`);
        if (!modelHotspotElement) return;

        const rect = modelHotspotElement.getBoundingClientRect(); // Already scaled
        const isLeftSide = ((heroModel.heroOrder >= 0 && heroModel.heroOrder <= 4) || heroModel.heroOrder === 10);

        const positionStyle = {
            top: `${rect.top + (rect.height / 2)}px`,
            transform: `translateY(-50%)`,
            left: isLeftSide
                ? `${rect.left - MY_MODEL_BUTTON_MARGIN}px`
                : `${rect.right + MY_MODEL_BUTTON_MARGIN}px`
        };
        if (isLeftSide) positionStyle.transform += ' translateX(-100%)';

        createButtonElement({
            dataHeroOrder: heroModel.heroOrder, dataDbHeroId: heroModel.dbHeroId,
            baseClassName: 'my-model-btn', changeClassName: 'change-my-model-btn',
            baseKey: 'overlay.dynamicButtons.myModel',
            isSelected: getSelectedModelScreenOrderFn() === heroModel.heroOrder,
            anySelected: getSelectedModelScreenOrderFn() !== null,
            positionStyle,
            onClickCallback: () => electronAPIInstance?.selectMyModel({ heroOrder: heroModel.heroOrder, dbHeroId: heroModel.dbHeroId })
        });
    });
}

/**
 * Removes all dynamically created "My Spot" and "My Model" buttons from the DOM.
 */
export function clearDynamicButtons() {
    document.querySelectorAll('.my-spot-btn-original, .change-my-spot-btn-original, .my-model-btn, .change-my-model-btn').forEach(btn => btn.remove());
}