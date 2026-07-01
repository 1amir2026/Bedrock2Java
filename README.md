# Bedrock Add-On → Java Mod Converter (CLI)

Interactive command-line tool that scaffolds a Java (Fabric) Minecraft mod project
from a Bedrock Edition Add-On (Resource Pack + Behavior Pack), converting what can
be converted automatically and clearly logging everything that needs a human (or an
AI assistant) to finish in Java.

No external dependencies — pure Node.js. No `npm install` needed.

## Requirements

- Node.js 18+
- To actually **build the .jar** afterward: a JDK 21 and internet access (Gradle/Fabric
  Loom need to download the Minecraft/Fabric toolchain). This CLI does not build the
  jar itself — it generates a buildable Gradle project.

## Usage

```
node bin/cli.js
```

You'll be asked, in order:
1. Path to the Bedrock Add-On — a **folder**, or a **`.zip` / `.mcaddon` / `.mcpack` file**
   (archives are extracted automatically, including a `.mcaddon`'s nested `.mcpack` files)
2. Output folder for the generated Java mod project
3. Mod ID, display name, version, author, description

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
  --description "Converted from Bedrock"
```

Any flag you omit falls back to an interactive prompt for just that value.

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
| Sounds (.ogg) + sounds.json | Entities (Java class + registration stub generated; AI must be hand-written) | Animation controllers, particles, screen effects |
| Localization (.lang → .json) | Models/geometry (kept as reference; Bedrock's format isn't compatible with Java's) | Scripting API / JavaScript logic (rewrite in Java) |
| Blocks & items (basic registration, models, blockstates, item models, lang) | Recipes needing non-trivial mapping (brewing, etc.) | Economy, survival mechanics, magic systems, UI/Forms, player abilities, and other design-layer gameplay systems |
| Crafting/furnace/smithing/stonecutter recipes | World generation (structures/features/ores) | |
| Loot tables & custom drops | Trade tables | |

Every single item from your feature list is represented in `lib/featureMap.js` and
is always converted — categories marked `[manual]` exist mainly to **document** that
they were considered and explain why there's no file to convert.

## Output

- `<output>/` — a complete Fabric mod Gradle project (`build.gradle`, `fabric.mod.json`,
  Java source, converted assets/data)
- `<output>/bedrock_reference/` — original Bedrock files that couldn't be auto-converted,
  kept for reference while you port them by hand
- `<output>/conversion-log.md` — **the full log**. Every action taken, every warning,
  and every `NEEDS_REVIEW` item with the specific file and a note on what to do.
  Paste sections of this (or the whole file) to a Java/Fabric developer or to an AI
  coding assistant to finish the conversion.

## Building the .jar

```
cd <output>
./gradlew build
```

The .jar will be in `build/libs/`. (Requires internet access for Gradle to fetch the
Fabric Loom toolchain — this sandboxed environment couldn't do that step for you.)

## Project layout

```
bin/cli.js              entry point — all interactive questions
lib/ui.js                colors (cyan/aqua/red/green), progress bar, PgUp/PgDown menu
lib/scanner.js            finds RP/BP inside the add-on folder
lib/featureMap.js         your full feature list, categorized + automation level
lib/javaProject.js        Fabric project scaffolder
lib/pipeline.js            orchestrates scan → scaffold → convert → log
lib/logger.js              writes conversion-log.md
lib/converters/*.js        one file per category (textures, sounds, lang, blocks,
                            items, recipes, loot tables, models, entities, + a
                            generic handler for everything else)
```
