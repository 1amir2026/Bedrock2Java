'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scanAddon } = require('./scanner');
const { scaffoldFabricProject } = require('./javaProject');
const { ConversionLogger } = require('./logger');
const { extractZip, isArchive } = require('./zipExtract');
const { buildJar, modsFolderHints, currentPlatformModsFolder } = require('./javaBuild');
const ui = require('./ui');

const textures = require('./converters/textures');
const sounds = require('./converters/sounds');
const lang = require('./converters/lang');
const models = require('./converters/models');
const blocks = require('./converters/blocks');
const items = require('./converters/items');
const recipes = require('./converters/recipes');
const lootTables = require('./converters/lootTables');
const entities = require('./converters/entities');
const generic = require('./converters/generic');

// Resolves the user-supplied add-on path to a plain directory, extracting
// .zip / .mcaddon / .mcpack archives (and any .mcpack files nested inside
// a .mcaddon, which is the normal Bedrock packaging for a two-pack add-on).
function resolveAddonInput(inputPath, logger) {
  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) return inputPath;

  if (!isArchive(inputPath)) {
    throw new Error(`Unsupported input file: ${inputPath} (expected a folder, .zip, .mcaddon, or .mcpack)`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock2java-'));
  ui.step(`Extracting archive: ${path.basename(inputPath)}`);
  extractZip(inputPath, tempRoot);
  logger.info('input', `Extracted archive to temp folder`, { archive: inputPath, tempRoot });

  // .mcaddon packages commonly contain one or more nested .mcpack files
  // (one per RP/BP) instead of raw folders - extract those too.
  const nested = fs.readdirSync(tempRoot).filter((f) => /\.mcpack$/i.test(f));
  for (const n of nested) {
    const nestedPath = path.join(tempRoot, n);
    const nestedOut = path.join(tempRoot, path.basename(n, path.extname(n)));
    ui.step(`Extracting nested pack: ${n}`);
    extractZip(nestedPath, nestedOut);
    logger.info('input', `Extracted nested .mcpack`, { nestedPath, nestedOut });
  }

  return tempRoot;
}

async function runConversion(opts) {
  const { addonPath: rawAddonPath, outDir, modId, modName, modVersion, authorName, description, selectedCategories, buildJarNow } = opts;

  const preScanLogger = new ConversionLogger(outDir);

  ui.heading('1. Scanning Bedrock Add-On');
  const addonPath = resolveAddonInput(rawAddonPath, preScanLogger);
  const scan = scanAddon(addonPath);
  if (!scan.rp && !scan.bp) {
    ui.err(`Could not find a Resource Pack or Behavior Pack inside: "${rawAddonPath}"`);
    ui.err(`(resolved to: "${addonPath}")`);
    try {
      const top = fs.readdirSync(addonPath);
      ui.info(`Top-level contents of that folder: ${top.length ? top.join(', ') : '(empty)'}`);
    } catch (e) {
      ui.info(`Could not list the folder's contents: ${e.message}`);
    }
    ui.info('Expected a folder containing RP-style subfolders (textures/sounds/texts/models/...) and/or BP-style subfolders (blocks/items/entities/recipes/...) at any nesting depth - e.g. "RP"+"BP", "resource_packs/<name>"+"behavior_packs/<name>", or the pack folder itself.');
    process.exit(1);
  }
  ui.ok(`Resource Pack: ${scan.rp || '(not found)'}`);
  ui.ok(`Behavior Pack: ${scan.bp || '(not found)'}`);
  if (scan.rp && !scan.bp) {
    ui.info('This add-on only has a Resource Pack (RC) - textures/sounds/models/lang will be converted automatically; there is no behavior data to convert.');
  }

  ui.heading('2. Scaffolding Java (Fabric) Mod Project');
  const project = scaffoldFabricProject({ outDir, modId, modName, modVersion, authorName, description });
  ui.ok(`Project created at: ${outDir}`);

  const logger = new ConversionLogger(outDir);
  logger.entries.push(...preScanLogger.entries);
  logger.info('setup', 'Scan results', { rp: scan.rp, bp: scan.bp });
  logger.info('setup', 'Java project scaffolded', { outDir, package: project.pkg });

  const ctx = {
    rp: scan.rp,
    bp: scan.bp,
    outDir,
    modId,
    pkg: project.pkg,
    javaDir: project.javaDir,
    assetsDir: project.assetsDir,
    dataDir: project.dataDir,
    logger,
    selectedCategories
  };

  ui.heading('3. Planning Conversion Tasks');
  let tasks = [];
  if (selectedCategories.includes('textures')) tasks = tasks.concat(textures.plan(ctx));
  if (selectedCategories.includes('sounds')) tasks = tasks.concat(sounds.plan(ctx));
  if (selectedCategories.includes('lang')) tasks = tasks.concat(lang.plan(ctx));
  if (selectedCategories.includes('models')) tasks = tasks.concat(models.plan(ctx));
  if (selectedCategories.includes('blocks')) tasks = tasks.concat(blocks.plan(ctx));
  if (selectedCategories.includes('items')) tasks = tasks.concat(items.plan(ctx));
  if (selectedCategories.includes('recipes')) tasks = tasks.concat(recipes.plan(ctx));
  if (selectedCategories.includes('loot_tables')) tasks = tasks.concat(lootTables.plan(ctx));
  if (selectedCategories.includes('entities')) tasks = tasks.concat(entities.plan(ctx));
  tasks = tasks.concat(generic.plan(ctx)); // internally filters by selectedCategories

  ui.ok(`${tasks.length} conversion task(s) queued.`);

  ui.heading('4. Converting');
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    ui.renderProgressBar(i, tasks.length, task.label);
    try {
      task.run();
    } catch (e) {
      logger.error('pipeline', `Unhandled error during: ${task.label}`, e.stack || String(e));
    }
  }
  ui.renderProgressBar(tasks.length, tasks.length, 'Done');
  ui.endProgress();

  const logPath = logger.write('conversion-log.md');

  ui.heading('5. Summary');
  const counts = logger.counts();
  console.log(`${ui.color.green('OK:')} ${counts.OK}   ${ui.color.aqua('INFO:')} ${counts.INFO}   ${ui.color.cyan('WARN:')} ${counts.WARN}   ${ui.color.red('ERROR:')} ${counts.ERROR}   ${ui.color.red('NEEDS REVIEW:')} ${counts.NEEDS_REVIEW}`);
  console.log('');
  ui.ok(`Java mod project: ${outDir}`);
  ui.ok(`Full conversion log: ${logPath}`);
  if (counts.ERROR > 0 || counts.NEEDS_REVIEW > 0) {
    ui.err(`${counts.ERROR + counts.NEEDS_REVIEW} item(s) need manual attention - see the log above for what to hand to a developer or AI assistant.`);
  } else {
    ui.ok('No manual follow-up items - nice and clean!');
  }

  let jarResult = null;
  if (buildJarNow) {
    ui.heading('6. Building the .jar');
    ui.step('Running the bundled Gradle wrapper (./gradlew build) - this can take a few minutes the first time while Gradle, Minecraft, and Fabric dependencies download...');
    jarResult = await buildJar({
      outDir,
      modId,
      modVersion,
      onData: (text) => process.stdout.write(ui.color.dim(text))
    });

    if (jarResult.ok) {
      const jarToShow = jarResult.friendlyPath || jarResult.jarPath;
      console.log('');
      ui.ok(`Built: ${jarToShow}`);
      console.log('');
      console.log(ui.color.bold(ui.color.aqua('Drop that .jar into your Minecraft "mods" folder:')));
      const hints = modsFolderHints();
      console.log(`  Windows:  ${hints.win32}`);
      console.log(`  macOS:    ${hints.darwin}`);
      console.log(`  Linux:    ${hints.linux}`);
      console.log('');
      console.log(ui.color.dim(`(This machine's mods folder: ${currentPlatformModsFolder()})`));
      console.log(ui.color.dim('Requires Fabric Loader + Fabric API installed for the matching Minecraft version in that instance.'));
    } else {
      console.log('');
      ui.err(`Could not build the .jar automatically: ${jarResult.error}`);
      if (jarResult.log) {
        console.log(ui.color.dim(jarResult.log.split('\n').slice(-25).join('\n')));
      }
      console.log('');
      ui.info('You can still build it yourself: open a terminal in the project folder and run:');
      console.log(`  ${ui.color.aqua('./gradlew build')}      (macOS/Linux)`);
      console.log(`  ${ui.color.aqua('gradlew.bat build')}    (Windows)`);
      ui.info('Requires a JDK 21 and internet access on first run. The .jar will appear in build/libs/.');
    }
  } else {
    console.log('');
    console.log(ui.color.dim('Next step: build the mod .jar by running "./gradlew build" (macOS/Linux) or "gradlew.bat build" (Windows) inside the project folder (requires internet access + a JDK 21) - the .jar will be in build/libs/.'));
    console.log(ui.color.dim('Or re-run this tool with --build-jar to have it build the .jar automatically and tell you where to install it.'));
  }

  return { outDir, logPath, counts, jarPath: jarResult && jarResult.ok ? (jarResult.friendlyPath || jarResult.jarPath) : null };
}

module.exports = { runConversion };
