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

const PSEUDO_LOCALES = {
  xx: { open: '⟦', close: '⟧', expand: 0 },
  yy: { open: '〖', close: '〗', expand: 0.4 },
};

const ACCENTS = {
  a: 'ȧ', b: 'ƀ', c: 'ƈ', d: 'ḓ', e: 'ḗ', f: 'ƒ', g: 'ɠ', h: 'ħ', i: 'ī',
  j: 'ĵ', k: 'ķ', l: 'ŀ', m: 'ḿ', n: 'ƞ', o: 'ȯ', p: 'ƥ', q: 'ʠ', r: 'ř',
  s: 'ş', t: 'ŧ', u: 'ŭ', v: 'ṽ', w: 'ẇ', x: 'ẋ', y: 'ẏ', z: 'ẑ',
  A: 'Ȧ', B: 'Ɓ', C: 'Ƈ', D: 'Ḓ', E: 'Ḗ', F: 'Ƒ', G: 'Ɠ', H: 'Ħ', I: 'Ī',
  J: 'Ĵ', K: 'Ķ', L: 'Ŀ', M: 'Ḿ', N: 'Ƞ', O: 'Ȯ', P: 'Ƥ', Q: 'Ɋ', R: 'Ř',
  S: 'Ş', T: 'Ŧ', U: 'Ŭ', V: 'Ṽ', W: 'Ẇ', X: 'Ẋ', Y: 'Ẏ', Z: 'Ẑ',
};

// {{variable}} tokens and <strong>/<1> markup must survive verbatim.
const PROTECTED = /(\{\{[^}]*\}\}|<\/?[^<>]+>)/g;

function accent(text) {
  let out = '';
  for (const char of text) {
    out += ACCENTS[char] ?? char;
  }
  return out;
}

function pseudoString(value, { open, close, expand }) {
  if (!value.trim()) return value;

  const body = value
    .split(PROTECTED)
    .map((segment, index) => (index % 2 === 1 ? segment : accent(segment)))
    .join('');

  const padding = expand ? ` ${'·'.repeat(Math.ceil(value.length * expand))}` : '';
  return `${open}${body}${padding}${close}`;
}

function replaceValues(input, style) {
  if (typeof input === 'string') return pseudoString(input, style);
  if (Array.isArray(input)) return input.map((entry) => replaceValues(entry, style));
  if (input && typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = replaceValues(value, style);
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

const enFiles = walkDir(EN_DIR);
let totalFiles = 0;

for (const enFile of enFiles) {
  const rel = path.relative(EN_DIR, enFile);
  const data = JSON.parse(fs.readFileSync(enFile, 'utf8'));

  for (const [locale, style] of Object.entries(PSEUDO_LOCALES)) {
    const outFile = path.join(LOCALES_DIR, locale, rel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const pseudo = replaceValues(data, style);
    fs.writeFileSync(outFile, JSON.stringify(pseudo, null, 2) + '\n', 'utf8');
    totalFiles++;
  }
}

console.log(`Generated ${totalFiles} pseudo-locale files from ${enFiles.length} English sources.`);
