/**
 * @file Script to generate mock data for testing
 * Run with: node scripts/generate-mock-data.js [output-dir]
 */

const path = require('path');
const fs = require('fs');
const mockGen = require('../src/test/mockDataGenerators');

// Get output directory from command line args or use default
const outputDir = process.argv[2] || path.join(__dirname, '..', 'mock-data');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
}

console.log('Generating mock data...\n');

// 1. Generate abilities dataset
console.log('1. Generating abilities dataset...');
const abilities = mockGen.generateAbilities(100);
mockGen.saveMockData(path.join(outputDir, 'abilities.json'), abilities);
console.log(`   Generated ${abilities.length} abilities\n`);

// 2. Generate heroes dataset
console.log('2. Generating heroes dataset...');
const heroes = mockGen.SAMPLE_HEROES.map((name, index) =>
    mockGen.generateHero({ name, id: index + 1 })
);
mockGen.saveMockData(path.join(outputDir, 'heroes.json'), heroes);
console.log(`   Generated ${heroes.length} heroes\n`);

// 3. Generate ability pairs
console.log('3. Generating ability pairs...');
const pairs = [];
for (let i = 0; i < 50; i++) {
    const ability1 = mockGen.randomPick(mockGen.SAMPLE_ABILITIES);
    const ability2 = mockGen.randomPick(
        mockGen.SAMPLE_ABILITIES.filter((a) => a !== ability1)
    );
    pairs.push(mockGen.generateAbilityPair(ability1, ability2));
}
mockGen.saveMockData(path.join(outputDir, 'ability-pairs.json'), pairs);
console.log(`   Generated ${pairs.length} ability pairs\n`);

// 4. Generate initial scan result
console.log('4. Generating initial scan result...');
const initialScan = mockGen.generateScanResult({
    isInitialScan: true,
    abilityCount: 20
});
mockGen.saveMockData(path.join(outputDir, 'initial-scan.json'), initialScan);
console.log('   Generated initial scan result\n');

// 5. Generate subsequent scan result
console.log('5. Generating subsequent scan result...');
const subsequentScan = mockGen.generateScanResult({
    isInitialScan: false,
    abilityCount: 15
});
mockGen.saveMockData(
    path.join(outputDir, 'subsequent-scan.json'),
    subsequentScan
);
console.log('   Generated subsequent scan result\n');

// 6. Generate prediction results
console.log('6. Generating prediction results...');
const selectedAbilities = mockGen.randomPickMultiple(mockGen.SAMPLE_ABILITIES, 5);
const predictions = mockGen.generatePredictionResults(selectedAbilities, 10);
mockGen.saveMockData(path.join(outputDir, 'predictions.json'), predictions);
console.log(
    `   Generated predictions for ${selectedAbilities.length} selected abilities\n`
);

// 7. Generate layout coordinates for common resolutions
console.log('7. Generating layout coordinates...');
const resolutions = ['1920x1080', '2560x1440', '3840x2160', '1280x720'];
const layouts = {};
resolutions.forEach((resolution) => {
    layouts[resolution] = mockGen.generateLayoutCoordinates(resolution);
});
mockGen.saveMockData(path.join(outputDir, 'layout-coordinates.json'), layouts);
console.log(`   Generated layouts for ${resolutions.length} resolutions\n`);

// 8. Generate test scenarios
console.log('8. Generating test scenarios...');
const scenarios = {
    'high-confidence-scan': mockGen.generateScanResult({
        isInitialScan: true,
        abilityCount: 20
    }),
    'low-confidence-scan': {
        ...mockGen.generateScanResult({ isInitialScan: false, abilityCount: 15 }),
        results: {
            ...mockGen.generateScanResult({ isInitialScan: false, abilityCount: 15 })
                .results,
            detected_abilities: mockGen
                .generateScanResult({ isInitialScan: false, abilityCount: 15 })
                .results.detected_abilities.map((ability) => ({
                    ...ability,
                    confidence: mockGen.randomFloat(0.7, 0.85, 3)
                }))
        }
    },
    'empty-scan': {
        status: 'success',
        isInitialScan: false,
        timestamp: Date.now(),
        results: {
            detected_abilities: [],
            scan_duration: 1000,
            resolution: '1920x1080'
        }
    },
    'error-scan': {
        status: 'error',
        error: {
            message: 'Failed to capture screenshot',
            code: 'SCREENSHOT_ERROR'
        },
        timestamp: Date.now()
    }
};
mockGen.saveMockData(path.join(outputDir, 'test-scenarios.json'), scenarios);
console.log(`   Generated ${Object.keys(scenarios).length} test scenarios\n`);

// 9. Generate README
console.log('9. Generating README...');
const readme = `# Mock Data for Testing

This directory contains generated mock data for testing the Ability Draft Plus application.

## Files

- **abilities.json**: ${abilities.length} mock abilities with winrates and pick order data
- **heroes.json**: ${heroes.length} mock heroes with attributes and roles
- **ability-pairs.json**: ${pairs.length} mock ability pairs with synergy scores
- **initial-scan.json**: Mock initial scan result with hero models and abilities
- **subsequent-scan.json**: Mock subsequent scan result with abilities only
- **predictions.json**: Mock prediction results based on selected abilities
- **layout-coordinates.json**: Mock layout coordinates for ${resolutions.length} common resolutions
- **test-scenarios.json**: ${Object.keys(scenarios).length} test scenarios (high/low confidence, empty, error)

## Usage

### In Tests

\`\`\`javascript
const mockGen = require('../src/test/mockDataGenerators');

// Load pre-generated data
const abilities = mockGen.loadMockData('./mock-data/abilities.json');

// Or generate fresh data
const scanResult = mockGen.generateScanResult({ isInitialScan: true });
\`\`\`

### Regenerate Data

\`\`\`bash
node scripts/generate-mock-data.js [output-dir]
\`\`\`

## Mock Data Generators

The \`src/test/mockDataGenerators.js\` module provides:

- \`generateAbility()\` - Generate single ability
- \`generateAbilities(count)\` - Generate multiple abilities
- \`generateHero()\` - Generate hero data
- \`generateScanResult()\` - Generate scan result
- \`generatePredictionResults()\` - Generate predictions
- \`generateMockScreenshot()\` - Generate mock screenshot data URL
- And more...

Generated on: ${new Date().toISOString()}
`;

fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
console.log('   Generated README.md\n');

console.log('✅ Mock data generation complete!');
console.log(`   Output directory: ${outputDir}`);
console.log(`   Total files: ${fs.readdirSync(outputDir).length}`);
