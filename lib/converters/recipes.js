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

function bedrockItemToJava(modId, itemRef) {
  if (!itemRef) return null;
  const id = typeof itemRef === 'string' ? itemRef : itemRef.item;
  if (!id) return null;
  if (id.startsWith('minecraft:')) return id; // vanilla items pass through
  const [, name] = id.includes(':') ? id.split(':') : [modId, id];
  return `${modId}:${name}`;
}

function plan(ctx) {
  const { bp, dataDir, modId, logger } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const recipesRoot = path.join(bp, 'recipes');
  if (!fs.existsSync(recipesRoot)) return tasks;

  const files = fs.readdirSync(recipesRoot).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const src = path.join(recipesRoot, file);

    tasks.push({
      label: `Converting Recipe From ${file} to data/${modId}/recipe/`,
      run: () => {
        const data = readJson(src);
        if (!data) {
          logger.error('recipes', `Could not parse recipe JSON: ${file}`);
          return;
        }
        const key = Object.keys(data).find((k) => k.startsWith('minecraft:recipe_'));
        if (!key) {
          logger.needsReview('recipes', `Unrecognized recipe format: ${file}`, 'Not a standard minecraft:recipe_* root key.');
          return;
        }
        const root = data[key];
        const identifier = root?.description?.identifier || path.basename(file, '.json');
        const [, name] = identifier.includes(':') ? identifier.split(':') : [modId, identifier];

        let javaRecipe = null;

        if (key === 'minecraft:recipe_shaped') {
          const keyMap = {};
          for (const [k, v] of Object.entries(root.key || {})) {
            const item = bedrockItemToJava(modId, v);
            if (item) keyMap[k] = { item };
          }
          javaRecipe = {
            type: 'minecraft:crafting_shaped',
            pattern: root.pattern,
            key: keyMap,
            result: { id: bedrockItemToJava(modId, root.result), count: root.result?.count || 1 }
          };
        } else if (key === 'minecraft:recipe_shapeless') {
          const ingredients = (root.ingredients || []).map((i) => ({ item: bedrockItemToJava(modId, i) }));
          javaRecipe = {
            type: 'minecraft:crafting_shapeless',
            ingredients,
            result: { id: bedrockItemToJava(modId, root.result), count: root.result?.count || 1 }
          };
        } else if (key === 'minecraft:recipe_furnace') {
          javaRecipe = {
            type: 'minecraft:smelting',
            ingredient: { item: bedrockItemToJava(modId, { item: root.input?.item || root.input }) },
            result: bedrockItemToJava(modId, root.output),
            experience: 0.1,
            cookingtime: 200
          };
        } else {
          logger.needsReview(
            'recipes',
            `Recipe type "${key}" requires manual review: ${file}`,
            `Bedrock recipe type "${key}" (e.g. smithing/stonecutter/brewing) has a different Java structure; map it by hand using the Java data-driven recipe format.`
          );
          return;
        }

        const destDir = path.join(dataDir, 'recipe');
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, `${name}.json`), JSON.stringify(javaRecipe, null, 2));
        logger.ok('recipes', `Recipe "${identifier}" converted (${key} -> ${javaRecipe.type})`);
      }
    });
  }

  return tasks;
}

module.exports = { plan };
