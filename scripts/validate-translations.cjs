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

const LOCALES_DIR = process.env.LOCALES_DIR
  ? path.resolve(process.env.LOCALES_DIR)
  : path.resolve(__dirname, '../server/public/locales');
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
 * CLDR plural support. i18next v4 stores count-based keys as base_<category>.
 * A locale must provide every category its plural rules produce for integer
 * counts (0..100) — e.g. Polish needs one/few/many — plus 'other', the
 * universal i18next fallback. Categories that only apply to huge numbers
 * (e.g. French 'many' at 1e6) are intentionally not required.
 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function pluralBase(key) {
  const idx = key.lastIndexOf('_');
  if (idx === -1) return null;
  const suffix = key.slice(idx + 1);
  return PLURAL_SUFFIXES.includes(suffix) ? { base: key.slice(0, idx), suffix } : null;
}

const categoriesCache = new Map();
function requiredCategories(locale) {
  if (categoriesCache.has(locale)) return categoriesCache.get(locale);
  let cats = new Set();
  try {
    const pr = new Intl.PluralRules(locale);
    for (let i = 0; i <= 100; i++) cats.add(pr.select(i));
  } catch {
    cats = new Set(['one']);
  }
  cats.add('other');
  categoriesCache.set(locale, cats);
  return cats;
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

    // Plural sets in English: base -> Map(suffix -> value)
    const enPluralSets = new Map();
    for (const [key, value] of enKeys) {
      const p = pluralBase(key);
      if (p) {
        if (!enPluralSets.has(p.base)) enPluralSets.set(p.base, new Map());
        enPluralSets.get(p.base).set(p.suffix, value);
      }
    }

    // Legacy i18next v3 `_plural` keys never resolve under v4 plural mode.
    for (const key of localeKeys.keys()) {
      if (key.endsWith('_plural')) {
        error(`${file}: Legacy "_plural" key "${key}" — migrate to CLDR suffixes (_one/_other/…)`);
      }
    }

    // Missing keys (non-plural English keys compare 1:1)
    for (const [key, enValue] of enKeys) {
      const p = pluralBase(key);
      if (p && enPluralSets.has(p.base)) continue; // handled per plural set below
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

    // Plural sets: the locale must cover its own required CLDR categories.
    const localeCats = requiredCategories(isPseudo ? REFERENCE_LOCALE : locale);
    for (const [base, enForms] of enPluralSets) {
      for (const cat of localeCats) {
        if (!localeKeys.has(`${base}_${cat}`)) {
          error(`${file}: Missing plural form "${base}_${cat}" (required for ${isPseudo ? REFERENCE_LOCALE : locale})`);
        }
      }
      if (isPseudo) continue;
      const enReference = enForms.get('other') ?? [...enForms.values()][0];
      for (const suffix of PLURAL_SUFFIXES) {
        const key = `${base}_${suffix}`;
        if (!localeKeys.has(key)) continue;
        const enVars = extractVars(enForms.get(suffix) ?? enReference);
        const localeVars = extractVars(localeKeys.get(key));
        if (enVars.length > 0 && JSON.stringify(enVars) !== JSON.stringify(localeVars)) {
          error(`${file}: Key "${key}" — variable mismatch. English: ${enVars.join(', ')} | ${locale}: ${localeVars.join(', ')}`);
        }
      }
    }

    // Extra keys (locale-required plural categories are not "extra")
    for (const key of localeKeys.keys()) {
      if (enKeys.has(key)) continue;
      const p = pluralBase(key);
      if (p && enPluralSets.has(p.base)) continue;
      warn(`${file}: Extra key "${key}" not in English`);
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
