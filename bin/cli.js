#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ui = require('../lib/ui');
const { CATEGORY_ORDER } = require('../lib/featureMap');
const { runConversion } = require('../lib/pipeline');
const { isArchive } = require('../lib/zipExtract');

function parseFlags(argv) {
  const flags = {};
  if (argv.includes('--build-jar')) flags.buildJar = true;
  if (argv.includes('--no-build-jar')) flags.buildJar = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const map = {
      '--addon': 'addon',
      '--out': 'out',
      '--mod-id': 'modId',
      '--mod-name': 'modName',
      '--mod-version': 'modVersion',
      '--author': 'author',
      '--description': 'description'
    };
    if (map[arg] && argv[i + 1] !== undefined) {
      flags[map[arg]] = argv[i + 1];
      i++;
    }
  }
  return flags;
}

// Resolves a value either from a CLI flag (non-interactive) or an interactive prompt.
// Using --flags lets the whole tool be scripted/CI-driven without piping answers
// through stdin, which has known Node readline edge cases with early pipe EOF.
async function resolve(flagValue, promptOpts) {
  if (flagValue !== undefined) {
    if (promptOpts.validate) {
      const result = promptOpts.validate(flagValue);
      if (result !== true) {
        throw new Error(`Invalid value for "${promptOpts.question}": ${result}`);
      }
    }
    ui.ok(`${promptOpts.question} ${flagValue}`);
    return flagValue;
  }
  return ui.textPrompt(promptOpts);
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

  const flags = parseFlags(process.argv.slice(2));

  console.clear?.();
  ui.heading('Bedrock Add-On -> Java Mod Converter');
  console.log(ui.color.dim('Answers below: use Up/Down or PgUp/PgDown to move, Space to toggle, Enter to confirm.'));
  console.log(ui.color.dim('Every supported Bedrock feature is converted automatically - no feature selection needed.'));
  console.log(ui.color.dim('(Non-interactive/CI use: pass --addon, --out, --mod-id, --mod-name, --mod-version, --author, --description, --build-jar / --no-build-jar)'));

  // 1. Bedrock add-on path (folder, or a .zip / .mcaddon / .mcpack archive)
  const addonPath = await resolve(flags.addon, {
    question: 'Path to the Bedrock Add-On (folder, .zip, .mcaddon, or .mcpack):',
    validate: (v) => {
      if (!v) return 'A path is required.';
      if (!fs.existsSync(v)) return `Path does not exist: ${v}`;
      const stat = fs.statSync(v);
      if (stat.isDirectory()) return true;
      if (isArchive(v)) return true;
      return 'Path must be a folder, or a .zip / .mcaddon / .mcpack file.';
    }
  });

  // 2. Output path
  const inputBaseName = path.basename(addonPath).replace(/\.(zip|mcaddon|mcpack)$/i, '');
  const defaultModId = inputBaseName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'converted_addon';

  const outDir = await resolve(flags.out, {
    question: 'Output folder for the generated Java mod project:',
    defaultValue: path.join(process.cwd(), 'output', defaultModId),
    validate: (v) => (v ? true : 'An output path is required.')
  });

  // 3. Mod metadata
  const modId = await resolve(flags.modId, {
    question: 'Mod ID (lowercase, no spaces, e.g. "my_addon"):',
    defaultValue: defaultModId,
    validate: (v) => (/^[a-z][a-z0-9_]*$/.test(v) ? true : 'Mod ID must be lowercase letters, numbers, and underscores, starting with a letter.')
  });

  const modName = await resolve(flags.modName, {
    question: 'Mod display name:',
    defaultValue: defaultModId
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' '),
    validate: (v) => (v ? true : 'A display name is required.')
  });

  const modVersion = await resolve(flags.modVersion, {
    question: 'Mod version:',
    defaultValue: '1.0.0',
    validate: (v) => (v ? true : 'A version is required.')
  });

  const authorName = await resolve(flags.author, {
    question: 'Author name:',
    defaultValue: 'Unknown',
    validate: (v) => (v ? true : 'An author name is required.')
  });

  const description = await resolve(flags.description, {
    question: 'Short mod description (optional):',
    defaultValue: `${modName} - converted from a Minecraft Bedrock Add-On`
  });

  // 4. Build the .jar now?
  let buildJarNow;
  if (flags.buildJar !== undefined) {
    buildJarNow = flags.buildJar;
    ui.ok(`Build .jar now: ${buildJarNow ? 'yes' : 'no'}`);
  } else if (!process.stdout.isTTY) {
    // Non-interactive/CI/scripted use: never auto-build unless explicitly
    // requested with --build-jar, so scripted runs stay fast and don't
    // require a JDK/internet just to scaffold the project source.
    buildJarNow = false;
  } else {
    buildJarNow = await ui.selectPrompt({
      question: 'Build the .jar now with Gradle? (requires a JDK 21 and internet access)',
      options: [
        { label: 'Yes - build the .jar now', value: true, hint: 'runs ./gradlew build for you' },
        { label: 'No - just generate the project source', value: false, hint: 'you can run ./gradlew build yourself later' }
      ],
      defaultIndex: 0
    });
  }

  ui.heading('Starting Conversion');
  ui.closeTextPrompt();
  console.log(`${ui.color.aqua('Add-on path:')}      ${addonPath}`);
  console.log(`${ui.color.aqua('Output path:')}      ${outDir}`);
  console.log(`${ui.color.aqua('Mod ID:')}           ${modId}`);
  console.log(`${ui.color.aqua('Mod name:')}         ${modName}`);
  console.log(`${ui.color.aqua('Version:')}          ${modVersion}`);
  console.log(`${ui.color.aqua('Author:')}           ${authorName}`);
  console.log(`${ui.color.aqua('Categories:')}       all (${CATEGORY_ORDER.length}) - every supported feature is converted automatically`);
  console.log(`${ui.color.aqua('Build .jar now:')}   ${buildJarNow ? 'yes' : 'no'}`);

  await runConversion({
    addonPath,
    outDir,
    modId,
    modName,
    modVersion,
    authorName,
    description,
    selectedCategories: CATEGORY_ORDER,
    buildJarNow
  });
}

// When double-clicked from Windows Explorer, this exe owns its own console
// window - if the process exits (success or failure) the window closes
// immediately and any output is lost before it can be read. Detect that case
// (no CI env var, stdin is a real interactive TTY) and pause for a keypress
// before the process is allowed to end.
function isLikelyDoubleClicked() {
  return !process.env.CI && !!process.stdin.isTTY && !!process.stdout.isTTY;
}

function pauseBeforeExit() {
  return new Promise((resolve) => {
    if (!isLikelyDoubleClicked()) return resolve();
    process.stdout.write('\nPress Enter to exit...');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', () => resolve());
    process.stdin.resume();
  });
}

main()
  .then(() => pauseBeforeExit())
  .catch(async (e) => {
    const message = 'Fatal error: ' + (e && e.stack ? e.stack : String(e));
    try {
      ui.err(message);
    } catch (uiErr) {
      // ui itself may have failed to load (e.g. missing bundled module) -
      // fall back to plain console output so the user still sees *something*.
      console.error(message);
    }
    // Always leave a crash log next to the exe, in case the window still
    // closes before the person can read the console (e.g. antivirus kill).
    try {
      const logPath = path.join(path.dirname(process.execPath), 'bedrock2java-crash.log');
      fs.writeFileSync(logPath, `${new Date().toISOString()}\n${message}\n`, 'utf8');
      console.error(`Details written to: ${logPath}`);
    } catch (logErr) {
      // best-effort only
    }
    await pauseBeforeExit();
    process.exit(1);
  });

