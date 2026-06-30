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

// Bedrock RP: textures/blocks/*.png, textures/items/*.png, textures/entity/**/*.png, textures/gui/**, textures/environment/**
function plan(ctx) {
  const { rp, assetsDir, modId, logger } = ctx;
  const tasks = [];
  if (!rp) return tasks;

  const texturesRoot = path.join(rp, 'textures');
  if (!fs.existsSync(texturesRoot)) return tasks;

  const files = walk(texturesRoot).filter((f) => /\.(png|tga)$/i.test(f));

  // Java resource pack convention: assets/<modid>/textures/<category>/<name>.png
  const categoryMap = [
    { match: /textures[\\/]+blocks?[\\/]/i, target: 'block' },
    { match: /textures[\\/]+items?[\\/]/i, target: 'item' },
    { match: /textures[\\/]+entity[\\/]/i, target: 'entity' },
    { match: /textures[\\/]+gui[\\/]/i, target: 'gui' },
    { match: /textures[\\/]+environment[\\/]/i, target: 'environment' },
    { match: /textures[\\/]+particle[\\/]/i, target: 'particle' }
  ];

  for (const file of files) {
    const rel = path.relative(texturesRoot, file);
    let target = 'misc';
    for (const c of categoryMap) {
      if (c.match.test(file)) {
        target = c.target;
        break;
      }
    }
    const subPath = path.relative(path.join(texturesRoot, target === 'misc' ? '' : guessOriginalFolder(target)), file);
    const destName = sanitizeName(path.basename(file));
    const dest = path.join(assetsDir, 'textures', target, path.dirname(subPath) === '.' ? '' : path.dirname(subPath), destName);

    tasks.push({
      label: `Copying Textures From ${rel} to assets/${modId}/textures/${target}/${destName}`,
      run: () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
        if (/\.tga$/i.test(file)) {
          logger.warn('textures', `TGA texture copied as-is, Java requires PNG: ${rel}`, 'Convert this file to PNG before building the jar.');
        } else {
          logger.ok('textures', `Texture converted: ${rel}`);
        }
      }
    });
  }

  return tasks;
}

function guessOriginalFolder(target) {
  const map = { block: 'blocks', item: 'items', entity: 'entity', gui: 'gui', environment: 'environment', particle: 'particle' };
  return map[target] || '';
}

function sanitizeName(name) {
  return name.toLowerCase().replace(/\.tga$/i, '.png').replace(/[^a-z0-9_.\-]/g, '_');
}

module.exports = { plan };
