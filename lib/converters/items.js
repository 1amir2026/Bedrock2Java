'use strict';
const fs = require('fs');
const path = require('path');
const { mergeLang, toDisplayName, shortId } = require('./blocks');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function plan(ctx) {
  const { bp, assetsDir, modId, javaDir, logger } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const itemsRoot = path.join(bp, 'items');
  if (!fs.existsSync(itemsRoot)) return tasks;

  const files = fs.readdirSync(itemsRoot).filter((f) => f.endsWith('.json'));
  const registryLines = [];
  const langEntries = {};

  for (const file of files) {
    const src = path.join(itemsRoot, file);

    tasks.push({
      label: `Converting Item Definition From ${file} to Java item + model`,
      run: () => {
        const data = readJson(src);
        if (!data) {
          logger.error('items', `Could not parse item JSON: ${file}`);
          return;
        }
        const root = data['minecraft:item'] || data;
        const identifier = root?.description?.identifier || path.basename(file, '.json');
        const { name } = shortId(identifier);

        const itemModel = {
          parent: 'minecraft:item/generated',
          textures: { layer0: `${modId}:item/${name}` }
        };
        fs.mkdirSync(path.join(assetsDir, 'models', 'item'), { recursive: true });
        fs.writeFileSync(path.join(assetsDir, 'models', 'item', `${name}.json`), JSON.stringify(itemModel, null, 2));

        langEntries[`item.${modId}.${name}`] = toDisplayName(name);

        const isFood = !!(root?.components && (root.components['minecraft:food'] || root.components['minecraft:foodValues']));
        const settings = isFood
          ? 'new Item.Settings().food(new FoodComponent.Builder().nutrition(4).saturationModifier(0.3f).build())'
          : 'new Item.Settings()';

        registryLines.push(
          `\t\tRegistry.register(Registries.ITEM, Identifier.of(${JSON.stringify(modId)}, ${JSON.stringify(name)}),\n` +
            `\t\t\tnew Item(${settings})); // TODO: review properties from ${file}`
        );

        const componentKeys = root?.components ? Object.keys(root.components) : [];
        const relevant = componentKeys.filter((k) => !['minecraft:food', 'minecraft:foodValues', 'minecraft:icon', 'minecraft:display_name'].includes(k));
        if (relevant.length) {
          logger.needsReview(
            'items',
            `Item "${identifier}" has Bedrock components that need manual Java translation`,
            `File: ${file}\nComponents found: ${relevant.join(', ')}\n` +
              `Map these to Fabric Item subclasses / DataComponents (durability, enchantability, weapon damage, tool tags, etc.).`
          );
        } else {
          logger.ok('items', `Item "${identifier}" converted (model, lang, registration)`);
        }
      }
    });
  }

  tasks.push({
    label: 'Writing item registry code (ModItems.java)',
    run: () => {
      if (!registryLines.length) return;
      const modItemsPath = path.join(javaDir, 'ModItems.java');
      if (fs.existsSync(modItemsPath)) {
        let content = fs.readFileSync(modItemsPath, 'utf8');
        content = content.replace(
          '// Converted items are registered here. See conversion-log.md for details.',
          registryLines.join('\n\n') + '\n\t\t// Converted items are registered here. See conversion-log.md for details.'
        );
        fs.writeFileSync(modItemsPath, content, 'utf8');
      }
      mergeLang(assetsDir, langEntries);
      logger.ok('items', `${registryLines.length} item registration(s) written to ModItems.java`);
    }
  });

  return tasks;
}

module.exports = { plan };
