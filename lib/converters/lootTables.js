'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(full));
    else if (entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

function convertPool(pool, modId) {
  return {
    rolls: typeof pool.rolls === 'number' ? pool.rolls : 1,
    entries: (pool.entries || []).map((e) => convertEntry(e, modId))
  };
}

function convertEntry(entry, modId) {
  const name = entry.name || '';
  const id = name.startsWith('minecraft:') ? name : `${modId}:${name.replace(/^.*:/, '')}`;
  const out = { type: 'minecraft:item', name: id };
  if (entry.weight) out.weight = entry.weight;
  if (Array.isArray(entry.functions) && entry.functions.length) {
    out.functions = entry.functions.map((f) => ({ function: 'minecraft:set_count', __note: 'reviewed-from-bedrock-function', original: f }));
  }
  return out;
}

function plan(ctx) {
  const { bp, dataDir, modId, logger } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const lootRoot = path.join(bp, 'loot_tables');
  if (!fs.existsSync(lootRoot)) return tasks;

  const files = walk(lootRoot);

  for (const file of files) {
    const rel = path.relative(lootRoot, file);

    tasks.push({
      label: `Converting Loot Table From ${rel} to data/${modId}/loot_table/${rel}`,
      run: () => {
        const data = readJson(file);
        if (!data || !Array.isArray(data.pools)) {
          logger.needsReview('loot_tables', `Could not interpret loot table: ${rel}`, 'Unexpected structure - convert by hand using Java loot table format.');
          return;
        }
        const javaTable = {
          type: rel.includes('entities') ? 'minecraft:entity' : 'minecraft:block',
          pools: data.pools.map((p) => convertPool(p, modId))
        };
        const dest = path.join(dataDir, 'loot_table', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(javaTable, null, 2));
        logger.ok('loot_tables', `Loot table converted: ${rel}`);
        logger.warn(
          'loot_tables',
          `Loot functions in "${rel}" were preserved as references only`,
          'Bedrock loot functions (set_data, looting_enchant, etc.) need to be re-mapped to Java loot functions by hand.'
        );
      }
    });
  }

  return tasks;
}

module.exports = { plan };
