"""
Shared utility functions for complete manual mapper

Provides coordinate calculation, mirroring, and validation logic.
"""

from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class Coord:
    """Coordinate with optional dimensions"""
    x: int
    y: int
    width: Optional[int] = None
    height: Optional[int] = None
    hero_order: Optional[int] = None
    ability_order: Optional[int] = None
    is_ultimate: Optional[bool] = None

    def to_dict(self):
        """Convert to dict, excluding None values"""
        result = {'x': self.x, 'y': self.y}
        if self.width is not None:
            result['width'] = self.width
        if self.height is not None:
            result['height'] = self.height
        if self.hero_order is not None:
            result['hero_order'] = self.hero_order
        if self.ability_order is not None:
            result['ability_order'] = self.ability_order
        if self.is_ultimate is not None:
            result['is_ultimate'] = self.is_ultimate
        return result


def calculate_from_bottom_left_top_right(bl: Tuple[int, int], tr: Tuple[int, int]) -> Dict:
    """
    Calculate x, y, width, height from bottom-left and top-right corners

    Args:
        bl: (x, y) of bottom-left corner
        tr: (x, y) of top-right corner

    Returns:
        Dict with x, y, width, height
    """
    x = bl[0]  # Left edge from bottom-left
    y = tr[1]  # Top edge from top-right
    width = tr[0] - bl[0]
    height = bl[1] - tr[1]

    return {'x': x, 'y': y, 'width': width, 'height': height}


def calculate_from_top_left_bottom_right(tl: Tuple[int, int], br: Tuple[int, int]) -> Dict:
    """
    Calculate x, y, width, height from top-left and bottom-right corners

    Args:
        tl: (x, y) of top-left corner
        br: (x, y) of bottom-right corner

    Returns:
        Dict with x, y, width, height
    """
    x = tl[0]  # Left edge from top-left
    y = tl[1]  # Top edge from top-left
    width = br[0] - tl[0]
    height = br[1] - tl[1]

    return {'x': x, 'y': y, 'width': width, 'height': height}


def mirror_coordinate(x: int, y: int, width: int, height: int, screen_width: int) -> Tuple[int, int]:
    """
    Mirror a coordinate from left side to right side

    Args:
        x, y: Original coordinate
        width, height: Element dimensions
        screen_width: Total screen width

    Returns:
        (mirrored_x, y) - y stays the same
    """
    screen_center = screen_width / 2
    mirrored_x = int(2 * screen_center - x - width)
    return mirrored_x, y


def calculate_hero_spacing(hero0: Dict, hero1: Dict) -> int:
    """Calculate vertical spacing between hero boxes"""
    return hero1['y'] - hero0['y']


def calculate_ability_spacing(ability1: Dict, ability2: Dict) -> int:
    """Calculate horizontal spacing between selected ability slots"""
    return ability2['x'] - ability1['x']


def generate_heroes(hero0: Dict, hero1: Dict, heroes_params: Dict) -> List[Coord]:
    """
    Generate all hero boxes from first two heroes

    Args:
        hero0, hero1: First two hero boxes with x, y
        heroes_params: {width, height}

    Returns:
        List of Coord objects for heroes 0-4 (left side)
        NOTE: Bonus heroes 10-11 do NOT exist in heroes_coords, only in models_coords
    """
    spacing = calculate_hero_spacing(hero0, hero1)

    heroes = []

    # Add hero 0 and 1
    for i, hero in enumerate([hero0, hero1]):
        heroes.append(Coord(
            x=hero['x'],
            y=hero['y'],
            hero_order=i
        ))

    # Generate heroes 2, 3, 4
    for i in range(2, 5):
        heroes.append(Coord(
            x=hero0['x'],
            y=hero1['y'] + (i - 1) * spacing,
            hero_order=i
        ))

    # NOTE: Do NOT generate hero 10 here - it only exists in models_coords
    # heroes_coords contains ONLY heroes 0-9 (5 per side)

    return heroes


