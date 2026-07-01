'use strict';
const fs = require('fs');
const path = require('path');
const { readAsset } = require('./assets');

const GRADLE_WRAPPER_VERSION = '8.10.2';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function toJavaPackage(modId) {
  let segment = modId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  // Java identifiers (and therefore package segments) cannot start with a digit.
  if (/^[0-9]/.test(segment)) {
    segment = `_${segment}`;
  }
  // Guard against an all-invalid-character input collapsing to nothing.
  if (!segment) {
    segment = '_';
  }
  return segment;
}

function scaffoldFabricProject({ outDir, modId, modName, modVersion, authorName, description }) {
  const pkg = `com.${toJavaPackage(authorName || 'converted')}.${toJavaPackage(modId)}`;
  const pkgPath = pkg.replace(/\./g, '/');
  const srcMain = path.join(outDir, 'src', 'main');
  const javaDir = path.join(srcMain, 'java', pkgPath);
  const resDir = path.join(srcMain, 'resources');
  const assetsDir = path.join(resDir, 'assets', modId);
  const dataDir = path.join(resDir, 'data', modId);

  // build.gradle
  writeFile(
    path.join(outDir, 'build.gradle'),
    `plugins {
\tid 'fabric-loom' version '1.7-SNAPSHOT'
\tid 'maven-publish'
}

version = project.mod_version
group = project.maven_group

base {
\tarchivesName = project.archives_base_name
}

repositories {
\tmavenCentral()
}

dependencies {
\tminecraft "com.mojang:minecraft:\${project.minecraft_version}"
\tmappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"
\tmodImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
\tmodImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
\tinputs.property "version", project.version
\tfilteringCharset "UTF-8"
\tfilesMatching("fabric.mod.json") {
\t\texpand "version": project.version
\t}
}

tasks.withType(JavaCompile).configureEach {
\tit.options.release = 21
}

java {
\twithSourcesJar()
\tsourceCompatibility = JavaVersion.VERSION_21
\ttargetCompatibility = JavaVersion.VERSION_21
}

jar {
\tfrom("LICENSE") {
\t\trename { "\${it}_\${base.archivesName.get()}" }
\t}
}
`
  );

  // gradle.properties
  writeFile(
    path.join(outDir, 'gradle.properties'),
    `org.gradle.jvmargs=-Xmx2G
org.gradle.parallel=true

minecraft_version=1.21.1
yarn_mappings=1.21.1+build.3
loader_version=0.16.9

mod_version=${modVersion}
maven_group=${pkg.substring(0, pkg.lastIndexOf('.'))}
archives_base_name=${modId}

fabric_version=0.105.0+1.21.1
`
  );

  writeFile(
    path.join(outDir, 'settings.gradle'),
    `pluginManagement {
\trepositories {
\t\tmavenCentral()
\t\tmaven { url 'https://maven.fabricmc.net/' }
\t\tgradlePluginPortal()
\t}
}
`
  );

  // Gradle wrapper - bundled with this CLI so the generated project can run
  // "./gradlew build" (or "gradlew.bat build" on Windows) without the user
  // needing Gradle installed separately. A JDK and internet access (to
  // download the Gradle distribution + Fabric/Minecraft dependencies on
  // first run) are still required.
  const wrapperDir = path.join(outDir, 'gradle', 'wrapper');
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, 'gradle-wrapper.jar'), readAsset('gradle-wrapper/gradle-wrapper.jar'));
  writeFile(
    path.join(wrapperDir, 'gradle-wrapper.properties'),
    `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_WRAPPER_VERSION}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
  );
  fs.writeFileSync(path.join(outDir, 'gradlew'), readAsset('gradle-wrapper/gradlew'));
  try {
    fs.chmodSync(path.join(outDir, 'gradlew'), 0o755);
  } catch (e) {
    // best-effort (e.g. unsupported on some filesystems) - the build step
    // chmod's it again before invoking it
  }
  fs.writeFileSync(path.join(outDir, 'gradlew.bat'), readAsset('gradle-wrapper/gradlew.bat'));

  // fabric.mod.json
  const fabricModJson = {
    schemaVersion: 1,
    id: modId,
    version: '${version}',
    name: modName,
    description: description || `${modName} - converted from a Minecraft Bedrock Add-On`,
    authors: [authorName || 'Unknown'],
    contact: {},
    license: 'ARR',
    icon: 'assets/' + modId + '/icon.png',
    environment: '*',
    entrypoints: {
      main: [`${pkg}.${toClassName(modId)}`],
      client: [`${pkg}.client.ModClient`]
    },
    mixins: [],
    depends: {
      fabricloader: '>=0.16.9',
      minecraft: '~1.21.1',
      java: '>=21',
      'fabric-api': '*'
    }
  };
  writeFile(path.join(resDir, 'fabric.mod.json'), JSON.stringify(fabricModJson, null, 2));

  // main mod class
  const className = toClassName(modId);
  writeFile(
    path.join(javaDir, `${className}.java`),
    `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Entry point for the mod converted from a Bedrock Add-On.
 * Generated by the Bedrock-to-Java Add-On Converter CLI.
 *
 * Registration calls for blocks/items/entities generated by the converter
 * are wired up in the *Registry classes under this package - check
 * conversion-log.md for anything that still needs manual attention.
 */
public class ${className} implements ModInitializer {
\tpublic static final String MOD_ID = "${modId}";
\tpublic static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

\t@Override
\tpublic void onInitialize() {
\t\tLOGGER.info("Initializing ${modName} (converted from Bedrock Add-On)");
\t\t// Sounds must register before anything that references a ModSounds constant at class-load time.
\t\tModSounds.register();
\t\tModItemGroup.register();
\t\tModBlocks.register();
\t\tModItems.register();
\t}
}
`
  );

  // Empty registries that converters will append to
  writeFile(
    path.join(javaDir, 'ModBlocks.java'),
    `package ${pkg};

import net.minecraft.block.Block;
import net.minecraft.block.AbstractBlock;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

/**
 * Generated block registrations. Each entry below was converted from a Bedrock block JSON.
 * register(name, block) also creates and registers the matching BlockItem and adds it to
 * ${modName}'s creative-mode tab (ModItemGroup) - without this, a Bedrock block that converts
 * fine would still be impossible to obtain or place in Java survival.
 */
public class ModBlocks {
\tprivate static Block register(String name, Block block) {
\t\tIdentifier id = Identifier.of("${modId}", name);
\t\tBlock registered = Registry.register(Registries.BLOCK, id, block);
\t\tItem blockItem = Registry.register(Registries.ITEM, id, new BlockItem(registered, new Item.Settings()));
\t\tModItemGroup.ITEMS.add(blockItem);
\t\treturn registered;
\t}

\tpublic static void register() {
\t\t// Converted blocks are registered here. See conversion-log.md for details.
\t}
}
`
  );

  writeFile(
    path.join(javaDir, 'ModItems.java'),
    `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.component.type.FoodComponent;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

/**
 * Generated item registrations. Each entry below was converted from a Bedrock item JSON.
 * register(name, item) also adds the item to ${modName}'s creative-mode tab (ModItemGroup) -
 * without this, a Bedrock item that converts fine would still be invisible in the inventory.
 */
public class ModItems {
\tprivate static Item register(String name, Item item) {
\t\tIdentifier id = Identifier.of("${modId}", name);
\t\tItem registered = Registry.register(Registries.ITEM, id, item);
\t\tModItemGroup.ITEMS.add(registered);
\t\treturn registered;
\t}

\tpublic static void register() {
\t\t// Converted items are registered here. See conversion-log.md for details.
\t}
}
`
  );

  // A single creative-mode tab holding every block/item converted from the Bedrock Add-On.
  // Bedrock has no equivalent concept (its inventory is driven by the crafting/creative JSON
  // in the BP), so without this every converted block/item would only be obtainable via /give.
  writeFile(
    path.join(javaDir, 'ModItemGroup.java'),
    `package ${pkg};

import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.List;

public class ModItemGroup {
\t/** Every converted block/item registration adds itself here (see ModBlocks/ModItems). */
\tpublic static final List<Item> ITEMS = new ArrayList<>();

\tpublic static final RegistryKey<ItemGroup> GROUP_KEY =
\t\tRegistryKey.of(RegistryKeys.ITEM_GROUP, Identifier.of("${modId}", "main"));

\tpublic static void register() {
\t\tRegistry.register(Registries.ITEM_GROUP, GROUP_KEY, FabricItemGroup.builder()
\t\t\t.displayName(Text.translatable("itemGroup.${modId}"))
\t\t\t.icon(() -> ITEMS.isEmpty() ? new ItemStack(Items.BOOK) : new ItemStack(ITEMS.get(0)))
\t\t\t.build());
\t\t// Registered lazily: fires when the tab is actually opened, by which point onInitialize()
\t\t// has already finished populating ITEMS via ModBlocks.register()/ModItems.register().
\t\tItemGroupEvents.modifyEntriesEvent(GROUP_KEY).register(entries -> {
\t\t\tfor (Item item : ITEMS) {
\t\t\t\tentries.add(item);
\t\t\t}
\t\t});
\t}
}
`
  );

  // Empty sound-event registry - populated by the sounds converter from sound_definitions.json
  // (or per-file fallback) whenever the add-on's Resource Pack has a sounds/ folder.
  writeFile(
    path.join(javaDir, 'ModSounds.java'),
    `package ${pkg};

import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.SoundEvent;
import net.minecraft.util.Identifier;

/** Generated sound-event registrations, converted from the Bedrock Resource Pack's sounds/. */
public class ModSounds {
\tpublic static void register() {
\t\t// Converted sound events are registered here (as a side effect of the static fields
\t\t// above being loaded). See conversion-log.md for details.
\t}
}
`
  );

  // Client-only entry point. Entity renderers MUST be registered here (never in the common
  // ModInitializer) or the game will crash trying to load them on a dedicated server.
  const clientDir = path.join(javaDir, 'client');
  writeFile(
    path.join(clientDir, 'ModClient.java'),
    `package ${pkg}.client;

import net.fabricmc.api.ClientModInitializer;

/**
 * Client-side entry point for ${modName}. Entity renderer registrations generated from
 * Bedrock entity JSON are added here by the converter - see conversion-log.md.
 */
public class ModClient implements ClientModInitializer {
\t@Override
\tpublic void onInitializeClient() {
\t\t// Converted entity renderers are registered here. See conversion-log.md for details.
\t}
}
`
  );

  writeFile(path.join(outDir, 'LICENSE'), 'All rights reserved (placeholder - edit as needed).\n');

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  writeFile(
    path.join(assetsDir, 'lang', 'en_us.json'),
    JSON.stringify({ [`itemGroup.${modId}`]: modName }, null, 2)
  );

  return { pkg, pkgPath, javaDir, clientDir, assetsDir, dataDir, className, resDir };
}

function toClassName(modId) {
  let name = modId
    .split(/[_\-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  // Java class/type names cannot start with a digit.
  if (/^[0-9]/.test(name)) {
    name = `Mod${name}`;
  }
  if (!name) {
    name = 'Mod';
  }
  return name;
}

module.exports = { scaffoldFabricProject, toClassName, writeFile };
