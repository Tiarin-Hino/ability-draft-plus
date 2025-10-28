# Build Guide

Comprehensive guide for building and distributing the Ability Draft Plus application.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Build Scripts](#build-scripts)
- [Build Process](#build-process)
- [Distribution](#distribution)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js**: v16.x or later (v18.x recommended)
- **npm**: v7.x or later
- **Python**: v3.8 or later (for native module compilation)
- **Visual Studio Build Tools** (Windows): Required for native modules
  - Install with: `npm install --global windows-build-tools`
  - Or manually: Visual Studio 2019/2022 with "Desktop development with C++" workload

### System Requirements

- **Windows**: Windows 10 or later (64-bit)
- **RAM**: Minimum 4GB, 8GB+ recommended
- **Disk Space**: ~2GB for development dependencies

## Development Setup

### 1. Clone the Repository

\`\`\`bash
git clone https://github.com/tiarin-hino/ability-draft-plus.git
cd ability-draft-plus
\`\`\`

### 2. Install Dependencies

\`\`\`bash
npm install
\`\`\`

This will:
- Install all npm dependencies
- Run `electron-rebuild` to compile native modules for Electron
- Run `fix-tfjs-node-build.js` to patch TensorFlow.js for Electron

### 3. Configure Environment

For development, create a `.env` file in the project root:

\`\`\`env
# API Configuration
API_ENDPOINT_URL=https://your-api-endpoint.com
CLIENT_API_KEY=your-api-key-here
CLIENT_SHARED_SECRET=your-shared-secret-here

# Development flags (optional)
HOT_RELOAD=true
DEBUG=false
LOG_LEVEL=debug
\`\`\`

### 4. Verify Setup

\`\`\`bash
npm start
\`\`\`

The application should launch successfully.

## Build Scripts

### Development Scripts

#### `npm start`
Standard development start - runs the application without any special flags.

\`\`\`bash
npm start
\`\`\`

#### `npm run dev`
Development mode with **hot reload** enabled. Automatically reloads the app when files change.

\`\`\`bash
npm run dev
\`\`\`

Features:
- Watches `src/`, `main.js`, renderer files, HTML, CSS
- Renderer-only reload for renderer changes
- Full restart for main process changes
- 500ms debounce to prevent reload spam

#### `npm run dev:debug`
Development mode with **hot reload** and **debug mode** enabled.

\`\`\`bash
npm run dev:debug
\`\`\`

Features:
- All hot reload features
- Verbose logging
- Operation interception
- Performance tracking
- Memory monitoring

### Build Scripts

#### `npm run rebuild`
Rebuilds native modules for Electron.

\`\`\`bash
npm run rebuild
\`\`\`

Run this when:
- Electron version changes
- Native modules are updated
- Build errors occur with native modules

Rebuilds:
- `better-sqlite3`
- `sharp`
- `screenshot-desktop`
- `@tensorflow/tfjs-node`

#### `npm run prepare-config`
Prepares the production configuration file from environment variables.

\`\`\`bash
npm run prepare-config
\`\`\`

This script:
1. Reads API credentials from `.env` file
2. Generates `src/app-config.js` for bundling
3. Required before running `npm run dist`

#### `npm run dist`
Creates distributable packages for production.

\`\`\`bash
npm run dist
\`\`\`

This will:
1. Run `prepare-config` to generate app-config.js
2. Build the application with electron-builder
3. Create installers in `dist/` directory

Output files:
- `dist/Dota 2 Ability Draft Plus <version>.exe` (portable)
- `dist/Dota 2 Ability Draft Plus Setup <version>.exe` (installer)

### Utility Scripts

#### `npm run generate-mock-data`
Generates mock data for testing.

\`\`\`bash
npm run generate-mock-data [output-dir]
\`\`\`

Creates:
- `abilities.json` - 100 mock abilities
- `heroes.json` - 25 mock heroes
- `ability-pairs.json` - 50 ability pairs
- `initial-scan.json` - Initial scan result
- `subsequent-scan.json` - Subsequent scan result
- `predictions.json` - Prediction results
- `layout-coordinates.json` - Layout configs for 4 resolutions
- `test-scenarios.json` - Test scenarios

### Maintenance Scripts

#### `npm run postinstall`
Automatically runs after `npm install`. Don't run manually.

This hook:
1. Rebuilds native modules with `electron-rebuild`
2. Patches TensorFlow.js with `fix-tfjs-node-build.js`

## Build Process

### Development Build

Development builds use the source files directly without compilation.

1. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

2. **Start Development**
   \`\`\`bash
   npm run dev
   \`\`\`

### Production Build

Production builds create standalone executables with all dependencies bundled.

#### Step-by-Step Process

1. **Ensure Clean State**
   \`\`\`bash
   git status  # Should be clean
   \`\`\`

2. **Update Version** (if needed)

   Edit `package.json`:
   \`\`\`json
   {
     "version": "1.2.0"
   }
   \`\`\`

3. **Configure API Credentials**

   Update `.env` with production API credentials:
   \`\`\`env
   API_ENDPOINT_URL=https://api.production.com
   CLIENT_API_KEY=prod-api-key
   CLIENT_SHARED_SECRET=prod-shared-secret
   \`\`\`

4. **Run Production Build**
   \`\`\`bash
   npm run dist
   \`\`\`

5. **Verify Build**

   Check `dist/` directory for output files:
   \`\`\`
   dist/
   ├── Dota 2 Ability Draft Plus 1.2.0.exe           # Portable
   ├── Dota 2 Ability Draft Plus Setup 1.2.0.exe     # Installer
   └── win-unpacked/                                  # Unpacked files
   \`\`\`

6. **Test Build**

   Run the installer or portable version:
   - Test all major features
   - Verify API connectivity
   - Check ML model loading
   - Test database operations
   - Verify auto-updater

#### What Gets Bundled

**Included**:
- All source files in `src/`
- Main process files (`main.js`, `config.js`, etc.)
- Renderer files (`renderer.js`, `overlay-renderer.js`, etc.)
- HTML and CSS files
- Native modules (better-sqlite3, sharp, screenshot-desktop, tfjs-node)
- Resources: database, ML model, layout configs, images, locales
- `node_modules/` (excluding dev dependencies)

**Excluded** (see `package.json` `build.files`):
- Development files (`.env`, `*.code-workspace`)
- Documentation (`README.md`, `CONTRIBUTING.md`)
- Training data and failed samples
- Source control files (`.git`, `.gitignore`)
- Large unused dependencies (TensorFlow deps folder)
- Test files

#### Build Configuration

Build settings are defined in `package.json` under the `build` key:

\`\`\`json
{
  "build": {
    "appId": "com.tiarinhino.dota2abilitydraftplus",
    "productName": "Dota 2 Ability Draft Plus",
    "asar": true,
    "asarUnpack": [
      "**/tfjs_binding.node",
      "**/tensorflow.dll",
      "**/better_sqlite3.node",
      "**/sharp/build/Release/**",
      "**/screenshot-desktop/lib/win32/**"
    ],
    "win": {
      "icon": "build/icon.ico",
      "target": ["portable", "nsis"]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
\`\`\`

## Distribution

### Release Process

1. **Create GitHub Release**
   - Tag the commit: `git tag v1.2.0`
   - Push tags: `git push --tags`
   - Create release on GitHub

2. **Upload Artifacts**

   Upload to GitHub Release:
   - `Dota 2 Ability Draft Plus <version>.exe` (portable)
   - `Dota 2 Ability Draft Plus Setup <version>.exe` (installer)

3. **Update Auto-Updater**

   The auto-updater will automatically detect new releases via GitHub.

### Version Numbering

Follow semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes

Examples:
- `1.0.0` → `1.1.0`: New feature added
- `1.1.0` → `1.1.1`: Bug fix
- `1.1.1` → `2.0.0`: Breaking change

## Troubleshooting

### Common Issues

#### 1. Native Module Build Failures

**Error**: `Error: The module was compiled against a different Node.js version`

**Solution**:
\`\`\`bash
npm run rebuild
\`\`\`

#### 2. TensorFlow.js Binding Error

**Error**: `Cannot find module 'tfjs_binding.node'`

**Solution**:
\`\`\`bash
node scripts/fix-tfjs-node-build.js
\`\`\`

#### 3. SQLite Version Mismatch

**Error**: `VERSION mismatch: electron version, but Node.js version expected`

**Solution**:
\`\`\`bash
npm install --save-dev @electron/rebuild
npm run rebuild
\`\`\`

#### 4. Missing API Configuration

**Error**: `CRITICAL ERROR: API Configuration is missing`

**Solution**:
1. Create `.env` file with API credentials
2. Run `npm run prepare-config` (for production build)

#### 5. Build Fails with "Cannot find module"

**Solution**:
\`\`\`bash
# Clean install
rm -rf node_modules package-lock.json
npm install
\`\`\`

#### 6. electron-builder Hangs

**Solution**:
- Check antivirus isn't blocking electron-builder
- Try with `DEBUG=electron-builder npm run dist`
- Delete `dist/` folder and try again

### Debug Build Issues

#### Enable Verbose Logging

\`\`\`bash
DEBUG=electron-builder npm run dist
\`\`\`

#### Check Build Logs

Electron-builder creates logs in:
- Windows: `%APPDATA%\\electron-builder\\`

#### Verify electron-rebuild

\`\`\`bash
npx electron-rebuild --version
npx electron-rebuild
\`\`\`

### Performance Issues During Build

- **Slow build**: Exclude large folders in `.gitignore` and `build.files`
- **Out of memory**: Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096 npm run dist`
- **Disk space**: Ensure 2GB+ free space

## Additional Resources

- [Electron Builder Documentation](https://www.electron.build/)
- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [Native Module Compilation](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [TensorFlow.js Node](https://www.tensorflow.org/js/guide/nodejs)

## Support

For build-related issues:
1. Check this documentation
2. Search [GitHub Issues](https://github.com/tiarin-hino/ability-draft-plus/issues)
3. Create a new issue with:
   - Node.js version (`node --version`)
   - npm version (`npm --version`)
   - Electron version
   - Full error log
   - Build command used

