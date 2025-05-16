# Dota 2 Ability Draft Plus Overlay

**Dota 2 Ability Draft Plus** is a desktop overlay tool designed to provide players with valuable statistical insights during the Ability Draft phase of a Dota 2 game. It leverages real-time game state information and a locally stored database to display win rates for heroes and abilities, and suggests powerful ability combinations. This version utilizes a Machine Learning model for accurate ability icon recognition.

**This project is currently focused on Windows, with potential for macOS/Linux support in the future.**

## Features

* **Real-time Data:** Integrates with Dota 2's Game State Integration (GSI) to understand the current draft.
* **In-Draft Insights:**
    * Displays hero win rates when hovering over heroes.
    * Shows ability win rates when hovering over abilities.
    * Suggests strong ability combinations from the current draft pool, along with their win rates.
* **ML-Powered Ability Recognition:** Uses a TensorFlow.js model to identify ability icons from the screen, replacing an older image hashing method for improved accuracy.
* **Local Statistics Database:** All statistical data (hero win rates, ability win rates, synergy data) is stored in a local SQLite database.
* **Manual Data Updates:** The application includes a control panel to scrape and update the local database from Windrun.io.
* **Feedback Mechanism:** Allows users to export images of incorrectly identified abilities to help improve the ML model.

## Project Structure

The project is an Electron application with the following key components:

* `main.js`: The main Electron process, handling application lifecycle, IPC communication, GSI integration (conceptual), database interactions, and image processing orchestration.
* `index.html` & `renderer.js`: The main control panel window for the application.
* `overlay.html` & `overlayRenderer.js`: The transparent overlay window that displays information during the draft.
* `preload.js`: Electron preload script for secure IPC communication between main and renderer processes.
* `src/`: Contains the core logic:
    * `database/`:
        * `setupDatabase.js`: Manages SQLite database schema creation and updates.
        * `queries.js`: Contains functions for querying the SQLite database.
    * `scraper/`: Scripts for scraping data from Windrun.io (`heroScraper.js`, `abilityScraper.js`, `abilityPairScraper.js`).
    * `imageProcessor.js`: Handles screen capture, ability icon cropping, and ML-based ability recognition using TensorFlow.js.
* `model/tfjs_model/`: Contains the TensorFlow.js graph model (`model.json`, `*.bin` weight files) and `class_names.json` for ability icon recognition.
* `config/layout_coordinates.json`: Defines screen coordinates for ability icons at different resolutions.
* `dota_ad_data.db`: The bundled SQLite database (copied to user data on first run).
* `patches/`: Contains patches applied via `patch-package` (e.g., for `@tensorflow/tfjs-node`).
* `package.json`: Defines project dependencies, scripts, and build configurations.

## Installation and Running from Source

These instructions are primarily for **Windows**.

### Prerequisites

1.  **Node.js:** Download and install Node.js (which includes npm). A version compatible with Electron and `@tensorflow/tfjs-node` is required. (e.g., Node.js 18.x or 20.x).
2.  **Python:**
    * **Crucial for `@tensorflow/tfjs-node` native module compilation:** Install a compatible Python version (e.g., **Python 3.9.x, 3.10.x, or 3.11.x**). Newer Python versions (3.12+) might cause issues as they removed `distutils` which `node-gyp` might depend on.
    * Add Python to your system's PATH or ensure you can set the `PYTHON` environment variable correctly.
3.  **C++ Build Tools (Windows):**
    * **Option A (Recommended):** Install Visual Studio (e.g., Community Edition). Ensure the "Desktop development with C++" workload is selected during installation. This provides the necessary C++ compiler, SDKs, etc.
    * **Option B (Alternative):** Try installing the standalone C++ build tools via `npm install --global --production windows-build-tools` from an Administrator PowerShell/Command Prompt. (This might install older versions, Visual Studio is preferred).
4.  **Git:** For cloning the repository.

