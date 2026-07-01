'use strict';
// Minimal dependency-free ZIP extractor.
// Supports STORE (0) and DEFLATE (8) compression methods, which covers
// every .zip/.mcaddon/.mcpack produced by normal tooling (Explorer, Finder,
// 7-Zip, Bedrock's own packer, etc).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEOCD(buf) {
  // EOCD is at the end of the file, with a variable-length comment after it (max 65535 bytes).
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a valid ZIP file (no End Of Central Directory record found).');
}

function readEntries(buf) {
  const eocdPos = findEOCD(buf);
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  let cenOffset = buf.readUInt32LE(eocdPos + 16);

  const entries = [];
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cenOffset) !== CEN_SIG) break;
    const compMethod = buf.readUInt16LE(cenOffset + 10);
    const compSize = buf.readUInt32LE(cenOffset + 20);
    const uncompSize = buf.readUInt32LE(cenOffset + 24);
    const nameLen = buf.readUInt16LE(cenOffset + 28);
    const extraLen = buf.readUInt16LE(cenOffset + 30);
    const commentLen = buf.readUInt16LE(cenOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cenOffset + 42);
    const name = buf.toString('utf8', cenOffset + 46, cenOffset + 46 + nameLen);

    entries.push({ name, compMethod, compSize, uncompSize, localHeaderOffset });
    cenOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const off = entry.localHeaderOffset;
  if (buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error(`Corrupt ZIP entry: ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const compData = buf.subarray(dataStart, dataStart + entry.compSize);

  if (entry.compMethod === 0) return compData;
  if (entry.compMethod === 8) return zlib.inflateRawSync(compData);
  throw new Error(`Unsupported ZIP compression method (${entry.compMethod}) for entry: ${entry.name}`);
}

// Extracts a .zip/.mcaddon/.mcpack file to destDir. Returns destDir.
function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = readEntries(buf);

  for (const entry of entries) {
    const safeName = entry.name.replace(/\\/g, '/');
    if (safeName.includes('..')) continue; // zip-slip protection
    const outPath = path.join(destDir, safeName);

    if (safeName.endsWith('/')) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const data = extractEntry(buf, entry);
    fs.writeFileSync(outPath, data);
  }
  return destDir;
}

function isArchive(p) {
  return /\.(zip|mcaddon|mcpack)$/i.test(p);
}

module.exports = { extractZip, isArchive };
