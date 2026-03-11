#!/usr/bin/env node

/**
 * Generate pseudo-locale files for visual QA testing.
 *
 * Reads every English translation JSON file and produces matching files
 * for the xx and yy pseudo-locales with all leaf values replaced by a
 * fill string.  {{interpolation}} tokens are preserved so i18next can
 * still substitute variables at runtime.
 *
 * Usage:
 *   node scripts/generate-pseudo-locales.js
 *
 * Re-run after adding or changing any English namespace file.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../server/public/locales');
const EN_DIR = path.join(LOCALES_DIR, 'en');

const PSEUDO_LOCALES = {
  xx: '11111',
  yy: '55555',
};

function replaceValues(obj, fill) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out[key] = replaceValues(value, fill);
    } else if (typeof value === 'string') {
      // Preserve {{variable}} tokens
      const vars = value.match(/\{\{.*?\}\}/g);
      if (vars) {
        out[key] = vars.map((v) => `${fill} ${v}`).join(' ') + ` ${fill}`;
      } else {
        out[key] = fill;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

const enFiles = walkDir(EN_DIR);
let totalFiles = 0;

for (const enFile of enFiles) {
  const rel = path.relative(EN_DIR, enFile);
  const data = JSON.parse(fs.readFileSync(enFile, 'utf8'));

  for (const [locale, fill] of Object.entries(PSEUDO_LOCALES)) {
    const outFile = path.join(LOCALES_DIR, locale, rel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const pseudo = replaceValues(data, fill);
    fs.writeFileSync(outFile, JSON.stringify(pseudo, null, 2) + '\n', 'utf8');
    totalFiles++;
  }
}

console.log(`Generated ${totalFiles} pseudo-locale files from ${enFiles.length} English sources.`);
