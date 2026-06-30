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

function toClassName(name) {
  return name
    .split(/[_\-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') + 'Entity';
}

function plan(ctx) {
  const { bp, javaDir, pkg, modId, assetsDir, logger } = ctx;
  const tasks = [];
  if (!bp) return tasks;

  const entitiesRoot = path.join(bp, 'entities');
  if (!fs.existsSync(entitiesRoot)) return tasks;

  const files = fs.readdirSync(entitiesRoot).filter((f) => f.endsWith('.json'));
  const registryLines = [];
  const langEntries = {};
  let any = false;

  for (const file of files) {
    const src = path.join(entitiesRoot, file);

    tasks.push({
      label: `Converting Entity Definition From ${file} to Java entity stub`,
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
        const isSpawnable = root?.description?.is_spawnable;

        const entityJava = `package ${pkg}.entity;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.world.World;

/**
 * Converted from Bedrock entity "${identifier}".
 * This is a STARTING POINT ONLY. Bedrock behavior components describe AI/behavior in JSON
 * that has no direct Java equivalent - see conversion-log.md for the full component list,
 * and re-implement the relevant Goals / Attributes / Sensors here.
 */
public class ${className} extends PathAwareEntity {
\tpublic ${className}(EntityType<? extends PathAwareEntity> entityType, World world) {
\t\tsuper(entityType, world);
\t}

\t@Override
\tprotected void initGoals() {
\t\tsuper.initGoals();
\t\t// TODO: port goals from Bedrock components (minecraft:behavior.* entries) - see conversion-log.md
\t}
}
`;
        fs.mkdirSync(path.join(javaDir, 'entity'), { recursive: true });
        fs.writeFileSync(path.join(javaDir, 'entity', `${className}.java`), entityJava, 'utf8');

        registryLines.push(
          `\t\t// "${identifier}" - dimensions/spawn group are placeholders, review before use\n` +
            `\t\tRegistry.register(Registries.ENTITY_TYPE, Identifier.of(${JSON.stringify(modId)}, ${JSON.stringify(rawName)}),\n` +
            `\t\t\tEntityType.Builder.create(${className}::new, SpawnGroup.CREATURE)\n` +
            `\t\t\t\t.dimensions(0.6f, 1.8f).build()); // TODO: verify size/category from ${file}`
        );

        langEntries[`entity.${modId}.${rawName}`] = rawName
          .split('_')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');

        const componentGroups = root?.component_groups ? Object.keys(root.component_groups) : [];
        const components = root?.components ? Object.keys(root.components) : [];
        logger.needsReview(
          'entities',
          `Entity "${identifier}" behavior must be hand-ported to Java`,
          `File: ${file}\nis_spawnable: ${!!isSpawnable}\n` +
            `Components: ${components.join(', ') || '(none)'}\n` +
            `Component groups (event-triggered variants): ${componentGroups.join(', ') || '(none)'}\n` +
            `A Java stub class was generated at entity/${className}.java. AI behaviors, attacks, and movement ` +
            `need to be written as Goal subclasses; attributes need a createAttributes() EntityAttributes call.`
        );
        any = true;
      }
    });
  }

  tasks.push({
    label: 'Writing entity registry code (ModEntities.java)',
    run: () => {
      if (!any) return;
      const modEntitiesPath = path.join(javaDir, 'ModEntities.java');
      const content = `package ${pkg};

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
import ${pkg}.entity.*;

/** Generated entity-type registrations, converted from Bedrock entity JSON files. */
public class ModEntities {
\tpublic static void register() {
${registryLines.join('\n\n')}
\t}
}
`;
      fs.writeFileSync(modEntitiesPath, content, 'utf8');

      // wire it into the main mod class's onInitialize()
      const files = fs.readdirSync(javaDir).filter((f) => f.endsWith('.java') && f !== 'ModEntities.java' && f !== 'ModBlocks.java' && f !== 'ModItems.java');
      for (const f of files) {
        const p = path.join(javaDir, f);
        let c = fs.readFileSync(p, 'utf8');
        if (c.includes('ModItems.register();') && !c.includes('ModEntities.register();')) {
          c = c.replace('ModItems.register();', 'ModItems.register();\n\t\tModEntities.register();');
          fs.writeFileSync(p, c, 'utf8');
        }
      }

      const { mergeLang } = require('./blocks');
      mergeLang(assetsDir, langEntries);
      logger.ok('entities', `${registryLines.length} entity stub(s) generated - all flagged NEEDS_REVIEW for behavior porting`);
    }
  });

  return tasks;
}

module.exports = { plan };
