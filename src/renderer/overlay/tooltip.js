/**
 * @module tooltip
 * @description Manages a single tooltip element for displaying information on hover.
 */

/**
 * The DOM element used as the tooltip.
 * @type {HTMLElement | null}
 */
let tooltipDOMElement = null;

/**
 * Flag indicating whether the tooltip is currently visible.
 * @type {boolean}
 */
let visible = false;

/**
 * Initializes the tooltip module with the main tooltip DOM element.
 * @param {HTMLElement} element - The DOM element to use as the tooltip.
 */
export function initTooltip(element) {
    tooltipDOMElement = element;
}

/**
 * Shows the tooltip with the given content, positioned relative to the hotspot element.
 * Also hides borders on highlighted elements while the tooltip is visible.
 * @param {HTMLElement} hotspotElement - The element that triggered the tooltip (used for positioning).
 * @param {string} content - The HTML content to display inside the tooltip.
 */
export function showTooltip(hotspotElement, content) {
    if (tooltipDOMElement) {
        tooltipDOMElement.innerHTML = content;
        tooltipDOMElement.style.display = 'block';
        tooltipDOMElement.setAttribute('aria-hidden', 'false');
        visible = true;

        // Hide borders of highlighted items when tooltip is active
        document.querySelectorAll('.top-tier-ability, .top-tier-hero-model, .synergy-suggestion-hotspot, .is-my-model').forEach(el => {
            el.classList.add('snapshot-hidden-border');
        });
        positionTooltip(hotspotElement);
    }
}

/**
 * Positions the tooltip element relative to a given hotspot element,
 * attempting to keep it within the viewport.
 * @private
 * @param {HTMLElement} hotspotElement - The element to position the tooltip relative to.
 */
function positionTooltip(hotspotElement) {
    if (!tooltipDOMElement || !hotspotElement) return;

    const hotspotRect = hotspotElement.getBoundingClientRect();
    const tooltipWidth = tooltipDOMElement.offsetWidth;
    const tooltipHeight = tooltipDOMElement.offsetHeight;

    // Fallback positioning if dimensions are not yet available
    if (isNaN(tooltipWidth) || isNaN(tooltipHeight) || tooltipWidth === 0 || tooltipHeight === 0) {
        tooltipDOMElement.style.left = `${hotspotRect.left}px`;
        tooltipDOMElement.style.top = `${hotspotRect.bottom + 5}px`;
        return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 10; // Minimum margin from viewport edges

    let calculatedX = hotspotRect.left - tooltipWidth - margin; // Prefer positioning to the left
    let calculatedY = hotspotRect.top;

    // Adjust X position if it goes out of bounds
    if (calculatedX < margin) {
        calculatedX = hotspotRect.right + margin; // Try positioning to the right
        // If still out of bounds, clamp to the right edge
        if (calculatedX + tooltipWidth > viewportWidth - margin) {
            calculatedX = viewportWidth - tooltipWidth - margin;
        }
    }
    // Ensure it's not too far left after adjustments
    if (calculatedX < margin) calculatedX = margin;


    // Adjust Y position if it goes out of bounds
    if (calculatedY + tooltipHeight > viewportHeight - margin) {
        calculatedY = viewportHeight - tooltipHeight - margin; // Clamp to the bottom edge
    }
    // Ensure it's not too far up
    if (calculatedY < margin) calculatedY = margin;

    // Apply calculated position
    tooltipDOMElement.style.left = `${calculatedX}px`;
    tooltipDOMElement.style.top = `${calculatedY}px`;
    // Reset other positioning properties that might interfere
    tooltipDOMElement.style.right = 'auto';
    tooltipDOMElement.style.bottom = 'auto';
    tooltipDOMElement.style.transform = 'none';
}

/**
 * Hides the tooltip.
 * Also restores borders on highlighted elements.
 */
export function hideTooltip() {
    if (tooltipDOMElement) {
        tooltipDOMElement.style.display = 'none';
        tooltipDOMElement.setAttribute('aria-hidden', 'true');
    }
    visible = false;
    // Restore borders of highlighted items when tooltip is hidden
    document.querySelectorAll('.top-tier-ability, .top-tier-hero-model, .synergy-suggestion-hotspot, .is-my-model').forEach(el => {
        el.classList.remove('snapshot-hidden-border');
    });
}

/**
 * Checks if the tooltip is currently visible.
 * @returns {boolean} True if the tooltip is visible, false otherwise.
 */
export function isTooltipVisible() {
    return visible;
}