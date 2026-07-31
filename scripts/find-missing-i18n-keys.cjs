#!/usr/bin/env node

/**
 * Scan TS/TSX sources for t('key', ...) calls and report keys whose namespace
 * cannot resolve them in the English locale tree.
 *
 * Heuristics:
 *  - For each .ts/.tsx file with a `useTranslation('<ns>')` call, capture the
 *    namespace and any subsequent `t('foo.bar')` / `t("foo.bar")` calls.
 *  - Resolve `<ns>` against server/public/locales/en/<ns>.json. If the dotted
 *    key is missing, print the file:line:key.
 *
 * Usage:
 *   node scripts/find-missing-i18n-keys.cjs [path ...]
 *   defaults to scanning the workspace.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LOCALES = path.join(REPO, 'server/public/locales/en');

const args = process.argv.slice(2);
const SCAN_ROOTS = args.length
  ? args.map((p) => path.resolve(p))
  : [
      path.join(REPO, 'server/src'),
      path.join(REPO, 'packages'),
      path.join(REPO, 'ee/server/src'),
    ];

const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.turbo', 'coverage',
]);

// Test files assert on key strings (contract tests grep source for t('…')
// literals) without being runtime translation calls — skip them.
const RE_TEST_FILE = /(\.test\.|\.spec\.|\/__tests__\/|\/src\/test\/)/;

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.tsx?$/.test(target) && !/\.d\.ts$/.test(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const localeCache = new Map();
function loadLocale(ns) {
  if (localeCache.has(ns)) return localeCache.get(ns);
  const file = path.join(LOCALES, `${ns}.json`);
  let data = null;
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { data = null; }
  }
  localeCache.set(ns, data);
  return data;
}

function hasKey(obj, dotted) {
  if (!obj) return false;
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return false;
  }
  // Leaf must be a string (or array, occasionally) — not an unresolved branch.
  return typeof cur === 'string' || Array.isArray(cur);
}

// i18next v4 stores count-based keys with CLDR plural suffixes; a t('key',
// { count }) call resolves via key_one/key_other/…, so accept those too.
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
function resolvesKey(obj, dotted) {
  if (hasKey(obj, dotted)) return true;
  return PLURAL_SUFFIXES.some((s) => hasKey(obj, `${dotted}_${s}`));
}

const RE_USE_TRANSLATION = /useTranslation\(\s*['"`]([^'"`]+)['"`]/g;
// t('key'…) or t("key"…) — skip template strings (dynamic keys).
const RE_T_CALL = /(?<![A-Za-z0-9_$])t\(\s*['"]([^'"]+)['"]/g;

const findings = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    if (RE_TEST_FILE.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('useTranslation') && !/(?<![A-Za-z0-9_$])t\(/.test(src)) continue;

    // Collect namespaces declared in this file.
    const nsList = [];
    let m;
    RE_USE_TRANSLATION.lastIndex = 0;
    while ((m = RE_USE_TRANSLATION.exec(src))) nsList.push(m[1]);
    if (!nsList.length) continue;

    // Collect t() keys with line numbers.
    RE_T_CALL.lastIndex = 0;
    while ((m = RE_T_CALL.exec(src))) {
      const key = m[1];
      // Skip obvious non-i18n calls: keys with whitespace or no dots and short.
      if (!/^[A-Za-z0-9_.:-]+$/.test(key)) continue;
      // Skip trailing-dot prefixes (dynamic keys / contract-test assertions).
      if (key.endsWith('.')) continue;
      const before = src.slice(0, m.index);
      const line = before.split('\n').length;

      // Try every namespace declared in the file; pass if any resolves.
      const resolved = nsList.some((ns) => resolvesKey(loadLocale(ns), key));
      if (!resolved) {
        findings.push({ file: path.relative(REPO, file), line, key, namespaces: nsList });
      }
    }
  }
}

if (!findings.length) {
  console.log('No missing English keys detected.');
  process.exit(0);
}

// Group by (namespace,key) for a clean summary.
const byKey = new Map();
for (const f of findings) {
  const id = `${f.namespaces.join('|')}::${f.key}`;
  if (!byKey.has(id)) byKey.set(id, { ...f, refs: [] });
  byKey.get(id).refs.push(`${f.file}:${f.line}`);
}

console.log(`Missing English locale keys: ${byKey.size}\n`);
const sorted = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
for (const f of sorted) {
  console.log(`  [${f.namespaces.join(', ')}] ${f.key}`);
  for (const ref of f.refs.slice(0, 3)) console.log(`      ${ref}`);
  if (f.refs.length > 3) console.log(`      … ${f.refs.length - 3} more`);
}

process.exit(1);
