'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// Per-OS Minecraft "mods" folder, so users know exactly where to drop the .jar.
function modsFolderHints() {
  const home = os.homedir();
  return {
    win32: '%APPDATA%\\.minecraft\\mods  (usually C:\\Users\\<you>\\AppData\\Roaming\\.minecraft\\mods)',
    darwin: path.join(home, 'Library', 'Application Support', 'minecraft', 'mods'),
    linux: path.join(home, '.minecraft', 'mods')
  };
}

function currentPlatformModsFolder() {
  const hints = modsFolderHints();
  return hints[process.platform] || hints.linux;
}

// Quick sanity check so we can fail with a clear, friendly message instead of
// a wall of Gradle stack trace when there's simply no JDK on PATH.
function checkJavaAvailable() {
  const result = spawnSync('java', ['-version'], { stdio: 'ignore' });
  if (result.error) return false;
  // On some systems `java -version` still exits non-zero for odd reasons;
  // treat "the process launched at all" as good enough here, since Gradle
  // itself will give a much more detailed error if the JDK is unsuitable.
  return true;
}

// Finds the mod jar Gradle/Fabric Loom produced under build/libs, preferring
// the plain remapped jar over -sources.jar / -dev.jar variants.
function findBuiltJar(outDir, modId, modVersion) {
  const libsDir = path.join(outDir, 'build', 'libs');
  if (!fs.existsSync(libsDir)) return null;
  const jars = fs.readdirSync(libsDir).filter((f) => f.toLowerCase().endsWith('.jar'));
  if (jars.length === 0) return null;

  const expected = `${modId}-${modVersion}.jar`.toLowerCase();
  const exact = jars.find((f) => f.toLowerCase() === expected);
  if (exact) return path.join(libsDir, exact);

  const plain = jars.filter((f) => !/-sources\.jar$|-dev\.jar$/i.test(f));
  const chosen = (plain.length > 0 ? plain : jars).sort()[0];
  return path.join(libsDir, chosen);
}

// Runs "./gradlew build" (or "gradlew.bat build" on Windows) inside the
// scaffolded project, then copies the resulting jar to a convenient,
// easy-to-find location right at the project root.
function buildJar({ outDir, modId, modVersion, onData }) {
  return new Promise((resolve) => {
    if (!checkJavaAvailable()) {
      resolve({
        ok: false,
        error:
          'No Java runtime found on PATH. Install a JDK 21 (e.g. https://adoptium.net/) and make sure "java" is available in your terminal, then re-run with --build-jar, or run "./gradlew build" / "gradlew.bat build" yourself inside the project folder.'
      });
      return;
    }

    const isWin = process.platform === 'win32';
    const wrapperPath = path.join(outDir, isWin ? 'gradlew.bat' : 'gradlew');
    if (!fs.existsSync(wrapperPath)) {
      resolve({ ok: false, error: 'Gradle wrapper not found in the generated project (expected ' + wrapperPath + ').' });
      return;
    }
    if (!isWin) {
      try {
        fs.chmodSync(wrapperPath, 0o755);
      } catch (e) {
        resolve({ ok: false, error: `Could not make gradlew executable: ${e.message}` });
        return;
      }
    }

    const cmd = isWin ? wrapperPath : './gradlew';
    const args = ['build', '--console=plain', '--no-daemon'];

    let child;
    try {
      child = spawn(cmd, args, {
        cwd: outDir,
        shell: isWin, // gradlew.bat needs a shell on Windows
        env: process.env
      });
    } catch (e) {
      resolve({ ok: false, error: `Could not start Gradle: ${e.message}` });
      return;
    }

    const tail = [];
    const pushTail = (text) => {
      tail.push(text);
      if (tail.length > 400) tail.shift();
    };

    child.stdout.on('data', (d) => {
      const text = d.toString();
      pushTail(text);
      if (onData) onData(text);
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      pushTail(text);
      if (onData) onData(text);
    });

    child.on('error', (err) => {
      resolve({ ok: false, error: `Could not start Gradle: ${err.message}` });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: `Gradle build exited with code ${code}.`,
          log: tail.join('')
        });
        return;
      }

      const jarPath = findBuiltJar(outDir, modId, modVersion);
      if (!jarPath) {
        resolve({ ok: false, error: 'Gradle build succeeded but no .jar was found under build/libs/.' });
        return;
      }

      // Copy it to the project root under a clear name, so the user doesn't
      // have to go digging through build/libs/ to find the mod jar.
      const friendlyName = `${modId}-${modVersion}.jar`;
      const friendlyPath = path.join(outDir, friendlyName);
      try {
        fs.copyFileSync(jarPath, friendlyPath);
      } catch (e) {
        // Non-fatal - the jar still exists at jarPath.
        resolve({ ok: true, jarPath, friendlyPath: null, copyError: e.message });
        return;
      }

      resolve({ ok: true, jarPath, friendlyPath });
    });
  });
}

module.exports = { buildJar, findBuiltJar, modsFolderHints, currentPlatformModsFolder, checkJavaAvailable };
