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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Bedrock sound event key (e.g. "record.ruby" or "mob.ruby_golem.idle") -> a safe Java
// SoundEvent path segment / sounds.json key / static field name.
function sanitizeEventKey(key) {
  return key
    .toLowerCase()
    .replace(/[:\\]/g, '.')
    .replace(/\//g, '.')
    .replace(/[^a-z0-9_.]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function toJavaConstant(eventKey) {
  return eventKey.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'SOUND';
}

function plan(ctx) {
  const { rp, assetsDir, javaDir, modId, logger } = ctx;
  const tasks = [];
  ctx.soundEventMap = ctx.soundEventMap || {};
  if (!rp) return tasks;

  const soundsRoot = path.join(rp, 'sounds');
  if (!fs.existsSync(soundsRoot)) return tasks;

  const audioFiles = walk(soundsRoot).filter((f) => /\.(ogg|wav|fsb)$/i.test(f));
  // relative path (no extension, forward slashes, lowercase) -> absolute source file
  const audioByRel = {};
  for (const f of audioFiles) {
    const rel = path.relative(soundsRoot, f).replace(/\\/g, '/').replace(/\.(ogg|wav|fsb)$/i, '').toLowerCase();
    audioByRel[rel] = f;
  }

  // event key -> [{ srcFile, relNoExt }]
  const eventGroups = {};

  tasks.push({
    label: 'Reading sound_definitions.json (Bedrock sound-event -> file mapping)',
    run: () => {
      const defsPath = path.join(soundsRoot, 'sound_definitions.json');
      const defs = fs.existsSync(defsPath) ? readJson(defsPath) : null;
      const table = defs && (defs.sound_definitions || defs);

      if (table && typeof table === 'object') {
        for (const [rawKey, def] of Object.entries(table)) {
          const eventKey = sanitizeEventKey(rawKey);
          const soundList = Array.isArray(def && def.sounds) ? def.sounds : [];
          const files = [];
          for (const s of soundList) {
            const soundName = typeof s === 'string' ? s : s && s.name;
            if (!soundName) continue;
            const relNoExt = soundName.replace(/^sounds[\\/]/i, '').replace(/\\/g, '/').replace(/\.(ogg|wav|fsb)$/i, '').toLowerCase();
            const srcFile = audioByRel[relNoExt];
            if (srcFile) files.push({ srcFile, relNoExt });
          }
          if (files.length) eventGroups[eventKey] = files;
        }
        logger.ok('sounds', `sound_definitions.json parsed: ${Object.keys(eventGroups).length} sound event(s) mapped to audio files`);
      }

      // Fallback: any audio file not covered by sound_definitions.json still becomes its
      // own sound event, keyed by its folder path (old file-path-based behavior), so
      // nothing is silently dropped even for add-ons that skip sound_definitions.json.
      const covered = new Set();
      for (const files of Object.values(eventGroups)) {
        for (const f of files) covered.add(f.relNoExt);
      }
      for (const [relNoExt, srcFile] of Object.entries(audioByRel)) {
        if (covered.has(relNoExt)) continue;
        const eventKey = sanitizeEventKey(relNoExt.replace(/\//g, '.'));
        eventGroups[eventKey] = eventGroups[eventKey] || [];
        eventGroups[eventKey].push({ srcFile, relNoExt });
      }

      if (!defs) {
        logger.info('sounds', 'No sound_definitions.json found - sound events inferred from file paths instead (still fully converted).');
      }
    }
  });

  const soundEntries = {};

  tasks.push({
    label: `Copying ${audioFiles.length} sound file(s) into assets/${modId}/sounds/`,
    run: () => {
      for (const [eventKey, files] of Object.entries(eventGroups)) {
        const javaSoundIds = [];
        for (const { srcFile, relNoExt } of files) {
          const isOgg = /\.ogg$/i.test(srcFile);
          const destRel = `${relNoExt}.ogg`;
          const dest = path.join(assetsDir, 'sounds', destRel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (isOgg) {
            fs.copyFileSync(srcFile, dest);
            javaSoundIds.push(`${modId}:${relNoExt}`);
          } else {
            fs.copyFileSync(srcFile, dest.replace(/\.ogg$/, path.extname(srcFile)));
            logger.needsReview(
              'sounds',
              `Sound needs transcoding to OGG (Java only supports .ogg): ${path.relative(soundsRoot, srcFile)}`,
              'Convert with e.g. ffmpeg -i input.wav output.ogg, place it at the path above, then this sound event will work as-is.'
            );
          }
        }
        if (javaSoundIds.length) soundEntries[`${modId}:${eventKey}`] = { sounds: javaSoundIds };
      }
      logger.ok('sounds', `${audioFiles.length} sound file(s) copied`);
    }
  });

  tasks.push({
    label: `Writing sounds.json for ${modId}`,
    run: () => {
      const dest = path.join(assetsDir, 'sounds.json');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // sounds.json is keyed by event name WITHOUT the "modid:" prefix
      const out = {};
      for (const [fullKey, def] of Object.entries(soundEntries)) {
        out[fullKey.split(':')[1]] = def;
      }
      fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
      logger.ok('sounds', 'sounds.json generated', Object.keys(out));
    }
  });

  tasks.push({
    label: 'Writing sound-event registration code (ModSounds.java)',
    run: () => {
      const eventKeys = Object.keys(soundEntries).map((k) => k.split(':')[1]);
      if (!eventKeys.length) return;

      const usedConstants = new Set();
      const fieldLines = [];
      for (const eventKey of eventKeys) {
        let constant = toJavaConstant(eventKey);
        let suffix = 2;
        while (usedConstants.has(constant)) constant = `${toJavaConstant(eventKey)}_${suffix++}`;
        usedConstants.add(constant);

        fieldLines.push(
          `\tpublic static final SoundEvent ${constant} = Registry.register(Registries.SOUND_EVENT,\n` +
            `\t\tIdentifier.of(${JSON.stringify(modId)}, ${JSON.stringify(eventKey)}),\n` +
            `\t\tSoundEvent.of(Identifier.of(${JSON.stringify(modId)}, ${JSON.stringify(eventKey)})));`
        );

        ctx.soundEventMap[eventKey] = {
          javaConstant: constant,
          identifier: `${modId}:${eventKey}`
        };
        // Also index by the raw Bedrock-style key with dots/underscores normalized both ways,
        // and by trailing segment (e.g. "idle" from "mob.ruby_golem.idle"), so entity/item
        // converters can find a match without needing to know our exact sanitization rules.
        ctx.soundEventMap[eventKey.replace(/\./g, '_')] = ctx.soundEventMap[eventKey];
        const lastSegment = eventKey.split('.').pop();
        if (lastSegment && !ctx.soundEventMap[lastSegment]) ctx.soundEventMap[lastSegment] = ctx.soundEventMap[eventKey];
      }

      const modSoundsPath = path.join(javaDir, 'ModSounds.java');
      const content = `package ${ctx.pkg};

import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.SoundEvent;
import net.minecraft.util.Identifier;

/** Generated sound-event registrations, converted from the Bedrock Resource Pack's sounds/. */
public class ModSounds {
${fieldLines.join('\n\n')}

\tpublic static void register() {
\t\t// Registration happens above via the static field initializers; this method just
\t\t// forces this class to load (and thus register everything) from onInitialize().
\t}
}
`;
      fs.writeFileSync(modSoundsPath, content, 'utf8');
      logger.ok('sounds', `${fieldLines.length} SoundEvent(s) registered in ModSounds.java`);
    }
  });

  return tasks;
}

module.exports = { plan, sanitizeEventKey, toJavaConstant };
