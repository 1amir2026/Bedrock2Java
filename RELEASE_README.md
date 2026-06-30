# Bedrock → Java Converter — Release Guide

This page covers: **how to download and run a release**, and **how to fix the
warnings/errors people most commonly hit** — the Windows blue "protected your PC"
screen, code-signing/antivirus warnings, and Java/Gradle errors when building the
final `.jar`.

Every release publishes these files:

| File | What it is |
|---|---|
| `bedrock2java-cli-source.zip` | Plain source — **recommended**. Runs anywhere Node.js is installed, no security warnings at all. |
| `bedrock2java-windows-x64.exe` | Standalone Windows binary. No Node install needed. **Unsigned** — see below. |
| `bedrock2java-linux-x64` | Standalone Linux binary. No Node install needed. |
| `bedrock2java-macos-x64` / `bedrock2java-macos-arm64` | Standalone macOS binaries (Intel / Apple Silicon). Ad-hoc signed, not notarized — see below. |
| `*.sha256` | Checksum for each binary, so you can verify the download wasn't corrupted/tampered with. |

---

## 1. How to run it

### Option A — Source bundle (works on Windows, Linux, macOS; recommended)

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. Download `bedrock2java-cli-source.zip` from the [Releases page](../../releases) and unzip it.
3. Open a terminal in that folder and run:
   ```
   node bin/cli.js
   ```
4. Answer the prompts (Up/Down or PgUp/PgDown to move, Space to toggle, Enter to confirm).

This option never triggers SmartScreen, Gatekeeper, or antivirus warnings, because
nothing is a compiled, unsigned binary — it's just a script running through Node.js.

### Option B — Standalone binary (no Node install required)

**Windows:**
1. Download `bedrock2java-windows-x64.exe`.
2. Double-click it, or run it from a terminal:
   ```
   .\bedrock2java-windows-x64.exe
   ```
3. You will very likely see a blue **"Windows protected your PC"** screen — this is
   expected and explained in [Section 2](#2-the-blue-windows-protected-your-pc-screen-smartscreen).

**Linux:**
```
chmod +x bedrock2java-linux-x64
./bedrock2java-linux-x64
```

**macOS:**
```
chmod +x bedrock2java-macos-arm64   # or bedrock2java-macos-x64 on an Intel Mac
./bedrock2java-macos-arm64
```
If macOS blocks it the first time, see [Section 3](#3-macos-gatekeeper-app-is-damaged--unidentified-developer).

### Verifying a download (optional but recommended)

```
# Windows (PowerShell)
Get-FileHash .\bedrock2java-windows-x64.exe -Algorithm SHA256

# Linux / macOS
shasum -a 256 bedrock2java-linux-x64
```
Compare the result to the matching `.sha256` file in the release. If they don't match, re-download.

---

## 2. The blue "Windows protected your PC" screen (SmartScreen)

**What it is:** Windows SmartScreen shows this for any `.exe` that isn't signed
with a paid, Microsoft-trusted code-signing certificate. It is **not** an antivirus
detection and **not** a sign the file is malicious by itself — it just means the
file's publisher hasn't been verified, because we don't pay for a commercial
signing certificate for an open-source CLI tool.

**To run it anyway:**
1. On the blue screen, click **"More info"**.
2. Click the **"Run anyway"** button that appears.

**If you'd rather not do that at all:** use Option A (the source bundle) instead —
it's the same code, runs through Node.js, and never shows this screen.

**Why we don't just sign it:** code-signing certificates that satisfy SmartScreen's
reputation system cost money on an ongoing basis and require an organizational
identity check. For a free, open-source tool we publish the source and let you
build/run it from there if you want to skip the warning entirely. You can also
build the `.exe` yourself from the source bundle and the included
`.github/workflows/build.yml` to confirm exactly what went into it.

---

## 3. macOS Gatekeeper ("app is damaged" / "unidentified developer")

The macOS binaries are **ad-hoc signed** (so they'll launch at all) but not
**notarized** through Apple's paid Developer Program, so Gatekeeper may still warn you.

1. If you see *"cannot be opened because the developer cannot be verified"*:
   - Right-click (or Control-click) the file → **Open** → confirm **Open** in the dialog.
2. If you see *"app is damaged and can't be opened"* (common after downloading via a browser
   that strips/quarantines the file), clear the quarantine flag yourself:
   ```
   xattr -d com.apple.quarantine bedrock2java-macos-arm64
   ```
   Then run it normally.

---

## 4. Antivirus / Windows Defender flags the binary

Standalone executables built by bundling Node.js into a single file (which is how
the `windows-x64`/`linux-x64`/`macos-*` binaries are built) are occasionally flagged
as suspicious by antivirus heuristics — this is a well-known **false positive
pattern** for this kind of packaging, not specific to this project.

What to do:
- Compare the file's SHA-256 checksum against the `.sha256` file published in the
  same release (Section 1). If it matches, the file is exactly what our GitHub
  Actions build produced from the public source — nothing was substituted.
- If your antivirus still blocks it and you want to be extra cautious, use
  **Option A (source bundle)** instead — there is no compiled binary involved at all,
  so there's nothing for a heuristic scanner to flag.
- If you want to verify the binary yourself, the build workflow
  (`.github/workflows/build.yml`) is public — you can re-run the exact same build
  from source and compare results.

---

## 5. Building the actual Java `.jar` (Java/Gradle errors)

This CLI generates a **buildable Java Fabric mod project** — it does not compile
the final `.jar` itself, because that requires a JDK and internet access to fetch
the Minecraft/Fabric toolchain (something this CLI can't assume you want it to do
automatically).

After running the CLI, build the jar yourself:

```
cd <your output folder>
./gradlew build        # Linux/macOS
.\gradlew.bat build    # Windows
```

The `.jar` will appear in `build/libs/`.

### Common errors and fixes

**`'java' is not recognized` / `JAVA_HOME is not set`**
You need a JDK installed (not just a JRE). Install **Eclipse Temurin JDK 21**
(or any JDK 21 distribution), then make sure `java -version` works in a fresh
terminal. On Windows, you may need to set `JAVA_HOME` in System Environment Variables
and restart your terminal afterward.

**`Permission denied` running `./gradlew` (Linux/macOS)**
The executable bit didn't survive the zip download. Fix it with:
```
chmod +x gradlew
```

**Gradle hangs or fails downloading dependencies**
`./gradlew build` needs internet access the first time, to download the Fabric
Loom plugin and Minecraft/Yarn mappings. If you're behind a restrictive firewall
or proxy, configure Gradle's proxy settings in `gradle.properties`, or run the
build somewhere with normal internet access.

**Wrong Java version (`Unsupported class file major version` or similar)**
Minecraft 1.21.x / Fabric Loom requires **Java 21** specifically. If you have
multiple JDKs installed, make sure `JAVA_HOME` (and the `java` on your `PATH`)
points at the JDK 21 install, not an older or newer one.

**Build succeeds but the jar crashes / has missing classes in-game**
Open `conversion-log.md` in your output folder — anything marked `NEEDS_REVIEW`
or `ERROR` was *not* fully automated (entity AI, scripting logic, world generation,
etc.) and still needs to be written by hand. Paste the relevant section of that
log, plus the referenced original Bedrock file, to a Java/Fabric developer or an
AI coding assistant to finish it.

---

## 6. Reporting a problem

If something in this guide doesn't match what you're seeing, open an issue with:
- Your OS and which release asset you downloaded
- The exact error text or a screenshot
- The relevant section of `conversion-log.md`, if it's a conversion problem rather
  than a download/run problem
