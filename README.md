# Dota 2 Ability Draft Plus Overlay

**Dota 2 Ability Draft Plus** is a desktop overlay tool designed to provide players with valuable statistical insights during the Ability Draft phase of a Dota 2 game. It leverages real-time Machine Learning (ML) based image recognition and a locally stored database to display win rates for heroes and abilities, and suggests powerful ability combinations.

**This project is currently focused on Windows.** macOS/Linux support may be considered in the future.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/tiarinhino) 
## Features

* **Real-time Data Insights During Draft:**
    * Displays hero and ability win rates upon hover.
    * Suggests strong ability combinations from the current draft pool, with associated win rates.
    * Highlights "Top Tier" abilities and hero models based on a consolidated score (winrate, value, pick order).
    * Shows "OP Combinations" (pre-defined high-performing pairs) available in the current draft pool.
* **ML-Powered Ability Recognition:** Utilizes a TensorFlow.js model to accurately identify ability icons from the screen.
* **Local Statistics Database:** All statistical data (hero/ability win rates, synergy data) is stored in a local SQLite database, initially bundled with the application.
* **Manual Data Updates:** The Control Panel allows users to scrape and update the local database from Windrun.io for the latest statistics.
* **Hero-Specific Context:**
    * When a user selects their hero ("My Hero"), the overlay can tailor suggestions and ability valuations.
    * When a user selects a "My Model" hero, suggestions are filtered to focus on abilities.
