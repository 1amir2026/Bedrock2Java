'use strict';
const fs = require('fs');
const path = require('path');

function existsDir(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function findManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Heuristically locate RP and BP folders inside an add-on root.
// Supports: a folder containing both RP+BP subfolders, a folder that itself IS the RP or BP,
// or a folder containing multiple packs (picks first RP-looking / BP-looking dir).
function scanAddon(addonPath) {
  const result = { root: addonPath, rp: null, bp: null, packs: [] };

  if (!existsDir(addonPath)) {
    throw new Error(`Add-on path does not exist or is not a directory: ${addonPath}`);
  }

  const isRP = (dir) =>
    existsDir(path.join(dir, 'textures')) ||
    existsDir(path.join(dir, 'models')) ||
    existsDir(path.join(dir, 'sounds')) ||
    existsDir(path.join(dir, 'particles')) ||
    existsDir(path.join(dir, 'texts'));

  const isBP = (dir) =>
    existsDir(path.join(dir, 'entities')) ||
    existsDir(path.join(dir, 'items')) ||
    existsDir(path.join(dir, 'blocks')) ||
    existsDir(path.join(dir, 'recipes')) ||
    existsDir(path.join(dir, 'loot_tables')) ||
    existsDir(path.join(dir, 'functions')) ||
    existsDir(path.join(dir, 'scripts'));

  // Case 1: addonPath itself is RP or BP
  if (isRP(addonPath) && !isBP(addonPath)) result.rp = addonPath;
  if (isBP(addonPath) && !isRP(addonPath)) result.bp = addonPath;
  if (isRP(addonPath) && isBP(addonPath)) {
    // mixed single folder (uncommon but possible) - treat as both
    result.rp = addonPath;
    result.bp = addonPath;
  }

  // Case 2: addonPath contains subfolders that are RP/BP
  const children = fs.readdirSync(addonPath).filter((f) => existsDir(path.join(addonPath, f)));
  for (const child of children) {
    const full = path.join(addonPath, child);
    const manifest = findManifest(full);
    const looksRP = isRP(full) || /rp|resource/i.test(child);
    const looksBP = isBP(full) || /bp|behavior/i.test(child);

    if (manifest) {
      const types = (manifest.modules || []).map((m) => m.type);
      if (types.includes('resources') && !result.rp) result.rp = full;
      if ((types.includes('data') || types.includes('script')) && !result.bp) result.bp = full;
    }
    if (!result.rp && looksRP && isRP(full)) result.rp = full;
    if (!result.bp && looksBP && isBP(full)) result.bp = full;

    result.packs.push({ dir: full, manifest });
  }

  return result;
}

module.exports = { scanAddon, findManifest, existsDir };
