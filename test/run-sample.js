'use strict';
// Runs the conversion pipeline end-to-end against test/sample-addon (a plain folder)
// AND test/sample-addon.mcaddon (an archive with nested .mcpack files), verifying both
// input paths complete without throwing and without logging any ERROR entries.
// Used by .github/workflows/build.yml as a cross-platform sanity check.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { runConversion } = require('../lib/pipeline');
const { CATEGORY_ORDER } = require('../lib/featureMap');

const outputRoot = path.join(__dirname, 'output');
if (fs.existsSync(outputRoot)) fs.rmSync(outputRoot, { recursive: true, force: true });

async function runCase(label, addonPath, outDir) {
  console.log(`--- Smoke test case: ${label} ---`);
  const { counts } = await runConversion({
    addonPath,
    outDir,
    modId: 'rubymod',
    modName: 'Ruby Mod',
    modVersion: '1.0.0',
    authorName: 'CI',
    description: 'CI smoke test build',
    selectedCategories: CATEGORY_ORDER
  });

  if (counts.ERROR > 0) {
    throw new Error(`[${label}] FAILED: ${counts.ERROR} ERROR entries logged.`);
  }
  const mustExist = [
    path.join(outDir, 'build.gradle'),
    path.join(outDir, 'src', 'main', 'resources', 'fabric.mod.json'),
    path.join(outDir, 'conversion-log.md')
  ];
  for (const f of mustExist) {
    if (!fs.existsSync(f)) {
      throw new Error(`[${label}] FAILED: expected output file missing: ${f}`);
    }
  }
  console.log(`[${label}] passed.`);
}

async function runCliCase(label, args, outDir) {
  console.log(`--- Smoke test case: ${label} ---`);
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`[${label}] FAILED: cli.js exited with code ${result.status}`);
  }
  const mustExist = [
    path.join(outDir, 'build.gradle'),
    path.join(outDir, 'src', 'main', 'resources', 'fabric.mod.json'),
    path.join(outDir, 'conversion-log.md')
  ];
  for (const f of mustExist) {
    if (!fs.existsSync(f)) {
      throw new Error(`[${label}] FAILED: expected output file missing: ${f}`);
    }
  }
  console.log(`[${label}] passed.`);
}

(async () => {
  try {
    await runCase(
      'pipeline: folder input',
      path.join(__dirname, 'sample-addon'),
      path.join(outputRoot, 'rubymod-folder')
    );
    await runCase(
      'pipeline: mcaddon archive input',
      path.join(__dirname, 'sample-addon.mcaddon'),
      path.join(outputRoot, 'rubymod-mcaddon')
    );
    await runCliCase(
      'cli.js: non-interactive flags',
      [
        '--addon', path.join(__dirname, 'sample-addon.mcaddon'),
        '--out', path.join(outputRoot, 'rubymod-cli'),
        '--mod-id', 'rubymod',
        '--mod-name', 'Ruby Mod',
        '--mod-version', '1.0.0',
        '--author', 'CI',
        '--description', 'CI cli.js smoke test'
      ],
      path.join(outputRoot, 'rubymod-cli')
    );
    console.log('All smoke tests passed.');
    process.exit(0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
