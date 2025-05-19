# Dota 2 Ability Draft Plus Overlay

**Dota 2 Ability Draft Plus** is a desktop overlay tool designed to provide players with valuable statistical insights during the Ability Draft phase of a Dota 2 game. It leverages real-time image recognition and a locally stored database to display win rates for heroes and abilities, and suggests powerful ability combinations. This version utilizes a Machine Learning model for accurate ability icon recognition.

**This project is currently focused on Windows.** macOS/Linux support may be considered in the future.

## Installation (Recommended for Users)

1.  **Download the Latest Release:**
    * Go to the [Releases Page](https://github.com/tiarin-hino/ability-draft-plus/releases) on GitHub.
    * Download the `.exe` installer (e.g., `Ability-Draft-Plus-Setup-X.Y.Z.exe`), the portable `.zip` version or standlone portable `.exe` application (e.g., `Ability-Draft-Plus-Portable-X.Y.Z.exe`).
2.  **Install:**
    * **Installer (`.exe`):** Run the installer and follow the on-screen instructions. A desktop shortcut will be created.
    * **Portable (`.zip`):** Extract the contents of the .zip file to a folder of your choice. Run `Ability Draft Plus.exe` from that folder.
    * **Portable Application (`.exe`):** Run `Ability-Draft-Plus-Portable-X.Y.Z.exe` from any folder.
3.  **First Launch:**
    * On the first launch, the application will set up its necessary files, including a local database with pre-bundled statistics.

## How to Use

The application consists of a **Control Panel** and an **Overlay**.

### 1. Control Panel

This is the main window you see when you start the application.

* **Update Windrun Data (Optional but Recommended):**
    * The application comes with a pre-filled database of hero and ability statistics.
    * To get the absolute latest data from [Windrun.io](https://windrun.io), click the "**Update Windrun Data (Full)**" button. This process can take a few minutes. The "Last updated" date will reflect the most recent successful scrape.
    * The "**Update Missing Hero Abilities**" button attempts to fetch data only for heroes whose specific ability tables are missing or empty, useful for retrying failed individual hero scrapes.
* **Select Screen Resolution:**
    * From the dropdown menu, select the screen resolution you are currently using for Dota 2. This is crucial for the overlay to correctly identify ability icons.
* **Activate Overlay:**
    * Once Dota 2 is in the Ability Draft phase, click the "**Activate Overlay**" button in the Control Panel. The Control Panel will hide, and the transparent overlay will appear.
* **Export Failed Samples:**
    * If the ML model misidentifies abilities, you can use the "Take Snapshot" feature in the overlay (see below). This button allows you to export these saved images as a .zip file, which you can then share over [Google Form](https://forms.gle/gkz7U3EBi1P1RHaCA) to help improve the model.

### 2. Using the Overlay

The overlay appears once activated and provides the in-game assistance. Initially overlay is started in idle mode, so you can start it before starting search.

* **Initial Scan:**
    * Once the Ability Draft screen is visible in Dota 2, click the "**Initial Scan**" button on the overlay (top-right corner).
    * The application will take a screenshot and use the ML model to identify all abilities in the draft pool and those already picked by heroes.
    * A status message will briefly appear indicating the scan progress.
* **Scan Overview & Tooltips:**
    * After the scan, hotspots will appear over identified ability icons.
    * **Hovering** over these hotspots will display a tooltip with:
        * Ability Name & Winrate (and High Skill Winrate).
        * Confidence score of the ML prediction.
        * Strong synergistic combinations with other abilities currently in the draft pool, along with their combined win rates.
        * Top-tier abilities from the remaining in the pool (based on a consolidated score of winrate, value, and pick order) will have a shimmering green border.
* **Select Your Hero (Optional but Recommended for Best Stats):**
    * After the initial scan, "**My Hero**" buttons will appear next to each hero portrait area.
    * Click the "**My Hero**" button corresponding to your hero in the draft. This tells the application which hero you are playing.
    * **Benefits**:
        * The application will use hero-specific ability statistics for your hero if available, providing more tailored "value" and "pick order" scores for abilities in the draft pool (but only after rescan is executed).
        * Abilities you pick will be highlighted with a gold border for easy identification.
    * If you clicked the wrong hero, a "**Change Hero**" button will appear; click it to deselect and then choose the correct one.
* **Rescan:**
    * After selecting your hero, or if the draft state changes (e.g., more abilities are picked), click the "**Rescan**" button.
    * This will re-process the screen, updating winrates, synergies, and scores, now taking into account your selected hero (if any) and the current state of picked abilities.
* **OP Combinations Window:**
    * If any "OP" combinations (pre-defined high-performing pairs) are detected among the available draft pool abilities, a window will appear on the top right.
    * This window lists powerful two-ability combos present in the current draft. You can hide/show this window.
* **Take Snapshot (Feedback for ML):**
    * If you notice an ability is misidentified by the overlay, click the "**Take Snapshot**" button.
    * This saves cropped images of all currently displayed ability icons to a `failed-samples` folder. These images can later be exported from the Control Panel to help improve the ML model.
    * A status message will confirm if the snapshot was saved.
* **Close Overlay:**
    * Press the `Esc` key or click the "X" button on the overlay to close it and return to the main Control Panel.

## Features

* **Real-time Data Insights:**
    * Shows ability win rates when hovering over abilities.
    * Suggests strong ability combinations from the current draft pool, along with their win rates.
    * Identifies "Top Tier" abilities in the pool based on a consolidated score.
    * All of the points above are available both as global metric or hero tailored
    * Shows "OP Combinations" (pre-defined strong pairs) available in the draft.
* **ML-Powered Ability Recognition:** Uses a TensorFlow.js model to identify ability icons from the screen, replacing an older image hashing method for improved accuracy.
* **Local Statistics Database:** All statistical data (hero win rates, ability win rates, synergy data) is stored in a local SQLite database. The initial database is bundled with the application.
* **Manual Data Updates:** The application's control panel allows users to scrape and update the local database from Windrun.io for the latest statistics.
* **Hero-Specific Stats:** When a user selects their hero, the overlay can use hero-specific data for more accurate ability valuations during the draft.
* **Feedback Mechanism:** Allows users to export images of incorrectly identified abilities to help improve the ML model.
* **Completely Standalone:** Apart from data update application doesn't need to connect anywhere to work.
* **Using publicly available data only:** Overlay doesn't provide unfair advantage due to the data being already publicly available.
* **Undetectable by Dota 2 Client:** In case you are afraid of automatic ban detection - Overlay relies solely on local databse and image recognition and doesn't communicate with game client.
* **Completely Free:** You don#t need to buy subsciprtion to use it. It is free to use and share.

## Screenshots:
![Control Panel](https://github.com/Tiarin-Hino/ability-draft-plus/images/Control_Panel.png "Control Panel")
![Idle Mode](https://github.com/Tiarin-Hino/ability-draft-plus/images/Idle_Mode.png "Idle Mode")
![Initial Scan](https://github.com/Tiarin-Hino/ability-draft-plus/images/Initial_Scan.png "Initial Scan")
![Ability Winrates](https://github.com/Tiarin-Hino/ability-draft-plus/images/Ability_Winrates.png "Ability Winrates")
![Winter Wyvern Suggestions](https://github.com/Tiarin-Hino/ability-draft-plus/images/Winter_Wyvern_Suggestions.png "Winter Wyvern Suggestions")
![Monkey King Suggestions](https://github.com/Tiarin-Hino/ability-draft-plus/images/Monkey_King_Suggestions.png "Monkey King Suggestions")
![Filter Picked Abilities](https://github.com/Tiarin-Hino/ability-draft-plus/images/Filter_Picked_Abilities.png "Filter Picked Abilities")

---
## For Developers: Running from Source

These instructions are primarily for **Windows**.

### Prerequisites

1.  **Node.js:** Download and install Node.js (which includes npm). A version compatible with Electron and `@tensorflow/tfjs-node` is required (e.g., Node.js 18.x or 20.x).
2.  **Python:**
    * **Crucial for `@tensorflow/tfjs-node` native module compilation:** Install a compatible Python version (e.g., **Python 3.9.x, 3.10.x, or 3.11.x**). Newer Python versions (3.12+) might cause issues as they removed `distutils`.
    * Add Python to your system's PATH or ensure you can set the `PYTHON` environment variable correctly.
3.  **C++ Build Tools (Windows):**
    * **Option A (Recommended):** Install Visual Studio (e.g., Community Edition). Ensure the "Desktop development with C++" workload is selected during installation.
    * **Option B (Alternative):** Try installing the standalone C++ build tools via `npm install --global --production windows-build-tools` from an Administrator PowerShell/Command Prompt.
4.  **Git:** For cloning the repository.

### Setup Steps

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/tiarin-hino/ability-draft-plus.git](https://github.com/tiarin-hino/ability-draft-plus.git)
    cd ability-draft-plus
    ```
    (Replace URL if your repository is different)

2.  **Set `PYTHON` Environment Variable (Windows - PowerShell Admin):**
    Before running `npm install`, it's critical to ensure `node-gyp` uses the correct Python version. Open PowerShell as Administrator and run:
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
    The `patch-package` utility is configured to run automatically after `npm install` (due to the `postinstall` script in `package.json`). This applies critical modifications, especially for `@tensorflow/tfjs-node`.
    If you encounter issues and suspect patches weren't applied, you can try running it manually:
    ```bash
    npx patch-package
    ```

5.  **Rebuild Native Modules for Electron:**
    Native Node.js modules (like `@tensorflow/tfjs-node`, `better-sqlite3`, `sharp`) need to be compiled against the specific version of Node.js used by Electron.
    * Ensure your Electron version is correctly set in `package.json` under `scripts.rebuild-tensorflow` (e.g., `-v 31.7.7` if your Electron is `^31.0.0`).
    * Run the rebuild scripts (ensure your `PYTHON` environment variable is still set from Step 2):
        ```bash
        npm run rebuild-all
        ```
        This script executes rebuilds for `better-sqlite3`, `sharp`, and `@tensorflow/tfjs-node`.

    * **Troubleshooting Native Modules (`@tensorflow/tfjs-node` specifically):**
        The `TFJS_PATCH.md` file contains detailed steps for resolving issues with `@tensorflow/tfjs-node`. This often involves:
        * Verifying the correct Python version and C++ build tools.
        * Ensuring `electron-rebuild` completes successfully.
        * Manually verifying the placement of the compiled `.node` file into the correct N-API versioned subfolder.
        * The patch applied by `patch-package` should handle the loader logic within `@tensorflow/tfjs-node`.

### Running the Application (Developer Mode)

Once the setup is complete:

1.  **Start the Application:**
    ```bash
    npm start
    ```
    This will launch the Electron application.

2.  **First Run - Data Setup:**
    On the first launch from source, the application will:
    * Copy the bundled `dota_ad_data.db` to your user data directory.
    * If this is the very first time the app is run (e.g. `isFirstRun` flag is true in `main.js`), it might automatically initiate a full data scrape from Windrun.io to populate/update the database. This process can take a few minutes. The UI will indicate that it's syncing data. You can also manually trigger updates from the control panel.

---
## Project Structure

The project is an Electron application with the following key components:

* `main.js`: The main Electron process, handling application lifecycle, IPC communication, database interactions, and image processing orchestration.
* `index.html` & `renderer.js`: The main control panel window.
* `overlay.html` & `overlayRenderer.js`: The transparent overlay window that displays information during the draft.
* `preload.js`: Electron preload script for secure IPC communication.
* `src/`: Contains the core logic:
    * `database/`: Manages SQLite database setup and queries.
    * `scraper/`: Scripts for scraping data from Windrun.io.
    * `imageProcessor.js`: Handles screen capture, icon cropping, and ML-based ability recognition.
* `model/tfjs_model/`: Contains the TensorFlow.js graph model and class names for ability recognition.
* `config/layout_coordinates.json`: Defines screen coordinates for ability icons.
* `dota_ad_data.db`: The bundled SQLite database.
* `patches/`: Contains patches applied via `patch-package`.
* `package.json`: Defines project dependencies and scripts.

## Development Notes

* **Database Updates:** The local SQLite database (`dota_ad_data.db` in your user data folder) is updated via the "Update Windrun Data" button in the app.
* **ML Model:** The ability recognition model is located in `model/tfjs_model/`.
* **Coordinates:** If the in-game Ability Draft UI changes, `config/layout_coordinates.json` may need updating.

## Contributing

Please open an issue on GitHub for bugs or feature requests.
Issue templates for bug reports and feature requests are available.

## Acknowledgements

* Data sourced from [Windrun.io](https://windrun.io)