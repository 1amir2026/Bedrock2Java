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

function plan(ctx) {
  const { rp, assetsDir, modId, logger } = ctx;
  const tasks = [];
  if (!rp) return tasks;

  const soundsRoot = path.join(rp, 'sounds');
  if (!fs.existsSync(soundsRoot)) return tasks;

  const files = walk(soundsRoot).filter((f) => /\.(ogg|wav|fsb)$/i.test(f));
  const soundEntries = {};

  for (const file of files) {
    const rel = path.relative(soundsRoot, file);
    const isOgg = /\.ogg$/i.test(file);
    const eventKey = rel
      .replace(/\.(ogg|wav|fsb)$/i, '')
      .replace(/[\\/]/g, '.')
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, '_');
    const destRel = rel.replace(/\.(wav|fsb)$/i, '.ogg').replace(/\\/g, '/');
    const dest = path.join(assetsDir, 'sounds', destRel);

    tasks.push({
      label: `Copying Sounds From ${rel} to assets/${modId}/sounds/${destRel}`,
      run: () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (isOgg) {
          fs.copyFileSync(file, dest);
          logger.ok('sounds', `Sound copied: ${rel}`);
          soundEntries[`${modId}.${eventKey}`] = {
            sounds: [`${modId}:${destRel.replace(/\.ogg$/, '')}`]
          };
        } else {
          // Can't transcode WAV/FSB to OGG without an audio library (no network access for one here).
          fs.copyFileSync(file, dest.replace(/\.ogg$/, path.extname(file)));
          logger.needsReview(
            'sounds',
            `Sound needs transcoding to OGG (Java only supports .ogg): ${rel}`,
            'Convert with e.g. ffmpeg -i input.wav output.ogg, then place it at the path above and add a sounds.json entry.'
          );
        }
      }
    });
  }

  tasks.push({
    label: `Writing sounds.json for ${modId}`,
    run: () => {
      const dest = path.join(assetsDir, 'sounds.json');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, JSON.stringify(soundEntries, null, 2), 'utf8');
      logger.ok('sounds', 'sounds.json generated', Object.keys(soundEntries));
    }
  });

  return tasks;
}

module.exports = { plan };
