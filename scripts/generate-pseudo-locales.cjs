#!/usr/bin/env node

/**
 * Generate pseudo-locale files for visual QA testing.
 *
 * Reads every English translation JSON file and produces matching files for
 * the xx and yy pseudo-locales.  Each leaf value is accented character by
 * character and wrapped in locale-specific markers, so a pseudo string stays
 * readable, stays unique, and is impossible to mistake for real English.
 *
 *   "Save changes"  ->  xx: "⟦Şȧṽḗ ƈħȧƞɠḗş⟧"
 *                       yy: "〖Şȧṽḗ ƈħȧƞɠḗş····〗"
 *
 * Why not a single fill string: identical values collide when a component
 * uses a translated label as a React key, which corrupts sibling lists, and
 * an opaque fill hides which string is which during QA.
 *
 * Untranslated (hardcoded) UI still stands out — it renders as plain English
 * with no markers.  yy additionally pads to ~40% extra width to surface
 * layout truncation.  {{interpolation}} tokens and <tags> are passed through
 * untouched so i18next and <Trans> keep working.
 *
 * The transform itself lives in tools/i18n/lib/pseudo-locale.mjs, which the
 * tests assert against.
 *
 * Usage:
 *   node scripts/generate-pseudo-locales.cjs
 *
 * Re-run after adding or changing any English namespace file.  Never hand-edit
 * the xx/yy files.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../server/public/locales');
const EN_DIR = path.join(LOCALES_DIR, 'en');

function replaceValues(input, pseudoString, locale) {
  if (typeof input === 'string') return pseudoString(input, locale);
  if (Array.isArray(input)) return input.map((entry) => replaceValues(entry, pseudoString, locale));
  if (input && typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = replaceValues(value, pseudoString, locale);
    }
    return out;
  }
  return input;
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

async function main() {
  const { PSEUDO_LOCALES, pseudoString } = await import(
    require('url').pathToFileURL(path.resolve(__dirname, '../tools/i18n/lib/pseudo-locale.mjs')).href
  );

  const enFiles = walkDir(EN_DIR);
  let totalFiles = 0;

  for (const enFile of enFiles) {
    const rel = path.relative(EN_DIR, enFile);
    const data = JSON.parse(fs.readFileSync(enFile, 'utf8'));

    for (const locale of Object.keys(PSEUDO_LOCALES)) {
      const outFile = path.join(LOCALES_DIR, locale, rel);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      const pseudo = replaceValues(data, pseudoString, locale);
      fs.writeFileSync(outFile, JSON.stringify(pseudo, null, 2) + '\n', 'utf8');
      totalFiles++;
    }
  }

  console.log(`Generated ${totalFiles} pseudo-locale files from ${enFiles.length} English sources.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