def generate_selected_abilities(ability1: Dict, ability2: Dict,
                                heroes: List[Coord],
                                selected_params: Dict) -> List[Coord]:
    """
    Generate all selected ability slots from first hero's first 2 slots

    Args:
        ability1, ability2: First two selected ability slots for hero 0
        heroes: List of hero coordinates (0-4 only, no bonus heroes)
        selected_params: {width, height}

    Returns:
        List of Coord objects for all selected abilities (heroes 0-4 on left side)
    """
    spacing = calculate_ability_spacing(ability1, ability2)

    # Generate all 4 slots for hero 0
    hero0_slots = []
    for slot_idx in range(4):
        x = ability1['x'] + slot_idx * spacing
        hero0_slots.append(Coord(
            x=x,
            y=ability1['y'],
            hero_order=0,
            is_ultimate=(slot_idx == 3)  # 4th slot is ultimate
        ))

    # Apply same pattern to all heroes (0-4)
    all_abilities = []
    hero0_y = heroes[0].y

    for hero in heroes:
        y_offset = hero.y - hero0_y

        for slot_idx in range(4):
            all_abilities.append(Coord(
                x=hero0_slots[slot_idx].x,
                y=hero0_slots[slot_idx].y + y_offset,
                hero_order=hero.hero_order,
                is_ultimate=(slot_idx == 3)
            ))

    return all_abilities


def mirror_elements_to_right(left_elements: List[Coord],
                             screen_width: int,
                             element_type: str,
                             has_dimensions: bool = True,
                             element_width: int = 0,
                             element_height: int = 0) -> List[Coord]:
    """
    Mirror left-side elements to right side

    Args:
        left_elements: List of left-side Coord objects
        screen_width: Total screen width
        element_type: Type of element for hero_order mapping
        has_dimensions: Whether elements have width/height stored
        element_width: Width for elements without dimensions (from params)
        element_height: Height for elements without dimensions (from params)

    Returns:
        List of mirrored Coord objects
    """
    right_elements = []

    # Hero order offset mapping
    hero_order_offset = {
        'heroes': 5,  # Left 0-4 → Right 5-9
        'models': 5,
        'selected_abilities': 5,
        'ultimates': 0,  # Ultimates use specific mapping, not simple offset
        'standards': 0   # Standards use specific mapping
    }

    offset = hero_order_offset.get(element_type, 0)

    for elem in left_elements:
        if has_dimensions:
            width = elem.width
            height = elem.height
        else:
            # Use params width/height for elements without dimensions
            width = element_width
            height = element_height

        mirrored_x, mirrored_y = mirror_coordinate(
            elem.x, elem.y, width, height, screen_width
        )

        # Hero order mapping
        if elem.hero_order is not None:
            if elem.hero_order == 10:
                new_hero_order = 11  # Bonus hero 10 → 11
            elif element_type in ['heroes', 'models', 'selected_abilities']:
                new_hero_order = elem.hero_order + offset
            else:
                new_hero_order = elem.hero_order  # Keep as-is for ultimates/standards
        else:
            new_hero_order = None

        right_elements.append(Coord(
            x=mirrored_x,
            y=mirrored_y,
            width=width if has_dimensions else None,
            height=height if has_dimensions else None,
            hero_order=new_hero_order,
            ability_order=elem.ability_order,
            is_ultimate=elem.is_ultimate
        ))

    return right_elements


def apply_ultimate_hero_orders(ultimates: List[Coord], is_left_side: bool) -> List[Coord]:
    """
    Apply correct hero_order to ultimate slots based on layout pattern

    Layout:
    Row 1: [0, 1, 2, 7, 6, 5]
    Row 2: [3, 4, 10, 11, 9, 8]

    Args:
        ultimates: List of 6 ultimate Coord objects (3 cols × 2 rows)
        is_left_side: True if left side (first 3 columns), False if right

    Returns:
        List with hero_order applied
    """
    if is_left_side:
        # Left side: first 3 columns
        # Row 1: 0, 1, 2
        # Row 2: 3, 4, 10
        orders = [0, 1, 2, 3, 4, 10]
    else:
        # Right side: last 3 columns
        # Row 1: 7, 6, 5
        # Row 2: 11, 9, 8
        orders = [7, 6, 5, 11, 9, 8]

    for i, ult in enumerate(ultimates):
        ult.hero_order = orders[i]

    return ultimates


def apply_standard_hero_orders(standards: List[Coord], is_left_side: bool) -> List[Coord]:
    """
    Apply correct hero_order and ability_order to standard slots

    Layout: 6 rows (one per hero) × 3 abilities
    Left side: heroes 0, 1, 2, 3, 4, 10
    Right side: heroes 5, 6, 7, 8, 9, 11

    Args:
        standards: List of 18 standard Coord objects (3 cols × 6 rows)
        is_left_side: True if left side, False if right

    Returns:
        List with hero_order and ability_order applied
    """
    if is_left_side:
        hero_orders = [0, 1, 2, 3, 4, 10]
    else:
        hero_orders = [5, 6, 7, 8, 9, 11]

    # Assuming standards are ordered: row by row, left to right
    # 18 standards = 6 rows × 3 abilities
    for row_idx in range(6):
        for col_idx in range(3):
            idx = row_idx * 3 + col_idx
            standards[idx].hero_order = hero_orders[row_idx]
            standards[idx].ability_order = col_idx + 1

    return standards


