'use strict';
const fs = require('fs');
const path = require('path');

class ConversionLogger {
  constructor(outputDir) {
    this.entries = [];
    this.outputDir = outputDir;
    this.startTime = new Date();
  }

  log(level, category, message, detail) {
    this.entries.push({
      time: new Date().toISOString(),
      level, // INFO | OK | WARN | ERROR | NEEDS_REVIEW
      category,
      message,
      detail: detail || null
    });
  }

  info(category, message, detail) { this.log('INFO', category, message, detail); }
  ok(category, message, detail) { this.log('OK', category, message, detail); }
  warn(category, message, detail) { this.log('WARN', category, message, detail); }
  error(category, message, detail) { this.log('ERROR', category, message, detail); }
  needsReview(category, message, detail) { this.log('NEEDS_REVIEW', category, message, detail); }

  counts() {
    const out = { INFO: 0, OK: 0, WARN: 0, ERROR: 0, NEEDS_REVIEW: 0 };
    for (const e of this.entries) out[e.level] = (out[e.level] || 0) + 1;
    return out;
  }

  write(logFileName = 'conversion-log.md') {
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, logFileName);
    const counts = this.counts();
    const lines = [];

    lines.push('# Bedrock -> Java Conversion Log');
    lines.push('');
    lines.push(`Generated: ${this.startTime.toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- OK: ${counts.OK}`);
    lines.push(`- INFO: ${counts.INFO}`);
    lines.push(`- WARN: ${counts.WARN}`);
    lines.push(`- ERROR: ${counts.ERROR}`);
    lines.push(`- NEEDS_REVIEW (manual Java coding required): ${counts.NEEDS_REVIEW}`);
    lines.push('');
    lines.push(
      '> Entries marked `NEEDS_REVIEW` or `ERROR` could not be fully automated. ' +
        'Paste those sections (or this whole file) to a Java/Forge/Fabric developer, or to an AI assistant, ' +
        'along with the referenced source file, to finish the conversion by hand.'
    );
    lines.push('');
    lines.push('## Entries');
    lines.push('');

    for (const e of this.entries) {
      lines.push(`### [${e.level}] ${e.category} — ${e.message}`);
      lines.push(`- time: ${e.time}`);
      if (e.detail) {
        lines.push('```');
        lines.push(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail, null, 2));
        lines.push('```');
      }
      lines.push('');
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return filePath;
  }
}

module.exports = { ConversionLogger };
