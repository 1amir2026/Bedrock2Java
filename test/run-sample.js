'use strict';
// Runs the conversion pipeline end-to-end against test/sample-addon and verifies
// it completes without throwing and without logging any ERROR entries.
// Used by .github/workflows/build.yml as a cross-platform sanity check.

const path = require('path');
const fs = require('fs');
const { runConversion } = require('../lib/pipeline');
const { CATEGORY_ORDER } = require('../lib/featureMap');

const addonPath = path.join(__dirname, 'sample-addon');
const outDir = path.join(__dirname, 'output', 'rubymod');

if (fs.existsSync(path.join(__dirname, 'output'))) {
  fs.rmSync(path.join(__dirname, 'output'), { recursive: true, force: true });
}

runConversion({
  addonPath,
  outDir,
  modId: 'rubymod',
  modName: 'Ruby Mod',
  modVersion: '1.0.0',
  authorName: 'CI',
  description: 'CI smoke test build',
  selectedCategories: CATEGORY_ORDER
})
  .then(({ counts }) => {
    if (counts.ERROR > 0) {
      console.error(`Smoke test FAILED: ${counts.ERROR} ERROR entries logged.`);
      process.exit(1);
    }
    const mustExist = [
      path.join(outDir, 'build.gradle'),
      path.join(outDir, 'src', 'main', 'resources', 'fabric.mod.json'),
      path.join(outDir, 'conversion-log.md')
    ];
    for (const f of mustExist) {
      if (!fs.existsSync(f)) {
        console.error(`Smoke test FAILED: expected output file missing: ${f}`);
        process.exit(1);
      }
    }
    console.log('Smoke test passed.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Smoke test FAILED with exception:', e);
    process.exit(1);
  });
