#!/usr/bin/env node

/**
 * Validate that all locale translation files have the same keys as English.
 *
 * Checks:
 * 1. Every non-English locale has the same files as English
 * 2. Every file has identical key structure (nested paths)
 * 3. No extra keys in non-English files
 * 4. No missing keys in non-English files
 * 5. All {{variables}} from English are preserved
 * 6. Valid JSON syntax
 *
 * Exit code 0 = pass, 1 = failures found.
 *
 * Usage:
 *   node scripts/validate-translations.cjs
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../server/public/locales');
const REFERENCE_LOCALE = 'en';

const PSEUDO_LOCALES = ['xx', 'yy'];
const PSEUDO_FILLS = { xx: '11111', yy: '55555' };

let errorCount = 0;
let warnCount = 0;

function error(msg) {
  console.error(`  ERROR: ${msg}`);
  errorCount++;
}

function warn(msg) {
  console.warn(`  WARN:  ${msg}`);
  warnCount++;
}

/**
 * Recursively collect all leaf key paths from a nested object.
 * Returns a Map of dotted-path -> value.
 */
function collectKeys(obj, prefix = '') {
  const map = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [k, v] of collectKeys(value, fullKey)) {
        map.set(k, v);
      }
    } else {
      map.set(fullKey, value);
    }
  }
  return map;
}

/**
 * Extract simple {{variable}} tokens from a string.
 * Ignores i18next plural/formatting syntax like {{count, plural, ...}}.
 */
function extractVars(str) {
  if (typeof str !== 'string') return [];
  const matches = str.match(/\{\{[^}]*\}\}/g);
  if (!matches) return [];
  // Keep only simple variable tokens (no commas = no i18next formatting syntax)
  return matches.filter((m) => !m.includes(',')).sort();
}

/**
 * Recursively find all JSON files relative to a base directory.
 */
function walkJson(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJson(full, base));
    } else if (entry.name.endsWith('.json')) {
      results.push(path.relative(base, full));
    }
  }
  return results.sort();
}

// --- Main ---

const enDir = path.join(LOCALES_DIR, REFERENCE_LOCALE);
if (!fs.existsSync(enDir)) {
  console.error(`Reference locale directory not found: ${enDir}`);
  process.exit(1);
}

const enFiles = walkJson(enDir, enDir);
console.log(`Reference locale (${REFERENCE_LOCALE}): ${enFiles.length} files\n`);

// Discover non-English, non-pseudo locales
const realLocales = fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => name !== REFERENCE_LOCALE && !PSEUDO_LOCALES.includes(name))
  .sort();

// Discover pseudo-locales that exist on disk
const presentPseudoLocales = PSEUDO_LOCALES.filter(
  (l) => fs.existsSync(path.join(LOCALES_DIR, l))
);

const allLocales = [...realLocales, ...presentPseudoLocales];

console.log(`Checking locales: ${realLocales.join(', ')}`);
if (presentPseudoLocales.length) {
  console.log(`Checking pseudo-locales: ${presentPseudoLocales.join(', ')} (key structure only)`);
}
console.log('');

for (const locale of allLocales) {
  const isPseudo = PSEUDO_LOCALES.includes(locale);
  console.log(`--- ${locale}${isPseudo ? ' (pseudo)' : ''} ---`);
  const localeDir = path.join(LOCALES_DIR, locale);
  const localeFiles = walkJson(localeDir, localeDir);

  // Check for missing files
  for (const file of enFiles) {
    if (!localeFiles.includes(file)) {
      error(`Missing file: ${file}`);
    }
  }

  // Check for extra files
  for (const file of localeFiles) {
    if (!enFiles.includes(file)) {
      warn(`Extra file not in English: ${file}`);
    }
  }

  // Check each shared file
  for (const file of enFiles) {
    const localeFile = path.join(localeDir, file);
    if (!fs.existsSync(localeFile)) continue;

    // Validate JSON syntax
    let localeData;
    try {
      localeData = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
    } catch (e) {
      error(`${file}: Invalid JSON — ${e.message}`);
      continue;
    }

    const enData = JSON.parse(fs.readFileSync(path.join(enDir, file), 'utf8'));
    const enKeys = collectKeys(enData);
    const localeKeys = collectKeys(localeData);

    // Missing keys
    for (const [key, enValue] of enKeys) {
      if (!localeKeys.has(key)) {
        error(`${file}: Missing key "${key}"`);
      } else if (!isPseudo) {
        // Check {{variables}} are preserved (skip for pseudo-locales)
        const enVars = extractVars(enValue);
        const localeVars = extractVars(localeKeys.get(key));
        if (enVars.length > 0 && JSON.stringify(enVars) !== JSON.stringify(localeVars)) {
          error(`${file}: Key "${key}" — variable mismatch. English: ${enVars.join(', ')} | ${locale}: ${localeVars.join(', ')}`);
        }
      }
    }

    // Extra keys
    for (const key of localeKeys.keys()) {
      if (!enKeys.has(key)) {
        warn(`${file}: Extra key "${key}" not in English`);
      }
    }
  }

  console.log('');
}

// Summary
console.log('=== Summary ===');
console.log(`Locales checked: ${allLocales.length}`);
console.log(`Errors: ${errorCount}`);
console.log(`Warnings: ${warnCount}`);

if (errorCount > 0) {
  console.log('\nFAILED — fix errors above.');
  process.exit(1);
} else {
  console.log('\nPASSED');
  process.exit(0);
}
