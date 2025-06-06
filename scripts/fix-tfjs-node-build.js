const fs = require('fs');
const path = require('path');

console.log('[Fix-TFJS] Running post-rebuild script to fix tfjs-node file layout...');

const tfjsNodeLibPath = path.join(__dirname, '..', 'node_modules', '@tensorflow', 'tfjs-node', 'lib');

if (!fs.existsSync(tfjsNodeLibPath)) {
    console.log('[Fix-TFJS] TensorFlow.js Node library path not found. Skipping fix.');
    process.exit(0);
}

try {
    const napiDirs = fs.readdirSync(tfjsNodeLibPath).filter(f => f.startsWith('napi-v') && fs.statSync(path.join(tfjsNodeLibPath, f)).isDirectory());

    let nodeFileDir = null;
    let dllFileDir = null;

    for (const dir of napiDirs) {
        const dirPath = path.join(tfjsNodeLibPath, dir);
        const files = fs.readdirSync(dirPath);
        if (files.includes('tfjs_binding.node')) {
            nodeFileDir = dirPath;
            console.log(`[Fix-TFJS] Found 'tfjs_binding.node' in: ${dirPath}`);
        }
        if (files.includes('tensorflow.dll')) {
            dllFileDir = dirPath;
            console.log(`[Fix-TFJS] Found 'tensorflow.dll' in: ${dirPath}`);
        }
    }

    if (nodeFileDir && dllFileDir && nodeFileDir !== dllFileDir) {
        console.warn(`[Fix-TFJS] Mismatch found! .node and .dll files are in different directories.`);
        const sourceDllPath = path.join(dllFileDir, 'tensorflow.dll');
        const destDllPath = path.join(nodeFileDir, 'tensorflow.dll');

        if (fs.existsSync(sourceDllPath)) {
            console.log(`[Fix-TFJS] Copying 'tensorflow.dll' from ${sourceDllPath} to ${destDllPath}...`);
            fs.copyFileSync(sourceDllPath, destDllPath);
            console.log('[Fix-TFJS] Copy successful! The native module should now load correctly.');
        } else {
             console.error('[Fix-TFJS] Source tensorflow.dll not found at expected path. Cannot fix layout.');
        }
    } else if (nodeFileDir && dllFileDir && nodeFileDir === dllFileDir) {
        console.log('[Fix-TFJS] Files are already in the same directory. No fix needed.');
    } else {
        console.log('[Fix-TFJS] Could not find both .node and .dll files, or one is missing. Skipping.');
    }

} catch (error) {
    console.error('[Fix-TFJS] An error occurred while trying to fix the TensorFlow.js Node layout:', error);
}