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

// category -> [{ base: 'rp'|'bp', subdir, note }]
const SOURCES = {
  animations: [
    { base: 'rp', subdir: 'animations', note: 'Bedrock keyframe animations have no Java mod equivalent; re-author with Java AnimationDefinition / Blockbench Java export.' },
    { base: 'rp', subdir: 'animation_controllers', note: 'Animation controllers (state machines) must be re-built as Java AnimationState logic.' }
  ],
  particles: [
    { base: 'rp', subdir: 'particles', note: 'Bedrock particle JSON format differs from Java ParticleType/ParticleEffect; recreate using Java\'s particle system.' }
  ],
  commands: [
    { base: 'bp', subdir: 'functions', note: 'Bedrock .mcfunction files are close to Java syntax but commands/selectors can differ; review each function file.' }
  ],
  trading: [
    { base: 'bp', subdir: 'trading', note: 'Bedrock trade tables use a different schema than Java villager trades; port manually to TradeOffers.Factory.' }
  ],
  worldgen: [
    { base: 'bp', subdir: 'features', note: 'Bedrock world-gen features must be re-implemented as Java Feature/ConfiguredFeature + datapack worldgen JSON.' },
    { base: 'bp', subdir: 'feature_rules', note: 'Feature placement rules need a Java PlacedFeature equivalent.' },
    { base: 'bp', subdir: 'structures', note: 'Bedrock .mcstructure files are not compatible with Java .nbt structures; re-export/rebuild the structure for Java.' },
    { base: 'bp', subdir: 'spawn_rules', note: 'Spawn rules need a Java SpawnPlacementType / biome modifier equivalent.' }
  ],
  scripting: [
    { base: 'bp', subdir: 'scripts', note: 'Bedrock\'s JavaScript Scripting API has NO equivalent in a Java mod - this logic must be rewritten from scratch in Java using Fabric API event callbacks.' }
  ]
};

// Categories that are pure game-design concepts with no Bedrock source files to scan -
// logged once each, so the report still documents that they were considered.
const CONCEPTUAL_ONLY = {
  gameplay: 'High-level gameplay/economy/survival systems are design-layer features built from many small pieces (items, commands, scripting, data storage). There is no single Bedrock source file to convert - re-implement as Java game logic using the converted blocks/items as a base.',
  ui: 'Bedrock\'s Forms API / action bar / boss bar UI calls live inside scripts and have no static file to convert; re-implement with Fabric\'s Screen/HudRenderCallback/BossBar APIs.',
  player: 'Custom player abilities (flight, dash, wall climb, etc.) are implemented via Bedrock scripting and have no static file to convert; re-implement using Fabric player tick events / attributes.',
  entity_ai: 'Bedrock entity AI/behavior lives inside each entity\'s component JSON and was already flagged per-entity by the entity converter above.',
  advancements: 'Bedrock has no direct advancement system; if the add-on used scoreboard-based "achievements", re-implement using Java\'s data-driven advancements.'
};

function plan(ctx) {
  const { rp, bp, outDir, modId, logger, selectedCategories } = ctx;
  const tasks = [];
  const refRoot = path.join(outDir, 'bedrock_reference');

  for (const [category, sources] of Object.entries(SOURCES)) {
    if (!selectedCategories.includes(category)) continue;
    for (const s of sources) {
      const base = s.base === 'rp' ? rp : bp;
      if (!base) continue;
      const dir = path.join(base, s.subdir);
      const files = walk(dir);
      for (const file of files) {
        const rel = path.relative(base, file);
        const dest = path.join(refRoot, rel);
        tasks.push({
          label: `Archiving ${s.subdir} reference From ${rel} to bedrock_reference/${rel}`,
          run: () => {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(file, dest);
            logger.needsReview(category, `"${rel}" has no automatic Java conversion`, s.note);
          }
        });
      }
    }
  }

  for (const [category, note] of Object.entries(CONCEPTUAL_ONLY)) {
    if (!selectedCategories.includes(category)) continue;
    tasks.push({
      label: `Logging coverage note for ${category}`,
      run: () => logger.needsReview(category, `"${category}" requires manual Java implementation`, note)
    });
  }

  return tasks;
}

module.exports = { plan };
