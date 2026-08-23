import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every translation key referenced in code must exist in the English pack.
 *
 * validate-translations.cjs compares the locale packs against each other, so a
 * key that is missing from `en` too leaves the packs in perfect parity and
 * passes. Those keys fall through to their inline `defaultValue`, which renders
 * English in every locale and is invisible to a pack-parity check — how the
 * three inventory report cards shipped untranslated in all ten locales.
 */

const repoRoot = path.resolve(process.cwd(), '..');
const englishPack = path.join(repoRoot, 'server/public/locales/en');

// Roots that render UI. Server actions and lib code are scanned too when they
// sit under these trees; they simply contribute no namespaces and drop out.
const SCAN_ROOTS = [
  'server/src/app',
  'ee/server/src/app',
  'server/src/components',
  'packages',
];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__']);

// The namespaces a file translates against, from either the client hook or the
// server helper. Both accept a single namespace or an array of them — an
// unprefixed key resolves against the first entry and falls back through the
// rest — so the array form has to be read as a whole. A file with no namespace
// is not doing i18n and is skipped.
const NAMESPACE_RE = /(?:useTranslation|getServerTranslation)\(\s*(?:undefined\s*,\s*)?(\[[^\]]*\]|'[^']+')/g;
const QUOTED_RE = /'([^']+)'/g;

// Direct calls: t('some.key').
const DIRECT_KEY_RE = /\bt\(\s*'([^']+)'/g;

// Indirect references: catalogs that store a key in a `*Key` field and feed it
// to t() later — `titleKey`, `descriptionKey`, `labelKey`. Requiring a dotted
// key keeps table-column definitions (`key: 'age'`) out.
const INDIRECT_KEY_RE = /\b\w*Key\s*:\s*'([^']+\.[^']+)'/g;

// i18next appends a plural category to the looked-up key, so the bare key need
// not exist on its own.
const PLURAL_SUFFIXES = ['', '_one', '_other', '_zero', '_two', '_few', '_many'];

const packCache = new Map<string, Record<string, unknown> | null>();

function loadPack(namespace: string): Record<string, unknown> | null {
  if (!packCache.has(namespace)) {
    const file = path.join(englishPack, `${namespace}.json`);
    packCache.set(
      namespace,
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
    );
  }
  return packCache.get(namespace) ?? null;
}

function lookup(pack: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey
    .split('.')
    .reduce<unknown>((node, segment) => {
      if (node === null || typeof node !== 'object') return undefined;
      return (node as Record<string, unknown>)[segment];
    }, pack);
}

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(entryPath, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      found.push(entryPath);
    }
  }

  return found;
}

interface Unresolved {
  file: string;
  key: string;
  namespaces: string[];
}

function findUnresolvedKeys(root: string): { checked: number; unresolved: Unresolved[] } {
  const unresolved: Unresolved[] = [];
  let checked = 0;

  for (const file of collectSourceFiles(path.join(repoRoot, root))) {
    const source = fs.readFileSync(file, 'utf8');

    const namespaces = [...source.matchAll(NAMESPACE_RE)].flatMap((match) =>
      [...match[1].matchAll(QUOTED_RE)].map((quoted) => quoted[1]),
    );
    const packs = namespaces.map(loadPack).filter((pack): pack is Record<string, unknown> => !!pack);
    if (packs.length === 0) continue;

    const keys = [
      ...[...source.matchAll(DIRECT_KEY_RE)].map((match) => match[1]),
      ...[...source.matchAll(INDIRECT_KEY_RE)].map((match) => match[1]),
    ];

    for (const key of keys) {
      // Interpolated and namespace-prefixed keys resolve at runtime against a
      // pack this file never names, so they are out of reach of a static check.
      if (key.includes('{{') || key.includes(':')) continue;

      checked++;
      const resolves = packs.some((pack) =>
        PLURAL_SUFFIXES.some((suffix) => lookup(pack, key + suffix) !== undefined),
      );

      if (!resolves) {
        unresolved.push({ file: path.relative(repoRoot, file), key, namespaces });
      }
    }
  }

  return { checked, unresolved };
}

describe('translation key resolution', () => {
  it.each(SCAN_ROOTS)('every key referenced under %s exists in the English pack', (root) => {
    const { checked, unresolved } = findUnresolvedKeys(root);

    expect(
      unresolved,
      unresolved.length === 0
        ? ''
        : `${unresolved.length} of ${checked} keys under ${root} resolve to nothing in the English pack, ` +
          `so they render their inline defaultValue in every locale:\n` +
          unresolved
            .map((miss) => `  ${miss.file}\n    ${miss.key}  [namespaces: ${miss.namespaces.join(', ')}]`)
            .join('\n'),
    ).toEqual([]);
  });

  it('actually inspects a meaningful number of keys', () => {
    // Guards the scan itself: a regex or path change that quietly matches
    // nothing would otherwise leave every assertion above trivially green.
    const total = SCAN_ROOTS.reduce((sum, root) => sum + findUnresolvedKeys(root).checked, 0);
    expect(total).toBeGreaterThan(10_000);
  });
});
