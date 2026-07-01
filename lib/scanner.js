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

const isRP = (dir) =>
  existsDir(path.join(dir, 'textures')) ||
  existsDir(path.join(dir, 'models')) ||
  existsDir(path.join(dir, 'sounds')) ||
  existsDir(path.join(dir, 'particles')) ||
  existsDir(path.join(dir, 'texts')) ||
  existsDir(path.join(dir, 'ui'));

const isBP = (dir) =>
  existsDir(path.join(dir, 'entities')) ||
  existsDir(path.join(dir, 'items')) ||
  existsDir(path.join(dir, 'blocks')) ||
  existsDir(path.join(dir, 'recipes')) ||
  existsDir(path.join(dir, 'loot_tables')) ||
  existsDir(path.join(dir, 'functions')) ||
  existsDir(path.join(dir, 'scripts')) ||
  existsDir(path.join(dir, 'spawn_rules')) ||
  existsDir(path.join(dir, 'trading'));

// Standard internal RP/BP subfolder names - these are never pack roots themselves
// (e.g. "textures/items" is a texture category, not a Behavior Pack's "items" folder).
// Directories with these names are skipped as pack *candidates* but we still recurse
// past other folder names when looking for nested packs, since Bedrock's own layout is
// often "resource_packs/<PackName>/textures/..." - "resource_packs" itself isn't a pack,
// and isn't one of these internal names either, so it gets searched normally.
const INTERNAL_SUBFOLDER_NAMES = new Set([
  'textures', 'sounds', 'texts', 'models', 'particles', 'animations', 'animation_controllers',
  'entities', 'items', 'blocks', 'recipes', 'loot_tables', 'functions', 'scripts', 'trading',
  'structures', 'feature_rules', 'features', 'spawn_rules', 'gui', 'entity', 'environment',
  'block', 'item', 'font', 'material', 'attachables', 'render_controllers'
]);

const SKIP_DIR_NAMES = new Set(['.git', '.svn', 'node_modules', '__macosx']);

const MAX_DEPTH = 8;

// Recursively walks `dir`, classifying every directory it finds as RP, BP, both, or
// neither, and collecting the first RP and first BP found (by manifest.json priority,
// then by folder-content heuristic). Stops descending once a directory is classified
// as a pack, since its own internal subfolders aren't separate packs.
function walk(dir, depth, result, seen) {
  if (depth > MAX_DEPTH) return;
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (e) {
    return;
  }
  if (seen.has(real)) return; // guard against symlink loops
  seen.add(real);

  const manifest = findManifest(dir);
  const rp = isRP(dir);
  const bp = isBP(dir);

  let classified = false;

  if (manifest) {
    const types = (manifest.modules || []).map((m) => m.type);
    if (types.includes('resources')) {
      if (!result.rp) result.rp = dir;
      classified = true;
    }
    if (types.includes('data') || types.includes('script')) {
      if (!result.bp) result.bp = dir;
      classified = true;
    }
  }

  if (!classified && rp && !bp) {
    if (!result.rp) result.rp = dir;
    classified = true;
  }
  if (!classified && bp && !rp) {
    if (!result.bp) result.bp = dir;
    classified = true;
  }
  if (!classified && rp && bp) {
    // mixed single folder (uncommon but possible) - treat as both
    if (!result.rp) result.rp = dir;
    if (!result.bp) result.bp = dir;
    classified = true;
  }

  if (manifest || rp || bp) {
    result.packs.push({ dir, manifest });
  }

  if (classified) return; // don't search inside an already-identified pack

  // Not (yet) classified as a pack - recurse into subdirectories looking for one,
  // e.g. a "resource_packs" or "behavior_packs" wrapper folder, or an add-on root
  // that contains multiple named pack folders.
  let children;
  try {
    children = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }

  for (const entry of children) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
    if (INTERNAL_SUBFOLDER_NAMES.has(entry.name.toLowerCase())) continue; // never a pack candidate itself
    if (result.rp && result.bp) return; // found everything we need
    walk(path.join(dir, entry.name), depth + 1, result, seen);
  }
}

// Locates RP and BP folders anywhere inside an add-on root, at any nesting depth.
// Supports: a folder that itself IS the RP or BP; a folder containing RP/BP subfolders
// directly; Bedrock's own "resource_packs/<PackName>/" + "behavior_packs/<PackName>/"
// wrapper layout; a folder containing multiple named pack folders; and combinations
// of the above nested a few levels deep (e.g. inside an extracted .mcaddon).
function scanAddon(addonPath) {
  if (!existsDir(addonPath)) {
    throw new Error(`Add-on path does not exist or is not a directory: ${addonPath}`);
  }

  const result = { root: addonPath, rp: null, bp: null, packs: [] };
  walk(addonPath, 0, result, new Set());
  return result;
}

module.exports = { scanAddon, findManifest, existsDir };
