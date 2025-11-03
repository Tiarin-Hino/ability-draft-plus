# Resolution Mapping Scripts

Tools for adding new screen resolutions to the Ability Draft application by manually clicking reference points.

## Overview

This folder contains two main scripts:

1. **complete_manual_mapper.py** - Generates coordinate data from 68 manual clicks on a screenshot
2. **test_ml_recognition.js** - Tests if the generated coordinates work with the ML model

## Prerequisites

### Python Setup

```bash
# Install Python dependencies
pip install -r requirements.txt
```

Required packages:
- `opencv-python` - Image processing and click collection
- `numpy` - Numerical operations

### Node.js Setup

The ML recognition test uses your existing Node.js setup. No additional installation needed.

## Quick Start

### 1. Generate Coordinates from Screenshot

```bash
python complete_manual_mapper.py --screenshot user_screenshot.png --output new_resolution.json
```

This opens an interactive window where you click 68 reference points. The script then:
- Calculates all 110+ coordinates automatically
- Mirrors left side to right side
- Validates coordinates are within bounds
- Saves to JSON file

### 2. Test with ML Model

```bash
node test_ml_recognition.js user_screenshot.png new_resolution.json 1920x1200
```

This runs your actual TensorFlow model against the screenshot using the new coordinates to verify they work correctly.

## Complete Manual Mapper Guide

### How It Works

You click **68 points** on the **LEFT SIDE ONLY** of the screenshot:
- Ultimate slots: 6 slots × 2 corners = 12 clicks
- Standard slots: 18 slots × 2 corners = 36 clicks
- Model slots: 6 models × 2 corners = 12 clicks
- Hero boxes: 2 heroes × 2 corners = 4 clicks
- Selected abilities: 2 slots × 2 corners = 4 clicks

The script automatically:
- Calculates remaining positions using spacing
- Mirrors everything to the right side
- Generates all 110+ coordinates needed

### Click Order

#### 1. Ultimate Slots (12 clicks)

Click the **6 ultimate slots** in the left 3 columns (row 1: slots 1-3, row 2: slots 4-6).

For each slot, click:
1. **Bottom-left corner**
2. **Top-right corner**

#### 2. Standard Ability Slots (36 clicks)

Click the **18 standard slots** in the left 3 columns × 6 rows (one row per hero).

For each slot, click:
1. **Top-left corner**
2. **Bottom-right corner**

#### 3. Model Slots (12 clicks)

Click the **6 hero models** on the left side (heroes 0, 1, 2, 3, 4, and bonus hero 10).

For each model, click:
1. **Top-left corner**
2. **Bottom-right corner**

#### 4. Hero Boxes (4 clicks)

Click **only the first 2 hero boxes** (heroes 0 and 1). The rest are calculated automatically.

For each hero box, click:
1. **Top-left corner**
2. **Bottom-right corner**

#### 5. Selected Ability Slots (4 clicks)

Click **only hero 0's first 2 ability slots** (slots 1 and 2). The rest are calculated automatically.

For each slot, click:
1. **Top-left corner**
2. **Bottom-right corner**

### Interactive Controls

While clicking:
- **'u'** - Undo last click (press multiple times to undo several)
- **'r'** - Reset all clicks and start over
- **'l'** - Toggle loupe mode (4x magnified cursor view in top-right corner)
- **'z'** - Toggle 2x zoom mode (for viewing only, clicking disabled)
- **'q'** - Quit
- **ENTER** - Finish (requires exactly 68 clicks)

### Tips for Accurate Clicking

1. **Use loupe mode ('l')** for precise corner clicking - shows 4x magnified view
2. **Take your time** - Use 'u' to undo mistakes instead of starting over
3. **Click exact corners** - Not just close to them
4. **Follow the order** - Ultimate slots first, then standards, models, heroes, selected abilities
5. **Check your count** - Numbers appear next to each click marker

### Output Files

All saved to `output/` directory:
- `new_resolution.json` - Coordinate data ready to add to `config/layout_coordinates.json`
- `visualization_WxH.png` - Visual verification showing all detected regions
- `clicks_WxH.json` - Backup of your 68 clicks

