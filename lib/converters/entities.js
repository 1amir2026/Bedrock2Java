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
    else results.push(full);
  }
  return results;
}

function toClassName(name) {
  return name
    .split(/[_\-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Entity';
}

// Bedrock's Resource Pack entity file (RP/entity/<name>.json, root "minecraft:client_entity")
// carries the ambient/hurt/death sound-event mapping - the Behavior Pack file never has it.
// Build identifier -> sound_effects map so it can be cross-referenced with ModSounds.
function buildRpSoundEffectsMap(rp) {
  const map = {};
  if (!rp) return map;
  const rpEntityRoot = path.join(rp, 'entity');
  for (const file of walk(rpEntityRoot).filter((f) => f.endsWith('.json'))) {
    const data = readJson(file);
    const desc = data && data['minecraft:client_entity'] && data['minecraft:client_entity'].description;
    if (!desc || !desc.identifier) continue;
    if (desc.sound_effects) map[desc.identifier] = desc.sound_effects;
  }
  return map;
}

function plan(ctx) {
  const { bp, rp, javaDir, clientDir, pkg, modId, assetsDir, logger, soundEventMap } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const entitiesRoot = path.join(bp, 'entities');
  if (!fs.existsSync(entitiesRoot)) return tasks;

  const files = fs.readdirSync(entitiesRoot).filter((f) => f.endsWith('.json'));
  const entityFieldLines = [];
  const registerBodyLines = [];
  const rendererImportClasses = [];
  const clientRegisterLines = [];
  const langEntries = {};
  let any = false;

  tasks.push({
    label: 'Reading RP entity sound_effects (ambient/hurt/death sound links)',
    run: () => {
      ctx._rpSoundEffects = buildRpSoundEffectsMap(rp);
    }
  });

  for (const file of files) {
    const src = path.join(entitiesRoot, file);

    tasks.push({
      label: `Converting Entity Definition From ${file} to Java entity + attributes + renderer + spawn egg`,
      run: () => {
        const data = readJson(src);
        if (!data) {
          logger.error('entities', `Could not parse entity JSON: ${file}`);
          return;
        }
        const root = data['minecraft:entity'] || data;
        const identifier = root?.description?.identifier || path.basename(file, '.json');
        const [, rawName] = identifier.includes(':') ? identifier.split(':') : [modId, identifier];
        const className = toClassName(rawName);
        const rendererClassName = className + 'Renderer';
        const fieldName = rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const attrMethodName = `create${className}Attributes`;
        const isSpawnable = !!root?.description?.is_spawnable;

        // Resolve ambient/hurt/death sounds via the RP entity file + ModSounds, if present.
        const soundEffects = (ctx._rpSoundEffects && ctx._rpSoundEffects[identifier]) || null;
        const resolveSound = (bedrockEventKey) => {
          if (!bedrockEventKey || !soundEventMap) return null;
          return soundEventMap[bedrockEventKey] || soundEventMap[bedrockEventKey.toLowerCase()] || null;
        };
        const ambient = resolveSound(soundEffects && soundEffects.ambient);
        const hurt = resolveSound(soundEffects && soundEffects.hurt);
        const death = resolveSound(soundEffects && soundEffects.death);

        const soundOverrides = [];
        if (ambient) {
          soundOverrides.push(`\t@Override\n\tprotected SoundEvent getAmbientSound() {\n\t\treturn ModSounds.${ambient.javaConstant};\n\t}`);
        }
        if (hurt) {
          soundOverrides.push(`\t@Override\n\tpublic SoundEvent getHurtSound(DamageSource source) {\n\t\treturn ModSounds.${hurt.javaConstant};\n\t}`);
        }
        if (death) {
          soundOverrides.push(`\t@Override\n\tpublic SoundEvent getDeathSound() {\n\t\treturn ModSounds.${death.javaConstant};\n\t}`);
        }
        const soundImports = soundOverrides.length
          ? `\nimport net.minecraft.sound.SoundEvent;\nimport net.minecraft.entity.damage.DamageSource;\nimport ${pkg}.ModSounds;`
          : '';

        const entityJava = `package ${pkg}.entity;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.world.World;${soundImports}

/**
 * Converted from Bedrock entity "${identifier}".
 * This is a STARTING POINT ONLY. Bedrock behavior components describe AI/behavior in JSON
 * that has no direct Java equivalent - see conversion-log.md for the full component list,
 * and re-implement the relevant Goals / Attributes / Sensors here.
 * Base attribute values below (health/speed) are placeholders - review against the
 * Bedrock component_groups (e.g. minecraft:health, minecraft:movement) in ${file}.
 */
public class ${className} extends PathAwareEntity {
\tpublic ${className}(EntityType<? extends PathAwareEntity> entityType, World world) {
\t\tsuper(entityType, world);
\t}

\tpublic static DefaultAttributeContainer.Builder ${attrMethodName}() {
\t\treturn MobEntity.createMobAttributes()
\t\t\t.add(EntityAttributes.GENERIC_MAX_HEALTH, 20.0)
\t\t\t.add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.25)
\t\t\t.add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 2.0); // TODO: verify against ${file}
\t}

\t@Override
\tprotected void initGoals() {
\t\tsuper.initGoals();
\t\t// TODO: port goals from Bedrock components (minecraft:behavior.* entries) - see conversion-log.md
\t}
${soundOverrides.length ? '\n' + soundOverrides.join('\n\n') + '\n' : ''}}
`;
        fs.mkdirSync(path.join(javaDir, 'entity'), { recursive: true });
        fs.writeFileSync(path.join(javaDir, 'entity', `${className}.java`), entityJava, 'utf8');

        // Minimal renderer: registers cleanly and will NOT crash the client on spawn, but
        // renders nothing visible until a real model/texture is wired in - Bedrock's
        // .geo.json geometry format has no direct Java EntityModel equivalent (see the
        // models converter's NEEDS_REVIEW entries), so this can't be auto-generated.
        const rendererJava = `package ${pkg}.entity;

import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.util.Identifier;

/**
 * NEEDS_REVIEW: placeholder renderer for "${identifier}" so the entity doesn't crash the
 * client on spawn. It currently renders nothing. Bedrock's geometry (.geo.json) has no
 * direct Java model equivalent - rebuild the model in Blockbench (Java Modded Entity
 * format) or hand-write an EntityModel, then replace getTexture()/render this properly.
 */
public class ${rendererClassName} extends EntityRenderer<${className}> {
\tpublic ${rendererClassName}(EntityRendererFactory.Context ctx) {
\t\tsuper(ctx);
\t}

\t@Override
\tpublic Identifier getTexture(${className} entity) {
\t\treturn null; // TODO: point at assets/${modId}/textures/entity/${rawName}.png once a real model exists
\t}
}
`;
        fs.writeFileSync(path.join(javaDir, 'entity', `${rendererClassName}.java`), rendererJava, 'utf8');

        entityFieldLines.push(
          `\t// "${identifier}" - dimensions/spawn group are placeholders, review before use\n` +
            `\tpublic static final EntityType<${className}> ${fieldName} = Registry.register(Registries.ENTITY_TYPE,\n` +
            `\t\tIdentifier.of(${JSON.stringify(modId)}, ${JSON.stringify(rawName)}),\n` +
            `\t\tEntityType.Builder.create(${className}::new, SpawnGroup.CREATURE)\n` +
            `\t\t\t.dimensions(0.6f, 1.8f).build()); // TODO: verify size/category from ${file}`
        );

        registerBodyLines.push(
          `\t\tFabricDefaultAttributeRegistry.register(${fieldName}, ${className}.${attrMethodName}());`
        );

        if (isSpawnable) {
          registerBodyLines.push(
            `\t\tItem ${fieldName.toLowerCase()}SpawnEgg = Registry.register(Registries.ITEM,\n` +
              `\t\t\tIdentifier.of(${JSON.stringify(modId)}, ${JSON.stringify(rawName + '_spawn_egg')}),\n` +
              `\t\t\tnew SpawnEggItem(${fieldName}, new Item.Settings()));\n` +
              `\t\tModItemGroup.ITEMS.add(${fieldName.toLowerCase()}SpawnEgg);`
          );
          langEntries[`item.${modId}.${rawName}_spawn_egg`] = rawName
            .split('_')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ') + ' Spawn Egg';
        }

        clientRegisterLines.push(
          `\t\tEntityRendererRegistry.register(${pkg}.ModEntities.${fieldName}, ${pkg}.entity.${rendererClassName}::new);`
        );
        rendererImportClasses.push(className);

        langEntries[`entity.${modId}.${rawName}`] = rawName
          .split('_')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');

        const componentGroups = root?.component_groups ? Object.keys(root.component_groups) : [];
        const components = root?.components ? Object.keys(root.components) : [];
        logger.needsReview(
          'entities',
          `Entity "${identifier}" behavior must be hand-ported to Java`,
          `File: ${file}\nis_spawnable: ${isSpawnable}\n` +
            `Components: ${components.join(', ') || '(none)'}\n` +
            `Component groups (event-triggered variants): ${componentGroups.join(', ') || '(none)'}\n` +
            `Ambient/hurt/death sounds: ${[ambient && 'ambient', hurt && 'hurt', death && 'death'].filter(Boolean).join(', ') || '(none matched)'}\n` +
            `A Java stub class, a crash-safe placeholder renderer, default attributes, and (if spawnable) a spawn egg ` +
            `were generated. AI behaviors, attacks, and movement still need to be written as Goal subclasses.`
        );
        any = true;
      }
    });
  }

  tasks.push({
    label: 'Writing entity registry code (ModEntities.java) + wiring renderers/attributes/spawn eggs',
    run: () => {
      if (!any) return;
      const modEntitiesPath = path.join(javaDir, 'ModEntities.java');
      const content = `package ${pkg};

import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.item.Item;
import net.minecraft.item.SpawnEggItem;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
import ${pkg}.entity.*;

/** Generated entity-type registrations, converted from Bedrock entity JSON files. */
public class ModEntities {
${entityFieldLines.join('\n\n')}

\tpublic static void register() {
${registerBodyLines.join('\n')}
\t}
}
`;
      fs.writeFileSync(modEntitiesPath, content, 'utf8');

      // wire ModEntities.register() into the main mod class's onInitialize()
      const files = fs.readdirSync(javaDir).filter((f) => f.endsWith('.java') && !['ModEntities.java', 'ModBlocks.java', 'ModItems.java', 'ModSounds.java', 'ModItemGroup.java'].includes(f));
      for (const f of files) {
        const p = path.join(javaDir, f);
        let c = fs.readFileSync(p, 'utf8');
        if (c.includes('ModItems.register();') && !c.includes('ModEntities.register();')) {
          c = c.replace('ModItems.register();', 'ModItems.register();\n\t\tModEntities.register();');
          fs.writeFileSync(p, c, 'utf8');
        }
      }

      // wire renderer registrations into the client entry point
      if (clientDir) {
        const modClientPath = path.join(clientDir, 'ModClient.java');
        if (fs.existsSync(modClientPath)) {
          let c = fs.readFileSync(modClientPath, 'utf8');
          if (!c.includes('import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;')) {
            c = c.replace(
              'import net.fabricmc.api.ClientModInitializer;',
              'import net.fabricmc.api.ClientModInitializer;\nimport net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;'
            );
          }
          c = c.replace(
            '// Converted entity renderers are registered here. See conversion-log.md for details.',
            clientRegisterLines.join('\n') + '\n\t\t// Converted entity renderers are registered here. See conversion-log.md for details.'
          );
          fs.writeFileSync(modClientPath, c, 'utf8');
        }
      }

      const { mergeLang } = require('./blocks');
      mergeLang(assetsDir, langEntries);
      logger.ok('entities', `${entityFieldLines.length} entity registered (attributes + placeholder renderer + spawn egg where spawnable) - AI/behavior still flagged NEEDS_REVIEW`);
    }
  });

  return tasks;
}

module.exports = { plan };