* **Feedback Mechanism:** Allows users to "Take Snapshot" of ability icons if misidentified. These snapshots can be exported and shared (e.g., via [Google Form](https://forms.gle/gkz7U3EBi1P1RHaCA) or GitHub Issues) to help improve the ML model.
* **Standalone Operation:** Once data is updated, the overlay functions locally without needing a constant internet connection during gameplay.
* **Non-Intrusive Design:** Runs as an overlay, processing screen information without direct interaction with the Dota 2 game client. This means it relies solely on image recognition and its local database.
* **Free to Use:** No subscriptions or payments required.

## Installation (Users)

1.  **Download the Latest Release:**
    * Go to the [Releases Page](https://github.com/tiarin-hino/ability-draft-plus/releases) on GitHub.
    * Download the `.exe` installer (e.g., `Ability-Draft-Plus-Setup-X.Y.Z.exe`) for a standard installation, or the portable `.exe` (e.g., `Ability-Draft-Plus-Portable-X.Y.Z.exe`) for a standalone version. A `.zip` version might also be available for manual extraction.
2.  **Install:**
    * **Installer (`.exe`):** Run the installer and follow the on-screen instructions. A desktop shortcut will typically be created.
    * **Portable Application (`.exe`):** Simply run the downloaded executable from any folder.
    * **Portable (`.zip`):** Extract the contents of the `.zip` file to a folder of your choice. Run `Ability Draft Plus.exe` (or the similarly named main executable) from that folder.
3.  **First Launch:**
    * On the first launch, the application will set up necessary files, including copying the bundled local database with pre-filled statistics.

## How to Use

The application has two main parts: the **Control Panel** (main window) and the **Overlay** (in-game).

### 1. Control Panel

This window appears when you start the application.

* **Update Windrun Data (Optional but Recommended):**
    * The app includes a pre-filled database. For the latest stats from [Windrun.io](https://windrun.io), click "**Update Windrun Data (Full)**". This can take a few minutes.
    * The "Last updated" date shows the freshness of your local data.
* **Select Screen Resolution:**
    * From the dropdown, **select the screen resolution you use for Dota 2.** This is critical for accurate ability recognition by the overlay.
* **Activate Overlay:**
    * Once Dota 2 is running and you are in (or about to enter) the Ability Draft phase, click "**Activate Overlay**". The Control Panel will hide, and the transparent overlay will appear.
* **Export Failed Samples:**
    * If the ML model misidentifies abilities, use the "Take Snapshot" feature in the overlay (see below). This button lets you export these saved images as a `.zip` file, which you can then share for model improvement.

### 2. Using the Overlay

The overlay provides in-game assistance once activated.

* **Initial Scan:**
    * Once the Ability Draft screen is fully visible in Dota 2 (showing all heroes and abilities), click the "**Initial Scan**" button on the overlay (top-right).
    * The app will analyze the screen to identify abilities in the pool and those already picked.
* **Tooltips & Insights:**
    * After the scan, interactive hotspots appear over identified abilities and hero models.
    * **Hovering** over these displays a tooltip with:
        * Ability/Hero Name, Winrate, High Skill Winrate.
        * ML prediction confidence (for abilities).
        * Strong synergistic combinations (for abilities in the pool) with other available abilities.
        * "Top Tier" abilities/models (based on a consolidated score) are highlighted with a shimmering border.
* **Select Your Hero (Recommended):**
    * After the initial scan, "**My Hero**" buttons appear next to each of the 10 hero portrait areas.
    * Click the "**My Hero**" button corresponding to your hero in the draft.
    * **Benefits:**
        * The overlay may provide more tailored "value" or "pick order" context for abilities if this feature is expanded.
        * Abilities you pick will be distinctly highlighted.
        * Top-tier ultimate suggestions may be filtered if you've already picked an ultimate.
    * If you misclick, a "**My Hero (Change)**" button appears; click it to deselect, then choose the correct one.
* **Set Model Hero (Optional):**
    * After the initial scan, "**Set Model**" buttons appear near the 12 hero models displayed in the center of the draft screen.
    * Clicking this for one of the hero models will tailor "Top Tier" suggestions to focus only on *abilities* (filtering out other hero models from suggestions), assuming you want to build around that model's abilities.
    * Click "**My Model (Change)**" to deselect.
* **Rescan:**
    * After selecting "My Hero", "My Model", or if the draft state changes (abilities are picked), click "**Rescan**".
    * This re-processes the screen, updating insights based on the current context.
* **OP Combinations Window:**
    * If any pre-defined high-performing ("OP") two-ability combos are detected among available draft pool abilities, a window will appear (top-right). You can hide/show this.
* **Take Snapshot (Feedback for ML):**
    * If you notice an ability is misidentified, click "**Take Snapshot**".
    * This saves cropped images of all ability icons currently displayed to a local `failed-samples` folder. These can be exported via the Control Panel.
* **Close Overlay:**
    * Press the `Esc` key or click the "X" button on the overlay to close it and return to the Control Panel.

## Screenshots

**Control Panel**
![Control Panel](/images/Control_Panel.png "Control Panel")

**Overlay - Idle Mode**
![Idle Mode](/images/Idle_Mode.png "Idle Mode")

**Overlay - Initial Scan Done, Tooltip Example**
![Initial Scan](/images/Initial_Scan.png "Initial Scan")

**Overlay - Ability Winrates & Suggestions**
![Ability Winrates](/images/Ability_Winrates.png "Ability Winrates")

*(More screenshots showing different states like "My Hero" selected, "My Model" selected, OP Combinations window can be added here.)*

---

## For Developers: Running from Source

These instructions are primarily for **Windows**.

### Prerequisites

1.  **Node.js:** Install Node.js (includes npm). A version compatible with your project's Electron version is required (check `package.json`).
2.  **Python:**
    * **Crucial for native module compilation (e.g., `@tensorflow/tfjs-node`):** Install Python **3.9.x, 3.10.x, or 3.11.x**. Newer Python versions (3.12+) might cause build issues due to the removal of `distutils`.
    * Ensure Python is added to your system's PATH or set the `PYTHON` environment variable correctly before building.
3.  **C++ Build Tools (Windows):**
    * **Recommended:** Install Visual Studio (e.g., Community Edition) with the "Desktop development with C++" workload selected.
    * **Alternative:** `npm install --global --production windows-build-tools` (from an Admin PowerShell/CMD), but this might install older tools.
4.  **Git:** For cloning the repository.

### Setup Steps

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/tiarin-hino/ability-draft-plus.git](https://github.com/tiarin-hino/ability-draft-plus.git)
    cd ability-draft-plus
    ```

2.  **Set `PYTHON` Environment Variable (Windows - PowerShell Admin Example):**
    Before running `npm install`, ensure `node-gyp` (used for native module compilation) targets the correct Python version.
    ```powershell
    # Replace with the actual path to your Python 3.9.x/3.10.x/3.11.x executable
    $env:PYTHON = "C:\Path\To\Your\Python3.9\python.exe" 
    # Verify (optional): node -p "process.env.PYTHON"
    ```
    This needs to be set for the terminal session where you run subsequent npm commands.

3.  **Install Dependencies:**
    ```bash
    npm install
    ```
    This installs dependencies and should trigger `patch-package` if configured in `postinstall`.

4.  **Rebuild Native Modules for Electron:**
    Native modules must be compiled against Electron's Node.js version.
    * Ensure your Electron version is correctly referenced in the `rebuild-tensorflow` script in `package.json` (e.g., `-v 31.7.7` if your Electron version in `devDependencies` is `^31.0.0`).
    * Run the rebuild script (ensure `PYTHON` environment variable is set):
        ```bash
        npm run rebuild-all 
        ```
        This script should handle rebuilding `better-sqlite3`, `sharp`, and `@tensorflow/tfjs-node`.

    * **Troubleshooting `@tensorflow/tfjs-node`:** Refer to `TFJS_PATCH.md` for detailed steps on resolving native module issues with `@tensorflow/tfjs-node`, including manual verification of `.node` file placement and the role of `patch-package`.

### Running the Application (Developer Mode)

1.  **Start the Application:**
    ```bash
    npm start
    ```

2.  **First Run - Data Setup:**
    * On the first launch from source, if the database doesn't exist in the user data path, the application will copy the bundled `dota_ad_data.db`.
    * The UI will indicate "Using bundled data." You can (and should) then use the "Update Windrun Data (Full)" button in the Control Panel to get the latest statistics.

---

## Project Structure

* `main.js`: Electron main process. Handles app lifecycle, IPC, database, ML orchestration.
* `index.html` & `renderer.js`: UI and logic for the main Control Panel.
* `overlay.html` & `overlayRenderer.js`: UI and logic for the in-game transparent overlay.
* `preload.js`: Securely exposes main process functionalities to renderers.
* `src/`:
    * `database/`: SQLite database setup (`setupDatabase.js`) and queries (`queries.js`).
    * `scraper/`: Scripts for scraping data from Windrun.io (`heroScraper.js`, `abilityScraper.js`, `abilityPairScraper.js`).
    * `imageProcessor.js`: Handles screen capture, icon cropping, and ML-based ability recognition.
* `model/tfjs_model/`: Contains the TensorFlow.js graph model (`model.json`, `.bin` files) and `class_names.json`.
* `config/layout_coordinates.json`: Defines screen coordinates for UI elements at different resolutions.
* `dota_ad_data.db` (root): The bundled SQLite database, copied to user data on first run.
* `patches/`: Contains patches applied via `patch-package` (e.g., for `@tensorflow/tfjs-node`).
* `package.json`: Project dependencies, scripts, and build configuration.
* `TFJS_PATCH.md`: Detailed guide for troubleshooting `@tensorflow/tfjs-node` native module issues.

## Development Notes

* **Database:** The local SQLite database (`dota_ad_data.db` in your user data folder) is managed by `src/database/setupDatabase.js` and populated/updated by the scraper scripts in `src/scraper/`.
* **ML Model:** The ability recognition model is in `model/tfjs_model/`.
* **Coordinates:** UI element coordinates for screen scraping are in `config/layout_coordinates.json`. These may need updates if the in-game Ability Draft UI changes significantly.

## Contributing & Feedback

For bugs, feature requests, or other feedback:

* Please open an issue on the [GitHub Issues page](https://github.com/tiarin-hino/ability-draft-plus/issues). Use the provided templates for bug reports or feature requests.
* For submitting misidentified ability icons (after using "Take Snapshot"), you can create an issue and attach the exported `.zip` file, or use the [Google Form](https://forms.gle/gkz7U3EBi1P1RHaCA) as mentioned in the application.

## Acknowledgements

* Statistical data for heroes and abilities is primarily sourced from [Windrun.io](https://windrun.io).
* This tool is a fan-made project and is not affiliated with Valve Corporation or Dota 2.
