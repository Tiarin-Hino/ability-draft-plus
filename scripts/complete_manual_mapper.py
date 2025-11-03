#!/usr/bin/env python3
"""
Complete Manual Mapper - Resolution Auto-Mapper for Unknown Resolutions

Collects 68 manual clicks from a screenshot and generates all coordinate data.
Use this for unknown resolutions after validating logic with test_mapper_validation.py

Usage:
    python complete_manual_mapper.py --screenshot screenshot.png --output new_resolution_coords.json
"""

import cv2
import numpy as np
import json
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Tuple
import logging
from mapper_utils import *

logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global for mouse clicks
clicked_points = []
current_image = None
window_name = "Manual Mapper - Click 68 Points"


def mouse_callback(event, x, y, flags, param):
    """Capture mouse clicks"""
    global clicked_points, current_image

    if event == cv2.EVENT_LBUTTONDOWN:
        # Block clicks beyond 68
        if len(clicked_points) >= 68:
            logger.warning("Already have 68 clicks! Press ENTER to continue or 'u' to undo last click")
            return

        clicked_points.append((x, y))
        logger.info(f"Click {len(clicked_points)}/68: ({x}, {y})")

        # Draw marker
        cv2.circle(current_image, (x, y), 3, (0, 255, 0), -1)
        cv2.putText(current_image, str(len(clicked_points)),
                   (x + 5, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
        cv2.imshow(window_name, current_image)


def collect_68_clicks(image_path: str) -> List[Tuple[int, int]]:
    """Collect 68 manual clicks from user with zoom and undo features"""
    global clicked_points, current_image, window_name

    clicked_points = []

    img = cv2.imread(image_path)
    if img is None:
        logger.error(f"Failed to load: {image_path}")
        sys.exit(1)

    original_height, original_width = img.shape[:2]

    # Display settings
    scale = 1.0
    zoom_factor = 1.0
    zoom_mode = False
    zoom_x, zoom_y = 0, 0

    # Auto-scale if too large
    if original_height > 1080 or original_width > 1920:
        scale = min(1920/original_width, 1080/original_height)
        display_img = cv2.resize(img.copy(), (int(original_width*scale), int(original_height*scale)))
    else:
        display_img = img.copy()

    current_image = display_img.copy()

    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window_name, mouse_callback)

    print("\n" + "="*70)
    print("CLICK 68 REFERENCE POINTS (LEFT SIDE ONLY)")
    print("="*70)
    print("\nULTIMATE SLOTS - Left 3 cols x 2 rows (12 clicks):")
    print("  For each of 6 slots: Bottom-left, Top-right")
    print("\nSTANDARD SLOTS - Left 3 cols x 6 rows (36 clicks):")
    print("  For each of 18 slots: Top-left, Bottom-right")
    print("\nMODEL SLOTS - 6 models (12 clicks):")
    print("  For heroes 0,1,2,3,4,10: Top-left, Bottom-right")
    print("\nHERO BOXES - Only first 2 (4 clicks):")
    print("  Hero 0: Top-left, Bottom-right")
    print("  Hero 1: Top-left, Bottom-right")
    print("\nSELECTED ABILITIES - Only hero 0, slots 1-2 (4 clicks):")
    print("  Slot 1: Top-left, Bottom-right")
    print("  Slot 2: Top-left, Bottom-right")
    print("\nControls:")
    print("  'u' - Undo last click")
    print("  'r' - Reset all clicks")
    print("  'z' - Toggle zoom mode (2x zoom)")
    print("  'l' - Toggle loupe mode (4x zoom around cursor)")
    print("  'q' - Quit")
    print("  ENTER - Done (when you have 68 clicks)")
    print("="*70 + "\n")

    cv2.imshow(window_name, current_image)

    loupe_mode = False
    loupe_size = 200  # Size of loupe window
    last_mouse_pos = (0, 0)

    def redraw_image():
        """Redraw image with all current click markers"""
        global current_image
        current_image = display_img.copy()
        for i, (px, py) in enumerate(clicked_points):
            cv2.circle(current_image, (px, py), 3, (0, 255, 0), -1)
            cv2.putText(current_image, str(i + 1),
                       (px + 5, py - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
        cv2.imshow(window_name, current_image)

    def mouse_move_callback(event, x, y, flags, param):
        """Track mouse position for loupe mode"""
        nonlocal last_mouse_pos
        last_mouse_pos = (x, y)

        if loupe_mode and event == cv2.EVENT_MOUSEMOVE:
            # Show zoomed area around cursor
            loupe_img = current_image.copy()

            # Calculate loupe region
            zoom_level = 4
            half_size = loupe_size // (2 * zoom_level)
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(current_image.shape[1], x + half_size)
            y2 = min(current_image.shape[0], y + half_size)

            if x2 > x1 and y2 > y1:
                roi = current_image[y1:y2, x1:x2]
                zoomed = cv2.resize(roi, (loupe_size, loupe_size), interpolation=cv2.INTER_NEAREST)

                # Draw loupe in top-right corner
                loupe_x = current_image.shape[1] - loupe_size - 10
                loupe_y = 50

                # Draw border
                cv2.rectangle(loupe_img, (loupe_x-2, loupe_y-2),
                            (loupe_x+loupe_size+2, loupe_y+loupe_size+2),
                            (255, 255, 255), 2)

                # Overlay zoomed region
                loupe_img[loupe_y:loupe_y+loupe_size, loupe_x:loupe_x+loupe_size] = zoomed

                # Draw crosshair in center
                center_x = loupe_x + loupe_size // 2
                center_y = loupe_y + loupe_size // 2
                cv2.line(loupe_img, (center_x-10, center_y), (center_x+10, center_y), (0, 255, 255), 1)
                cv2.line(loupe_img, (center_x, center_y-10), (center_x, center_y+10), (0, 255, 255), 1)

                cv2.imshow(window_name, loupe_img)

    # Override mouse callback to include move tracking
    cv2.setMouseCallback(window_name, lambda event, x, y, flags, param: (
        mouse_callback(event, x, y, flags, param),
        mouse_move_callback(event, x, y, flags, param)
    ))

    while True:
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q'):
            cv2.destroyAllWindows()
            sys.exit(0)

        elif key == ord('u'):
            # Undo last click
            if len(clicked_points) > 0:
                removed = clicked_points.pop()
                logger.info(f"Undone click {len(clicked_points)+1}: {removed}")
                redraw_image()
            else:
                logger.warning("No clicks to undo")

        elif key == ord('r'):
            # Reset all clicks
            clicked_points = []
            redraw_image()
            logger.info("Reset all clicks")

        elif key == ord('z'):
            # Toggle zoom mode (2x)
            zoom_mode = not zoom_mode
            if zoom_mode:
                # Zoom to 2x
                zoomed = cv2.resize(display_img, None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)
                current_image = zoomed.copy()
                # Redraw markers at new scale
                for i, (px, py) in enumerate(clicked_points):
                    cv2.circle(current_image, (px*2, py*2), 3, (0, 255, 0), -1)
                    cv2.putText(current_image, str(i + 1),
                               (px*2 + 5, py*2 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
                logger.info("Zoom mode ON (2x) - Click is disabled in zoom mode, press 'z' to exit")
            else:
                current_image = display_img.copy()
                redraw_image()
                logger.info("Zoom mode OFF")
            cv2.imshow(window_name, current_image)

        elif key == ord('l'):
            # Toggle loupe mode
            loupe_mode = not loupe_mode
            if loupe_mode:
                logger.info("Loupe mode ON (4x zoom follows cursor)")
            else:
                redraw_image()
                logger.info("Loupe mode OFF")

        elif key == 13:  # ENTER
            if len(clicked_points) == 68:
                logger.info("Got all 68 clicks!")
                break
            else:
                logger.warning(f"Need 68 clicks, have {len(clicked_points)}")

    cv2.destroyAllWindows()

    # Scale back to original coordinates
    if scale != 1.0:
        clicked_points = [(int(x/scale), int(y/scale)) for x, y in clicked_points]

    return clicked_points


def calculate_coordinates_from_clicks(points: List[Tuple[int, int]], screen_width: int) -> Dict:
    """
    Calculate all coordinates from 68 manual clicks

    Click order:
    1-12: Ultimates (6 slots × 2 corners each) - Bottom-left + Top-right
    13-48: Standards (18 slots × 2 corners each) - Top-left + Bottom-right
    49-60: Models (6 slots × 2 corners each) - Top-left + Bottom-right
    61-64: Heroes 0-1 (2 slots × 2 corners each) - Top-left + Bottom-right
    65-68: Selected abilities (2 slots × 2 corners each) - Top-left + Bottom-right
    """
    logger.info("\nCalculating coordinates from clicks...")

    coords = {}
    idx = 0

    # Parse ultimates (clicks 1-12)
    left_ultimates = []
    for i in range(6):
        bl = points[idx]
        tr = points[idx + 1]
        dims = calculate_from_bottom_left_top_right(bl, tr)
        left_ultimates.append(Coord(**dims))
        idx += 2

    logger.info(f"  Parsed 6 left ultimate slots")

    # Parse standards (clicks 13-48)
    left_standards = []
    for i in range(18):
        tl = points[idx]
        br = points[idx + 1]
        dims = calculate_from_top_left_bottom_right(tl, br)
        left_standards.append(Coord(**dims))
        idx += 2

    logger.info(f"  Parsed 18 left standard slots")

    # Parse models (clicks 49-60)
    left_models = []
    for i in range(6):
        tl = points[idx]
        br = points[idx + 1]
        dims = calculate_from_top_left_bottom_right(tl, br)
        left_models.append(Coord(**dims))
        idx += 2

    logger.info(f"  Parsed 6 left model slots")

    # Parse heroes (clicks 61-64)
    hero0_tl = points[idx]
    hero0_br = points[idx + 1]
    hero0_dims = calculate_from_top_left_bottom_right(hero0_tl, hero0_br)

    hero1_tl = points[idx + 2]
    hero1_br = points[idx + 3]
    hero1_dims = calculate_from_top_left_bottom_right(hero1_tl, hero1_br)

    idx += 4
    logger.info(f"  Parsed heroes 0-1")

    # Parse selected abilities (clicks 65-68)
    ability1_tl = points[idx]
    ability1_br = points[idx + 1]
    ability1_dims = calculate_from_top_left_bottom_right(ability1_tl, ability1_br)

    ability2_tl = points[idx + 2]
    ability2_br = points[idx + 3]
    ability2_dims = calculate_from_top_left_bottom_right(ability2_tl, ability2_br)

    logger.info(f"  Parsed selected abilities 1-2 for hero 0")

    # Calculate heroes_params and selected_abilities_params
    coords['heroes_params'] = {
        'width': hero0_dims['width'],
        'height': hero0_dims['height']
    }

    coords['selected_abilities_params'] = {
        'width': ability1_dims['width'],
        'height': ability1_dims['height']
    }

    # Generate all heroes (0-4 only, no bonus heroes)
    left_heroes = generate_heroes(hero0_dims, hero1_dims, coords['heroes_params'])
    logger.info(f"  Generated {len(left_heroes)} left hero boxes (heroes 0-4)")

    # Generate all selected abilities for left heroes
    left_selected = generate_selected_abilities(
        ability1_dims, ability2_dims, left_heroes, coords['selected_abilities_params']
    )
    logger.info(f"  Generated {len(left_selected)} left selected ability slots")

    # Apply hero orders to ultimates and standards
    left_ultimates = apply_ultimate_hero_orders(left_ultimates, is_left_side=True)
    left_standards = apply_standard_hero_orders(left_standards, is_left_side=True)

    # Apply hero orders to models (0,1,2,3,4,10)
    model_hero_orders = [0, 1, 2, 3, 4, 10]
    for i, model in enumerate(left_models):
        model.hero_order = model_hero_orders[i]

    logger.info(f"  Applied hero orders to left side elements")

    # Mirror to right side
    right_ultimates = mirror_elements_to_right(left_ultimates, screen_width, 'ultimates', True)
    right_ultimates = apply_ultimate_hero_orders(right_ultimates, is_left_side=False)

    right_standards = mirror_elements_to_right(left_standards, screen_width, 'standards', True)
    right_standards = apply_standard_hero_orders(right_standards, is_left_side=False)

    right_models = mirror_elements_to_right(left_models, screen_width, 'models', True)
    right_heroes = mirror_elements_to_right(
        left_heroes, screen_width, 'heroes', False,
        coords['heroes_params']['width'], coords['heroes_params']['height']
    )
    right_selected = mirror_elements_to_right(
        left_selected, screen_width, 'selected_abilities', False,
        coords['selected_abilities_params']['width'], coords['selected_abilities_params']['height']
    )

    logger.info(f"  Mirrored elements to right side")

    # Combine left + right
    coords['ultimate_slots_coords'] = [c.to_dict() for c in (left_ultimates + right_ultimates)]
    coords['standard_slots_coords'] = [c.to_dict() for c in (left_standards + right_standards)]
    coords['models_coords'] = [c.to_dict() for c in (left_models + right_models)]
    coords['heroes_coords'] = [c.to_dict() for c in (left_heroes + right_heroes)]
    coords['selected_abilities_coords'] = [c.to_dict() for c in (left_selected + right_selected)]

    logger.info(f"\n  Total coordinates generated:")
    logger.info(f"    Ultimates: {len(coords['ultimate_slots_coords'])}")
    logger.info(f"    Standards: {len(coords['standard_slots_coords'])}")
    logger.info(f"    Models: {len(coords['models_coords'])}")
    logger.info(f"    Heroes: {len(coords['heroes_coords'])}")
    logger.info(f"    Selected Abilities: {len(coords['selected_abilities_coords'])}")

    return coords


def draw_visualization(screenshot_path: str, calculated: Dict, output_path: str):
    """Generate visualization image with calculated boxes"""
    logger.info("\nGenerating visualization...")

    img = cv2.imread(screenshot_path)
    if img is None:
        logger.error(f"Failed to load screenshot for visualization")
        return

    # Colors
    GREEN = (0, 255, 0)
    RED = (0, 0, 255)
    BLUE = (255, 0, 0)
    CYAN = (255, 255, 0)
    MAGENTA = (255, 0, 255)

    categories = [
        ('ultimate_slots_coords', 'ULT', CYAN, True),
        ('standard_slots_coords', 'STD', GREEN, True),
        ('models_coords', 'MOD', BLUE, True),
        ('heroes_coords', 'HERO', MAGENTA, False),
        ('selected_abilities_coords', 'SEL', RED, False)
    ]

    for category, label_prefix, color, has_dimensions in categories:
        if category not in calculated:
            continue

        # Get dimensions from params for elements without stored dimensions
        if not has_dimensions:
            if category == 'heroes_coords':
                w = calculated['heroes_params']['width']
                h = calculated['heroes_params']['height']
            elif category == 'selected_abilities_coords':
                w = calculated['selected_abilities_params']['width']
                h = calculated['selected_abilities_params']['height']

        for i, coord in enumerate(calculated[category]):
            x, y = coord['x'], coord['y']

            if has_dimensions:
                w, h = coord['width'], coord['height']
            # else w, h already set from params above

            cv2.rectangle(img, (x, y), (x+w, y+h), color, 2)

            # Label
            hero = coord.get('hero_order', '?')
            label = f"{label_prefix}{i}:H{hero}"
            cv2.putText(img, label, (x+2, y+12), cv2.FONT_HERSHEY_SIMPLEX,
                       0.35, color, 1)

    # Add legend
    legend_y = 30
    cv2.putText(img, "ULT(Cyan) | STD(Green) | MOD(Blue) | HERO(Magenta) | SEL(Red)",
               (10, legend_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    # Save
    cv2.imwrite(output_path, img)
    logger.info(f"Visualization saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Complete manual mapper for unknown resolutions')
    parser.add_argument('--screenshot', required=True, help='Screenshot path')
    parser.add_argument('--output', required=True, help='Output JSON path')
    parser.add_argument('--resolution', help='Resolution name (e.g., 1920x1200). Auto-detected if not provided.')
    parser.add_argument('--output-dir', default='output', help='Output directory for visualization')

    args = parser.parse_args()

    print("\n" + "="*70)
    print("COMPLETE MANUAL MAPPER - Unknown Resolution Mapping")
    print("="*70)

    # Get screen dimensions
    img = cv2.imread(args.screenshot)
    if img is None:
        logger.error(f"Failed to load screenshot: {args.screenshot}")
        sys.exit(1)

    screen_height, screen_width = img.shape[:2]
    resolution = args.resolution if args.resolution else f"{screen_width}x{screen_height}"
    logger.info(f"Resolution: {resolution} ({screen_width}x{screen_height})")

    # Collect 68 clicks
    points = collect_68_clicks(args.screenshot)

    # Save clicks for reference
    clicks_path = f"{args.output_dir}/clicks_{resolution}.json"
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    with open(clicks_path, 'w') as f:
        json.dump({'resolution': resolution, 'clicks': points}, f, indent=2)
    logger.info(f"Clicks saved to: {clicks_path}")

    # Calculate coordinates
    calculated_coords = calculate_coordinates_from_clicks(points, screen_width)

    # Validate
    validation = validate_coordinates(calculated_coords, screen_width, screen_height)

    if not validation['passed']:
        logger.warning("\nValidation warnings/errors:")
        for err in validation['errors']:
            logger.error(f"  - {err}")
        for warn in validation['warnings']:
            logger.warning(f"  - {warn}")

        response = input("\nValidation failed. Continue anyway? (y/n): ")
        if response.lower() != 'y':
            logger.info("Aborted.")
            sys.exit(1)

    # Generate visualization
    viz_path = f"{args.output_dir}/visualization_{resolution}.png"
    draw_visualization(args.screenshot, calculated_coords, viz_path)

    # Save output JSON
    output_data = {
        resolution: calculated_coords
    }
    with open(args.output, 'w') as f:
        json.dump(output_data, f, indent=2)

    print("\n" + "="*70)
    print("MAPPING COMPLETE!")
    print("="*70)
    print(f"\nResolution: {resolution}")
    print(f"Output JSON: {args.output}")
    print(f"Visualization: {viz_path}")
    print(f"Clicks backup: {clicks_path}")
    print("\nYou can now add this resolution data to config/layout_coordinates.json")


if __name__ == '__main__':
    main()
