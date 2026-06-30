'use strict';
const fs = require('fs');
const path = require('path');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(full));
    else results.push(full);
  }
  return results;
}

function plan(ctx) {
  const { rp, outDir, modId, logger } = ctx;
  const tasks = [];
  if (!rp) return tasks;

  const modelsRoot = path.join(rp, 'models');
  if (!fs.existsSync(modelsRoot)) return tasks;

  const files = walk(modelsRoot).filter((f) => f.endsWith('.json'));
  const refDir = path.join(outDir, 'bedrock_reference', 'models');

  for (const file of files) {
    const rel = path.relative(modelsRoot, file);
    const dest = path.join(refDir, rel);

    tasks.push({
      label: `Copying Geometry Reference From ${rel} to bedrock_reference/models/${rel}`,
      run: () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
        logger.needsReview(
          'models',
          `Bedrock geometry "${rel}" could not be auto-converted to a Java entity model`,
          `Bedrock's .geo.json cube/bone format is not compatible with Java's entity model code (ModelPart/EntityModel).\n` +
            `The original file was kept at bedrock_reference/models/${rel}.\n` +
            `Recommended path: open it in Blockbench and re-export using the "Java Block/Item" or "Modded Entity" format, ` +
            `or hand-write a Java ModelLayer for it.`
        );
      }
    });
  }

  return tasks;
}

module.exports = { plan };
