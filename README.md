# Bedrock Add-On → Java Mod Converter (CLI)

Interactive command-line tool that scaffolds a Java (Fabric) Minecraft mod project
from a Bedrock Edition Add-On (Resource Pack + Behavior Pack), converting what can
be converted automatically and clearly logging everything that needs a human (or an
AI assistant) to finish in Java.

No external dependencies — pure Node.js. No `npm install` needed.

## Requirements

- Node.js 18+
- To **build the `.jar`** (either via the built-in `--build-jar` option or by running
  `./gradlew build` yourself afterward): a JDK 21 and internet access on first run
  (Gradle/Fabric Loom need to download the Gradle, Minecraft, and Fabric toolchain).
  You do **not** need Gradle installed — a Gradle wrapper is bundled and generated
  into every project automatically.

## Usage

```
node bin/cli.js
```

You'll be asked, in order:
1. Path to the Bedrock Add-On — a **folder**, or a **`.zip` / `.mcaddon` / `.mcpack` file**
   (archives are extracted automatically, including a `.mcaddon`'s nested `.mcpack` files)
2. Output folder for the generated Java mod project
3. Mod ID, display name, version, author, description
4. Whether to **build the `.jar` right now** with the bundled Gradle wrapper (requires a
   JDK 21 + internet access), or just generate the buildable project source

Every supported feature is converted automatically — there's no category picker to fill out.

Then it runs, printing a live progress bar like:

```
[#####---------------------------------------------]  11.5%  Copying Textures From textures/blocks/ruby_block.png to assets/rubymod/textures/block/ruby_block.png
```

### Add-ons with only a Resource Pack (RC-only)

Some add-ons ship only a Resource Pack (textures/sounds/models/lang) with no Behavior
Pack. The CLI detects this automatically and converts everything the RC contains — you'll
just see a note that there's no behavior data to convert, and the Behavior Pack sections
of the log/output will simply be empty.

### Non-interactive / scripted use

For CI or batch use, pass everything as flags and no prompts will appear:

```
node bin/cli.js \
  --addon ./MyAddon.mcaddon \
  --out ./output/my_addon \
  --mod-id my_addon \
  --mod-name "My Addon" \
  --mod-version 1.0.0 \
  --author "Your Name" \
  --description "Converted from Bedrock" \
  --build-jar
```

Any flag you omit falls back to an interactive prompt for just that value, except
`--build-jar`/`--no-build-jar`: if omitted in a non-interactive context (no TTY, e.g.
CI) it defaults to **no build**, so scripted runs stay fast and don't require a JDK
just to scaffold the project source.

## What gets auto-converted vs. flagged for review

This is the important, honest part. Bedrock Add-Ons and Java mods are fundamentally
different systems (Bedrock = JSON + a JavaScript scripting API; Java mods = compiled
Java code). A 1:1 automatic conversion of *everything* on your feature list is not
possible — no tool can do that truthfully. The CLI always converts **every** category
below in one pass (no picking and choosing) — what varies is how much of each category
lands as working code versus a documented starting point:

| Automatic (`[auto]`) | Scaffolded, needs finishing (`[partial]`) | Logged only, no Java equivalent (`[manual]`) |
|---|---|---|
| Textures (all categories) | Blocks/items with custom behavior components | Entity AI / behaviors / pathfinding |
| Sounds: `.ogg` files **and** real Java `SoundEvent`s registered from `sound_definitions.json` (ModSounds.java) | Entities (Java class + attributes + placeholder renderer + spawn egg generated; AI/goals and the real 3D model must be hand-written) | Animation controllers, particles, screen effects |
| Localization (.lang → .json) | Models/geometry (kept as reference; Bedrock's format isn't compatible with Java's) | Scripting API / JavaScript logic (rewrite in Java) |
| Blocks & items - registration, models, blockstates, item models, lang, **plus a matching `BlockItem`/creative-tab entry so they're actually obtainable in-game** | Recipes needing non-trivial mapping (brewing, etc.) | Economy, survival mechanics, magic systems, UI/Forms, player abilities, and other design-layer gameplay systems |
| Crafting/furnace/smithing/stonecutter recipes | World generation (structures/features/ores) | |
| Loot tables & custom drops | Trade tables | |
| Entity ambient/hurt/death sounds, and items name-matched to a custom sound event (e.g. a "disc" item), wired to real `SoundEvent`s and flagged `NEEDS_REVIEW` to confirm the trigger | | |
| Entity default attributes (`FabricDefaultAttributeRegistry`) and spawn eggs, so spawnable mobs don't crash the client and can be obtained | | |

### What was broken before and is fixed now

Earlier builds of this tool converted blocks/items/entities/sounds as isolated files that
never got wired together, so a converted `.jar` would compile but not actually behave like
the Bedrock Add-On:
- Blocks had no `BlockItem`, and nothing was ever added to a creative-mode tab - converted
  blocks/items were unobtainable except via `/give`. **Fixed:** every block/item now goes
  through a `register()` helper that creates the `BlockItem` (for blocks) and adds itself to
  a generated `ModItemGroup` creative tab.
- Custom mobs had no `FabricDefaultAttributeRegistry` call or `EntityRenderer` registration -
  spawning one crashed the client. **Fixed:** attributes and a crash-safe placeholder renderer
  are now generated and registered (via a new client entry point, `ModClient.java`) for every
  entity; spawnable entities also get a spawn egg.
- `.ogg` files were copied and a `sounds.json` was written, but no Java `SoundEvent` was ever
  registered, so nothing could actually play a custom sound. **Fixed:** `sound_definitions.json`
  is now parsed and every sound event becomes a real registered `SoundEvent` in `ModSounds.java`,
  which entity ambient/hurt/death sounds and name-matched items (e.g. music discs) now reference.

Every single item from your feature list is represented in `lib/featureMap.js` and
is always converted — categories marked `[manual]` exist mainly to **document** that
they were considered and explain why there's no file to convert.

## Output

- `<output>/` — a complete Fabric mod Gradle project (`build.gradle`, `fabric.mod.json`,
  Java source, converted assets/data), **with a bundled Gradle wrapper** (`gradlew`,
  `gradlew.bat`, `gradle/wrapper/`) so no separate Gradle install is needed
- `<output>/<mod_id>-<version>.jar` — the **built mod jar**, ready to install, if you
  chose to build it (via the prompt or `--build-jar`)
- `<output>/bedrock_reference/` — original Bedrock files that couldn't be auto-converted,
  kept for reference while you port them by hand
- `<output>/conversion-log.md` — **the full log**. Every action taken, every warning,
  and every `NEEDS_REVIEW` item with the specific file and a note on what to do.
  Paste sections of this (or the whole file) to a Java/Fabric developer or to an AI
  coding assistant to finish the conversion.

## Building the .jar

**Option A — let the CLI do it:** answer "Yes" to the build prompt, or pass `--build-jar`.
The CLI runs the bundled Gradle wrapper for you and copies the finished jar to
`<output>/<mod_id>-<version>.jar` when it's done.

**Option B — build it yourself:**

```
cd <output>
./gradlew build        # macOS/Linux
gradlew.bat build       # Windows
```

The .jar will be in `build/libs/`. (Requires internet access on first run for Gradle to
download itself plus the Fabric Loom/Minecraft toolchain — this sandboxed environment
couldn't reach those servers, so `--build-jar` was verified here only up to the point
where Gradle correctly starts downloading; it works end-to-end on a normal machine with
internet access.)

### Installing the built .jar

Fabric Loader + Fabric API must already be installed for the matching Minecraft version
in the target instance. Then drop the jar into that instance's `mods` folder:

| OS | Mods folder |
|---|---|
| Windows | `%APPDATA%\.minecraft\mods` |
| macOS | `~/Library/Application Support/minecraft/mods` |
| Linux | `~/.minecraft/mods` |

(If you're using a launcher like MultiMC/Prism/CurseForge, use that instance's own
`mods` folder instead of the default one above.)

## Project layout

```
bin/cli.js              entry point — all interactive questions
lib/ui.js                colors (cyan/aqua/red/green), progress bar, PgUp/PgDown menu
lib/scanner.js            finds RP/BP inside the add-on folder
lib/featureMap.js         your full feature list, categorized + automation level
lib/javaProject.js        Fabric project scaffolder (also writes the Gradle wrapper)
lib/javaBuild.js          runs the Gradle wrapper to produce a real .jar + reports
                          the mods folder to install it into
lib/assets.js             loads bundled binary assets (works from source and from
                          a packaged SEA binary)
lib/resources/            bundled Gradle wrapper jar + scripts
lib/pipeline.js            orchestrates scan → scaffold → convert → log → (optional) build
lib/logger.js              writes conversion-log.md
lib/converters/*.js        one file per category (textures, sounds, lang, blocks,
                            items, recipes, loot tables, models, entities, + a
                            generic handler for everything else)
```
