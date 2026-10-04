// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PSEUDO_LOCALES, pseudoString } from '../../../../../tools/i18n/lib/pseudo-locale.mjs';

// The xx/yy namespaces are generated from the English sources by
// scripts/generate-pseudo-locales.cjs and must never be hand-edited. Several
// suites run that generator in-process, so a hand-edited or stale pseudo file
// rewrites the checkout mid-run and the unit shard fails its
// working-tree-clean gate instead of naming the offending namespace. Compare
// the checked-in bytes against the generator's output here so the staleness
// reports itself, without writing anything.

const repoRoot = path.resolve(__dirname, '../../../../..');
const localesRoot = path.join(repoRoot, 'server/public/locales');
const englishRoot = path.join(localesRoot, 'en');

const collectJsonFiles = (dir: string, baseDir = dir): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJsonFiles(full, baseDir);
    return entry.name.endsWith('.json') ? [path.relative(baseDir, full)] : [];
  });

// Mirrors replaceValues() in scripts/generate-pseudo-locales.cjs.
const toPseudo = (input: unknown, locale: string): unknown => {
  if (typeof input === 'string') return pseudoString(input, locale);
  if (Array.isArray(input)) return input.map((entry) => toPseudo(entry, locale));
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, toPseudo(value, locale)]),
    );
  }
  return input;
};

const englishFiles = collectJsonFiles(englishRoot);
const pseudoLocales = Object.keys(PSEUDO_LOCALES);

describe('checked-in pseudo-locales match the generator', () => {
  it('has English sources and both pseudo-locales to compare', () => {
    expect(englishFiles.length).toBeGreaterThan(0);
    expect(pseudoLocales).toEqual(['xx', 'yy']);
  });

  it.each(pseudoLocales)('%s namespaces are exactly what generate-pseudo-locales.cjs produces', (locale) => {
    const stale: string[] = [];
    const missing: string[] = [];

    for (const relativePath of englishFiles) {
      const pseudoFile = path.join(localesRoot, locale, relativePath);
      if (!fs.existsSync(pseudoFile)) {
        missing.push(relativePath);
        continue;
      }
      const english = JSON.parse(fs.readFileSync(path.join(englishRoot, relativePath), 'utf8'));
      const expected = `${JSON.stringify(toPseudo(english, locale), null, 2)}\n`;
      if (fs.readFileSync(pseudoFile, 'utf8') !== expected) stale.push(relativePath);
    }

    expect(
      { missing, stale },
      `run "node scripts/generate-pseudo-locales.cjs" and commit the result`,
    ).toEqual({ missing: [], stale: [] });
  });

  it.each(pseudoLocales)('%s has no namespace without an English source', (locale) => {
    const orphans = collectJsonFiles(path.join(localesRoot, locale))
      .filter((relativePath) => !englishFiles.includes(relativePath));

    expect(orphans).toEqual([]);
  });
});