### Setup Steps

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/your-username/ability-draft-plus.git](https://github.com/your-username/ability-draft-plus.git)
    cd ability-draft-plus
    ```

2.  **Set `PYTHON` Environment Variable (Windows - PowerShell Admin):**
    Before running `npm install`, it's critical to ensure `node-gyp` (used for building native modules) uses the correct Python version. Open PowerShell as Administrator and run:
    ```powershell
    # Replace with the actual path to your Python 3.9/3.10/3.11 executable
    $env:PYTHON = "C:\Path\To\Your\Python39\python.exe"
    # Verify (optional):
    # Get-ChildItem Env:PYTHON
    # node -p "process.env.PYTHON"
    ```
    *You might need to set this every time you open a new terminal for development unless you set it globally in your system environment variables.*

3.  **Install Dependencies:**
    ```bash
    npm install
    ```
    This will install all project dependencies listed in `package.json`.

4.  **Apply Patches:**
    The `patch-package` utility is configured to run automatically after `npm install` (due to the `postinstall` script in `package.json`). This applies critical modifications, especially for `@tensorflow/tfjs-node`, to ensure it works correctly within the Electron environment.
    If you encounter issues and suspect patches weren't applied, you can try running it manually:
    ```bash
    npx patch-package
    ```

5.  **Rebuild Native Modules for Electron:**
    Native Node.js modules (like `@tensorflow/tfjs-node`, `better-sqlite3`, `sharp`) need to be compiled against the specific version of Node.js used by Electron.
    * **Ensure your Electron version is correctly set in `package.json` under `scripts.rebuild-tensorflow`** (e.g., `-v 31.7.7` if your Electron is `^31.0.0`).
    * Run the rebuild scripts (ensure your `PYTHON` environment variable is still set from Step 2):
        ```bash
        npm run rebuild-all
        ```
        This script executes:
        * `npm run rebuild-sqlite3`
        * `npm run rebuild-sharp`
        * `npm run rebuild-tensorflow` (which is `electron-rebuild -f -w @tensorflow/tfjs-node -v YOUR_ELECTRON_VERSION`)

    * **Troubleshooting Native Modules (`@tensorflow/tfjs-node` specifically):**
        The current `README.md` in the root of this repository (which will be moved to `docs/TROUBLESHOOTING_TFJS_NODE.md`) contains detailed steps for resolving issues with `@tensorflow/tfjs-node`. This often involves:
        * Verifying the correct Python version and C++ build tools.
        * Ensuring `electron-rebuild` completes successfully.
        * Manually verifying the placement of the compiled `.node` file (e.g., `tfjs_binding.node`) into the correct N-API versioned subfolder within `node_modules/@tensorflow/tfjs-node/lib/`. Your Electron runtime (check `process.versions.napi` in `main.js`) will indicate the expected N-API version (e.g., `napi-v9`).
        * The patch applied by `patch-package` should handle the loader logic within `@tensorflow/tfjs-node/dist/index.js` to correctly find this `.node` file.

### Running the Application

Once the setup is complete:

1.  **Start the Application:**
    ```bash
    npm start
    ```
    This will launch the Electron application.

2.  **First Run - Data Scraping:**
    On the first launch, the application will:
    * Copy the bundled `dota_ad_data.db` to your user data directory.
    * Automatically initiate a full data scrape from Windrun.io to populate the database with the latest hero, ability, and synergy statistics. This process can take a few minutes. The UI will indicate that it's syncing data.

3.  **Using the Application:**
    * **Control Panel:** The main window allows you to manually update data from Windrun.io, select your screen resolution for the overlay, and activate the overlay.
    * **Activate Overlay:** Once your Dota 2 game is in the Ability Draft phase, select your current screen resolution in the control panel and click "Activate Overlay". The control panel will hide, and the transparent overlay will appear.
    * **Scan:** The overlay has a "Scan Now" button. Click this when the draft screen is visible to identify abilities.
    * **Tooltips:** Hover over the identified ability icons (hotspots) to see win rates and synergy suggestions.
    * **Take Snapshot:** If an ability is misidentified, click the "Take Snapshot" button. This saves cropped images of all currently displayed abilities to a `failed-samples` folder in your user data directory. These can be used to retrain and improve the ML model.
    * **Export Failed Samples:** The main control panel has a button to zip and export these saved snapshot images.
    * **Close Overlay:** Press `Esc` or click the "X" button on the overlay to close it and return to the main control panel.

## Development Notes

* **Database Updates:** The local SQLite database (`dota_ad_data.db` in your user data folder) is updated via the "Update Windrun Data" button in the app.
* **ML Model:** The ability recognition model is located in `model/tfjs_model/`. To update or retrain this model, refer to the developer's internal documentation/workflow (which involved Google Colab for training and `tensorflowjs_converter` for conversion).
* **Coordinates:** If the in-game Ability Draft UI changes significantly, `config/layout_coordinates.json` may need to be updated with new pixel coordinates for ability slots.

## Contributing

(Optional: Add guidelines if you plan to accept contributions)
Please refer to `CONTRIBUTING.md` for more details.
Issues and feature requests can be submitted through the GitHub issues page.

## License

ISC License - see `LICENSE` file for details.

##Acknowledgements
* Data sourced from [Windrun.io](https://windrun.io)
* Utilizes Dota 2's Game State Integration capabilities.