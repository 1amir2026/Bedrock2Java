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

function shortId(identifier) {
  // "mymod:ruby_block" -> { ns: "mymod", name: "ruby_block" }
  const [ns, name] = identifier.includes(':') ? identifier.split(':') : ['minecraft', identifier];
  return { ns, name };
}

function toFieldName(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function plan(ctx) {
  const { bp, assetsDir, dataDir, modId, javaDir, logger } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const blocksRoot = path.join(bp, 'blocks');
  if (!fs.existsSync(blocksRoot)) return tasks;

  const files = fs.readdirSync(blocksRoot).filter((f) => f.endsWith('.json'));
  const registryLines = [];
  const langEntries = {};

  for (const file of files) {
    const src = path.join(blocksRoot, file);

    tasks.push({
      label: `Converting Block Definition From ${file} to Java block + model + blockstate`,
      run: () => {
        const data = readJson(src);
        if (!data) {
          logger.error('blocks', `Could not parse block JSON: ${file}`);
          return;
        }
        const root = data['minecraft:block'] || data;
        const identifier = root?.description?.identifier || path.basename(file, '.json');
        const { name } = shortId(identifier);
        const field = toFieldName(name);

        // Blockstate (Java) - simple single-variant block pointing at a generated model
        const blockstate = {
          variants: { '': { model: `${modId}:block/${name}` } }
        };
        fs.mkdirSync(path.join(assetsDir, 'blockstates'), { recursive: true });
        fs.writeFileSync(
          path.join(assetsDir, 'blockstates', `${name}.json`),
          JSON.stringify(blockstate, null, 2)
        );

        // Block model - cube_all referencing a texture of the same name (placed by textures converter)
        const blockModel = { parent: 'minecraft:block/cube_all', textures: { all: `${modId}:block/${name}` } };
        fs.mkdirSync(path.join(assetsDir, 'models', 'block'), { recursive: true });
        fs.writeFileSync(
          path.join(assetsDir, 'models', 'block', `${name}.json`),
          JSON.stringify(blockModel, null, 2)
        );

        // Item model for the block (so it shows in inventory)
        const itemModel = { parent: `${modId}:block/${name}` };
        fs.mkdirSync(path.join(assetsDir, 'models', 'item'), { recursive: true });
        fs.writeFileSync(
          path.join(assetsDir, 'models', 'item', `${name}.json`),
          JSON.stringify(itemModel, null, 2)
        );

        // Loot table: drop itself (overridden later by the real loot table converter if present)
        fs.mkdirSync(path.join(dataDir, 'loot_table', 'blocks'), { recursive: true });
        const lootPath = path.join(dataDir, 'loot_table', 'blocks', `${name}.json`);
        if (!fs.existsSync(lootPath)) {
          fs.writeFileSync(
            lootPath,
            JSON.stringify(
              {
                type: 'minecraft:block',
                pools: [
                  { rolls: 1, entries: [{ type: 'minecraft:item', name: `${modId}:${name}` }] }
                ]
              },
              null,
              2
            )
          );
        }

        langEntries[`block.${modId}.${name}`] = toDisplayName(name);

        registryLines.push(
          `\t\tregister(${JSON.stringify(name)}, new Block(AbstractBlock.Settings.create().strength(2.0f, 6.0f))); // TODO: review hardness/resistance/material from ${file}`
        );

        const componentKeys = root?.components ? Object.keys(root.components) : [];
        if (componentKeys.length) {
          logger.needsReview(
            'blocks',
            `Block "${identifier}" has Bedrock components that need manual Java translation`,
            `File: ${file}\nComponents found: ${componentKeys.join(', ')}\n` +
              `These define Bedrock-specific behavior (collision, light emission, custom states, etc.) and must be re-implemented using Fabric's Block/BlockSettings API.`
          );
        } else {
          logger.ok('blocks', `Block "${identifier}" converted (model, blockstate, item model, loot table, lang, BlockItem, creative tab)`);
        }
      }
    });
  }

  tasks.push({
    label: 'Writing block registry code (ModBlocks.java)',
    run: () => {
      if (!registryLines.length) return;
      const modBlocksPath = path.join(javaDir, 'ModBlocks.java');
      if (fs.existsSync(modBlocksPath)) {
        let content = fs.readFileSync(modBlocksPath, 'utf8');
        content = content.replace(
          '// Converted blocks are registered here. See conversion-log.md for details.',
          registryLines.join('\n\n') + '\n\t\t// Converted blocks are registered here. See conversion-log.md for details.'
        );
        fs.writeFileSync(modBlocksPath, content, 'utf8');
      }
      // merge lang
      mergeLang(assetsDir, langEntries);
      logger.ok('blocks', `${registryLines.length} block registration(s) written to ModBlocks.java`);
    }
  });

  return tasks;
}

function toDisplayName(name) {
  return name
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function mergeLang(assetsDir, entries) {
  if (!Object.keys(entries).length) return;
  const langFile = path.join(assetsDir, 'lang', 'en_us.json');
  fs.mkdirSync(path.dirname(langFile), { recursive: true });
  let existing = {};
  if (fs.existsSync(langFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(langFile, 'utf8'));
    } catch (e) {
      existing = {};
    }
  }
  Object.assign(existing, entries);
  fs.writeFileSync(langFile, JSON.stringify(existing, null, 2), 'utf8');
}

module.exports = { plan, mergeLang, toDisplayName, shortId };
