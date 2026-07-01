'use strict';
const fs = require('fs');
const path = require('path');

// Reads a bundled binary/text asset (e.g. the Gradle wrapper jar) so it works
// both when running from source (plain files under lib/resources/) and when
// running as a Node.js Single Executable Application, where files on disk
// next to the binary don't exist and assets must be pulled out of the SEA
// blob via node:sea's getAsset() API instead.
//
// relPath is a path relative to lib/resources/, e.g. "gradle-wrapper/gradlew".
// SEA assets are registered by basename in sea-config.json, so that's the key
// used to look them up when running as a packaged binary.
function readAsset(relPath) {
  try {
    // eslint-disable-next-line global-require
    const sea = require('node:sea');
    if (sea && typeof sea.isSea === 'function' && sea.isSea()) {
      const key = path.basename(relPath);
      const arrayBuffer = sea.getAsset(key);
      return Buffer.from(arrayBuffer);
    }
  } catch (e) {
    // node:sea isn't available (older Node) or we're just not running as a
    // packaged SEA binary - fall through to reading the file from disk.
  }
  return fs.readFileSync(path.join(__dirname, 'resources', relPath));
}

module.exports = { readAsset };