def validate_coordinates(coords: Dict, width: int, height: int) -> Dict:
    """
    Validate generated coordinates

    Args:
        coords: Dictionary with all coordinate categories
        width, height: Screen dimensions

    Returns:
        Dict with validation results
    """
    validation = {
        'passed': True,
        'errors': [],
        'warnings': []
    }

    # Check boundaries
    categories_with_dims = [
        ('ultimate_slots_coords', 'width', 'height'),
        ('standard_slots_coords', 'width', 'height'),
        ('models_coords', 'width', 'height')
    ]

    categories_with_params = [
        ('heroes_coords', 'heroes_params'),
        ('selected_abilities_coords', 'selected_abilities_params')
    ]

    # Check elements with direct width/height
    for category, width_key, height_key in categories_with_dims:
        if category not in coords:
            continue

        for i, item in enumerate(coords[category]):
            item_width = item.get(width_key, 0)
            item_height = item.get(height_key, 0)

            if item['x'] < 0 or item['y'] < 0:
                validation['errors'].append(
                    f"{category}[{i}]: Negative coordinates (x={item['x']}, y={item['y']})"
                )
                validation['passed'] = False

            if item['x'] + item_width > width:
                validation['errors'].append(
                    f"{category}[{i}] hero_order={item.get('hero_order','?')}: Extends beyond width"
                )
                validation['passed'] = False

            if item['y'] + item_height > height:
                validation['errors'].append(
                    f"{category}[{i}] hero_order={item.get('hero_order','?')}: Extends beyond height"
                )
                validation['passed'] = False

    # Check elements with params
    for category, params_key in categories_with_params:
        if category not in coords or params_key not in coords:
            continue

        params = coords[params_key]
        for i, item in enumerate(coords[category]):
            if item['x'] < 0 or item['y'] < 0:
                validation['errors'].append(
                    f"{category}[{i}]: Negative coordinates"
                )
                validation['passed'] = False

            if item['x'] + params['width'] > width:
                validation['errors'].append(
                    f"{category}[{i}] hero_order={item.get('hero_order','?')}: Extends beyond width"
                )
                validation['passed'] = False

            if item['y'] + params['height'] > height:
                validation['errors'].append(
                    f"{category}[{i}] hero_order={item.get('hero_order','?')}: Extends beyond height"
                )
                validation['passed'] = False

    # Check counts
    expected_counts = {
        'ultimate_slots_coords': 12,
        'standard_slots_coords': 36,
        'heroes_coords': 10,  # Heroes 0-9 only, no bonus heroes
        'selected_abilities_coords': 40,  # 10 heroes × 4 slots
        'models_coords': 12  # Includes bonus heroes 10-11
    }

    for category, expected in expected_counts.items():
        if category not in coords:
            validation['errors'].append(f"Missing category: {category}")
            validation['passed'] = False
            continue

        actual = len(coords[category])
        if isinstance(expected, list):
            if actual not in expected:
                validation['warnings'].append(
                    f"{category}: Expected {expected}, got {actual}"
                )
        else:
            if actual != expected:
                validation['errors'].append(
                    f"{category}: Expected {expected}, got {actual}"
                )
                validation['passed'] = False

    return validation


def compare_coordinates(expected: Dict, calculated: Dict, category: str) -> List[Dict]:
    """
    Compare expected vs calculated coordinates for a category

    Args:
        expected: Expected coordinates from JSON
        calculated: Calculated coordinates
        category: Category name

    Returns:
        List of comparison results
    """
    comparisons = []

    for i, (exp, calc) in enumerate(zip(expected, calculated)):
        delta_x = calc['x'] - exp['x']
        delta_y = calc['y'] - exp['y']

        delta_width = 0
        delta_height = 0
        if 'width' in exp and 'width' in calc:
            delta_width = calc['width'] - exp['width']
            delta_height = calc['height'] - exp['height']

        # Calculate euclidean distance for position error
        position_error = (delta_x**2 + delta_y**2)**0.5

        comparisons.append({
            'index': i,
            'hero_order': exp.get('hero_order', '?'),
            'ability_order': exp.get('ability_order', '?'),
            'expected': exp,
            'calculated': calc,
            'delta_x': delta_x,
            'delta_y': delta_y,
            'delta_width': delta_width,
            'delta_height': delta_height,
            'position_error': position_error
        })

    return comparisons
