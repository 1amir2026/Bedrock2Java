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

function toClassName(name) {
  return name
    .split(/[_\-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Item';
}

// Bedrock items have no dedicated "plays this sound" component (that's normally done via
// the scripting API), so we link an item to a custom sound by name: if the resource pack
// defines a sound event whose key is the item's own name, or is prefixed/suffixed with it
// (e.g. item "ruby_disc" <-> sound event "record.ruby_disc" or "ruby_disc.play"), treat it
// as intentional. This mirrors how most Bedrock add-ons name their custom sound events.
function findLinkedSound(itemName, soundEventMap) {
  if (!soundEventMap) return null;
  if (soundEventMap[itemName]) return soundEventMap[itemName];
  const candidates = Object.keys(soundEventMap);
  for (const key of candidates) {
    if (key === itemName) continue;
    const segments = key.split('.');
    if (segments.includes(itemName)) return soundEventMap[key];
  }
  for (const key of candidates) {
    if (key.startsWith(itemName + '_') || key.endsWith('_' + itemName) || key.includes(itemName)) {
      return soundEventMap[key];
    }
  }
  return null;
}

function plan(ctx) {
  const { bp, assetsDir, modId, javaDir, pkg, logger, soundEventMap } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const itemsRoot = path.join(bp, 'items');
  if (!fs.existsSync(itemsRoot)) return tasks;

  const files = fs.readdirSync(itemsRoot).filter((f) => f.endsWith('.json'));
  const registryLines = [];
  const langEntries = {};
  const customClassNames = [];

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
        const settingsExpr = isFood
          ? 'new Item.Settings().food(new FoodComponent.Builder().nutrition(4).saturationModifier(0.3f).build())'
          : 'new Item.Settings()';

        // Link the item to a custom sound event if the resource pack defines one that
        // matches this item's name (e.g. a music-disc-style item that should play a
        // custom sound). If found, generate a real Item subclass that plays it on use,
        // instead of a plain vanilla Item that would silently do nothing.
        const linkedSound = findLinkedSound(name, soundEventMap);
        let itemExpr = `new Item(${settingsExpr})`;

        if (linkedSound) {
          const className = toClassName(name);
          const itemJava = `package ${pkg}.item;

import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.sound.SoundCategory;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.world.World;
import ${pkg}.ModSounds;

/**
 * Converted from Bedrock item "${identifier}". A Resource Pack sound event
 * (${linkedSound.identifier}) was matched to this item by name and is played on use.
 * NEEDS_REVIEW: Bedrock has no built-in "item plays sound" component - this link was
 * inferred from naming, not from an explicit Bedrock definition. Verify the trigger is
 * right (use / place / hit / a scripting-API call) and adjust accordingly. If this is
 * meant to be a jukebox music disc, use a JukeboxSong + minecraft:jukeboxable component
 * instead of an on-use sound.
 */
public class ${className} extends Item {
\tpublic ${className}(Settings settings) {
\t\tsuper(settings);
\t}

\t@Override
\tpublic TypedActionResult<ItemStack> use(World world, PlayerEntity user, Hand hand) {
\t\tItemStack stack = user.getStackInHand(hand);
\t\tif (!world.isClient) {
\t\t\tworld.playSound(null, user.getBlockPos(), ModSounds.${linkedSound.javaConstant}, SoundCategory.RECORDS, 1.0f, 1.0f);
\t\t}
\t\treturn TypedActionResult.success(stack, world.isClient());
\t}
}
`;
          fs.mkdirSync(path.join(javaDir, 'item'), { recursive: true });
          fs.writeFileSync(path.join(javaDir, 'item', `${className}.java`), itemJava, 'utf8');
          customClassNames.push(className);
          itemExpr = `new ${className}(${settingsExpr})`;

          logger.needsReview(
            'items',
            `Item "${identifier}" was linked to sound event "${linkedSound.identifier}" by name-matching`,
            `File: ${file}\nA custom Item class was generated at item/${className}.java that plays this sound on use.\n` +
              `Confirm this matches the add-on's real trigger (right-click use, jukebox play, on-hit, etc.) and adjust.`
          );
        }

        registryLines.push(
          `\t\tregister(${JSON.stringify(name)}, ${itemExpr}); // TODO: review properties from ${file}`
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
        } else if (!linkedSound) {
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
        if (customClassNames.length && !content.includes(`import ${pkg}.item.*;`)) {
          content = content.replace(
            'import net.minecraft.util.Identifier;',
            `import net.minecraft.util.Identifier;\nimport ${pkg}.item.*;`
          );
        }
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
