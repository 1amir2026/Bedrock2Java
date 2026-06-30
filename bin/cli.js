#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ui = require('../lib/ui');
const { CATEGORY_ORDER, FEATURES } = require('../lib/featureMap');
const { runConversion } = require('../lib/pipeline');

const CATEGORY_INFO = {
  textures: { label: 'Textures', hint: 'block/item/entity/GUI/sky/environment - [auto]' },
  sounds: { label: 'Sounds & Music', hint: 'ambient/mob/block/item sounds - [auto]' },
  lang: { label: 'Localization / Translations', hint: '[auto]' },
  models: { label: 'Models / Entity Geometry', hint: 'kept as reference, rebuild in Blockbench - [partial]' },
  blocks: { label: 'Blocks', hint: 'custom blocks, building, furniture, doors, lighting - [auto]' },
  items: { label: 'Items', hint: 'tools, weapons, armor, food, utilities - [auto]' },
  recipes: { label: 'Recipes', hint: 'crafting/furnace/smithing/stonecutter/brewing - [auto/partial]' },
  loot_tables: { label: 'Loot Tables & Custom Drops', hint: '[auto]' },
  trading: { label: 'Trade Tables', hint: 'reference only - [partial]' },
  entities: { label: 'Entities', hint: 'mobs, animals, bosses, NPCs, pets, vehicles - [stub + manual AI]' },
  entity_ai: { label: 'Entity AI / Behaviors / Pathfinding', hint: '[manual]' },
  animations: { label: 'Animations & Animation Controllers', hint: '[manual]' },
  particles: { label: 'Particles & Visual Effects', hint: '[manual]' },
  commands: { label: 'Commands & Functions', hint: '[partial]' },
  worldgen: { label: 'World Generation', hint: 'structures, features, ores, biomes - [manual/partial]' },
  advancements: { label: 'Achievements / Advancements', hint: '[partial]' },
  scripting: { label: 'Scripting API / JavaScript Logic', hint: 'no Java equivalent - [manual]' },
  gameplay: { label: 'Gameplay Systems', hint: 'economy, survival, tech, combat, magic, progression - [manual]' },
  ui: { label: 'UI', hint: 'forms, boss bars, action bar, menus - [manual]' },
  player: { label: 'Player Abilities', hint: 'flying, dash, wall climb, double jump - [manual]' }
};

function countFeatures(category) {
  return FEATURES.filter((f) => f.category === category).length;
}

async function main() {
  if (process.argv.includes('--selftest')) {
    console.log('bedrock2java-cli OK');
    process.exit(0);
  }
  if (process.argv.includes('--version')) {
    console.log(require('../package.json').version);
    process.exit(0);
  }

  console.clear?.();
  ui.heading('Bedrock Add-On -> Java Mod Converter');
  console.log(ui.color.dim('Answers below: use Up/Down or PgUp/PgDown to move, Space to toggle, Enter to confirm.'));

  // 1. Bedrock add-on path
  const addonPath = await ui.textPrompt({
    question: 'Path to the Bedrock Add-On (folder containing the RP and/or BP):',
    validate: (v) => {
      if (!v) return 'A path is required.';
      if (!fs.existsSync(v)) return `Path does not exist: ${v}`;
      if (!fs.statSync(v).isDirectory()) return 'Path must be a directory.';
      return true;
    }
  });

  // 2. Output path
  const defaultModId = path
    .basename(addonPath)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'converted_addon';

  const outDir = await ui.textPrompt({
    question: 'Output folder for the generated Java mod project:',
    defaultValue: path.join(process.cwd(), 'output', defaultModId),
    validate: (v) => (v ? true : 'An output path is required.')
  });

  // 3. Mod metadata
  const modId = await ui.textPrompt({
    question: 'Mod ID (lowercase, no spaces, e.g. "my_addon"):',
    defaultValue: defaultModId,
    validate: (v) => (/^[a-z][a-z0-9_]*$/.test(v) ? true : 'Mod ID must be lowercase letters, numbers, and underscores, starting with a letter.')
  });

  const modName = await ui.textPrompt({
    question: 'Mod display name:',
    defaultValue: defaultModId
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' '),
    validate: (v) => (v ? true : 'A display name is required.')
  });

  const modVersion = await ui.textPrompt({
    question: 'Mod version:',
    defaultValue: '1.0.0',
    validate: (v) => (v ? true : 'A version is required.')
  });

  const authorName = await ui.textPrompt({
    question: 'Author name:',
    defaultValue: 'Unknown',
    validate: (v) => (v ? true : 'An author name is required.')
  });

  const description = await ui.textPrompt({
    question: 'Short mod description (optional):',
    defaultValue: `${modName} - converted from a Minecraft Bedrock Add-On`
  });

  // 4. Feature category selection
  const categoryOptions = CATEGORY_ORDER.map((cat) => ({
    label: `${CATEGORY_INFO[cat].label} (${countFeatures(cat)} features)`,
    hint: CATEGORY_INFO[cat].hint,
    value: cat
  }));

  const selectedCategories = await ui.selectPrompt({
    question: 'Which feature categories should be converted? (covers every feature in your list, grouped)',
    options: categoryOptions,
    multi: true,
    defaultChecked: true
  });

  if (selectedCategories.length === 0) {
    ui.err('No categories selected - nothing to convert. Exiting.');
    process.exit(1);
  }

  // 5. Confirm
  ui.heading('Review');
  console.log(`${ui.color.aqua('Add-on path:')}      ${addonPath}`);
  console.log(`${ui.color.aqua('Output path:')}      ${outDir}`);
  console.log(`${ui.color.aqua('Mod ID:')}           ${modId}`);
  console.log(`${ui.color.aqua('Mod name:')}         ${modName}`);
  console.log(`${ui.color.aqua('Version:')}          ${modVersion}`);
  console.log(`${ui.color.aqua('Author:')}           ${authorName}`);
  console.log(`${ui.color.aqua('Categories:')}       ${selectedCategories.length} of ${CATEGORY_ORDER.length} selected`);
  console.log('');

  const proceed = await ui.selectPrompt({
    question: 'Start the conversion?',
    options: [
      { label: 'Yes, start converting', value: true },
      { label: 'No, cancel', value: false }
    ],
    multi: false
  });

  if (!proceed) {
    ui.info('cancelled', 'Conversion cancelled by user.');
    process.exit(0);
  }

  await runConversion({
    addonPath,
    outDir,
    modId,
    modName,
    modVersion,
    authorName,
    description,
    selectedCategories
  });
}

main().catch((e) => {
  ui.err('Fatal error: ' + (e.stack || String(e)));
  process.exit(1);
});
