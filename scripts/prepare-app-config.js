const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiUrl = process.env.API_ENDPOINT_URL;
const apiKey = process.env.CLIENT_API_KEY;
const sharedSecret = process.env.CLIENT_SHARED_SECRET;

const configContent = `
// This file is auto-generated during the build process.
// Do not edit it manually, as your changes will be overwritten.
module.exports = {
  API_ENDPOINT_URL: "${apiUrl}",
  CLIENT_API_KEY: "${apiKey}",
  CLIENT_SHARED_SECRET: "${sharedSecret}"
};
`;

try {
    fs.writeFileSync(path.resolve(__dirname, '../src/app-config.js'), configContent.trim(), 'utf8');
    console.log('Build: src/app-config.js generated successfully with production values.');
} catch (error) {
    console.error('Build Error: Failed to generate src/app-config.js:', error);
    process.exit(1);
}