## ML Recognition Testing

After generating coordinates, test them with the actual ML model:

```bash
node test_ml_recognition.js screenshot.png coords.json 1920x1200
```

### What It Tests

- Crops ultimate and standard ability slots using your new coordinates
- Runs them through the TensorFlow.js model
- Reports confidence scores and identified abilities
- Shows success rate

### Expected Results

**Good coordinates should show:**
- High confidence predictions (>0.7) for most slots
- Successfully identified abilities: 80%+
- Few or no "below threshold" predictions

**If results are poor:**
- Re-run the mapper with more precise clicks
- Use loupe mode ('l') for better accuracy
- Check the visualization to see if crops align with abilities

### Output

Console shows:
- Prediction for each slot with confidence score
- Statistics: total tested, high confidence rate, identification rate
- Average confidence across all predictions

Files created in `output/ml_recognition/`:
- `ml_recognition_results.json` - Full prediction data

## Adding to Production

Once tested successfully:

1. Open `config/layout_coordinates.json`
2. Add your new resolution data from the generated JSON
3. Test in the actual application

Example:
```json
{
  "resolutions": {
    "2560x1440": { ... existing ... },
    "1920x1200": { ... paste your new data here ... }
  }
}
```

## Troubleshooting

### "Failed to load screenshot"
- Check file path is correct
- Ensure file is a valid image format (PNG recommended)

### "Validation failed: coordinates extend beyond width/height"
- Your clicks went outside the screenshot bounds
- Use 'r' to reset and click more carefully within the image

### "Need 68 clicks, have X"
- Keep clicking until you reach exactly 68 points
- Or press 'u' to undo if you have too many

### Low ML recognition confidence
- Coordinates may not be precise enough
- Re-run mapper using loupe mode ('l') for better accuracy
- Ensure you clicked the correct corners (check visualization)

### "Model failed to load" (Node.js script)
- Ensure `model/tfjs_model/` exists with model.json
- Run `npm install` to install @tensorflow/tfjs-node

## Technical Details

### Architecture

**complete_manual_mapper.py:**
- Uses OpenCV for interactive click collection
- `mapper_utils.py` contains shared calculation functions
- Implements mirroring logic for perfect left-right symmetry
- Validates all coordinates before saving

**test_ml_recognition.js:**
- Uses TensorFlow.js Node binding
- Sharp for image processing
- Matches the exact preprocessing used in the app

### Coordinate Structure

Each resolution requires:
- `heroes_params` - Width/height for hero boxes
- `selected_abilities_params` - Width/height for ability slots
- `ultimate_slots_coords` - 12 ultimate slots (3×2 grid per side)
- `standard_slots_coords` - 36 standard slots (3×6 grid per side)
- `models_coords` - 12 hero models (includes bonus heroes 10-11)
- `heroes_coords` - 10 hero boxes (heroes 0-9 only, no bonus)
- `selected_abilities_coords` - 40 ability slots (10 heroes × 4 slots)

### Why 68 Clicks?

We only collect clicks for the left side:
- 6 ultimate slots (both left and right corners)
- 18 standard slots (top-left and bottom-right)
- 6 model slots (top-left and bottom-right)
- 2 hero boxes (for spacing calculation)
- 2 selected ability slots (for spacing calculation)

Everything else is calculated or mirrored automatically, reducing manual work while maintaining accuracy.

## Files in This Directory

- `complete_manual_mapper.py` - Main script for coordinate generation
- `mapper_utils.py` - Shared utility functions
- `test_ml_recognition.js` - ML model testing script
- `requirements.txt` - Python dependencies
- `setup.bat` - Windows setup helper
- `prepare-app-config.js` - Build configuration script

## Questions or Issues?

If you encounter problems:
1. Check the visualization output to see what was detected
2. Review the validation errors in the console
3. Try re-running with loupe mode enabled
4. Ensure your screenshot shows the full Ability Draft UI
