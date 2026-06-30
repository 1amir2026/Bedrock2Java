'use strict';
const fs = require('fs');
const path = require('path');

function parseLang(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    // Bedrock lang lines may have a trailing "\t#comment"
    const value = line.slice(idx + 1).split('\t#')[0].trim();
    out[key] = value;
  }
  return out;
}

// Bedrock locale codes (en_US) -> Java locale codes (en_us)
function toJavaLocale(name) {
  return name.replace(/\.lang$/i, '').toLowerCase();
}

function plan(ctx) {
  const { rp, assetsDir, modId, logger } = ctx;
  const tasks = [];
  if (!rp) return tasks;

  const textsRoot = path.join(rp, 'texts');
  if (!fs.existsSync(textsRoot)) return tasks;

  const files = fs.readdirSync(textsRoot).filter((f) => f.endsWith('.lang'));

  for (const file of files) {
    const src = path.join(textsRoot, file);
    const locale = toJavaLocale(file);
    const dest = path.join(assetsDir, 'lang', `${locale}.json`);

    tasks.push({
      label: `Converting Language File From ${file} to assets/${modId}/lang/${locale}.json`,
      run: () => {
        const content = fs.readFileSync(src, 'utf8');
        const entries = parseLang(content);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(entries, null, 2), 'utf8');
        logger.ok('lang', `Translated ${Object.keys(entries).length} keys from ${file}`);
        logger.warn(
          'lang',
          `Raw Bedrock keys from ${file} were carried over as-is`,
          'Bedrock keys like "tile.<id>.name" use colon/dot syntax that does not match Java\'s key format ' +
            '(e.g. "block.<modid>.<name>"). The block/item converters already generate correct Java-format keys ' +
            'separately; treat the raw copied keys as a translation reference, not as functional keys.'
        );
      }
    });
  }

  return tasks;
}

module.exports = { plan, parseLang };
