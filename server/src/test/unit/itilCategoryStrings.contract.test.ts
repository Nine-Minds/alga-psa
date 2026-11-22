import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T100 — F054 of `ee/plans/2026-11-21-itil-remediation` (`category-rules`).
 *
 * The category strings are new, so every locale has to carry them: one missing key leaves an admin
 * reading a raw translation id at the moment a category refuses to save. The glossary and register
 * gates themselves run in `npm run test:i18n`; this file is the per-key presence check and the
 * kebab-case id check for the new controls.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES_DIR = path.resolve(REPO_ROOT, 'server/public/locales');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function at(value: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((node, key) => (node == null ? node : node[key]), value);
}

const NEW_KEYS: Array<{ namespace: string; key: string }> = [
  { namespace: 'features/tickets', key: 'settings.categories.standardBadge' },
  { namespace: 'features/tickets', key: 'settings.categories.itilBoardNotice' },
  { namespace: 'features/tickets', key: 'errors.category.standardLocked' },
  { namespace: 'features/tickets', key: 'errors.category.itilBoardOwnsItsSet' },
  { namespace: 'features/tickets', key: 'importDialog.resolve.itilCategoryCreateDisabled' },
];

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('ITIL category strings', () => {
  it('T100: every locale, including the pseudo-locales, carries each new key', () => {
    expect(locales).toContain('en');
    expect(locales.length).toBeGreaterThanOrEqual(10);

    for (const locale of locales) {
      for (const { namespace, key } of NEW_KEYS) {
        const file = path.resolve(LOCALES_DIR, locale, `${namespace}.json`);
        const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
        const value = at(bundle, key);
        expect(typeof value, `${locale}/${namespace} ${key}`).toBe('string');
        expect((value as string).trim().length, `${locale}/${namespace} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  // `Standard` is the same word in several of these locales, so it is checked for presence only.
  const SAME_WORD_IN_SOME_LOCALES = new Set(['settings.categories.standardBadge']);

  it('T100: no new string is left as an untranslated copy of the English one', () => {
    const english = Object.fromEntries(
      NEW_KEYS.map(({ namespace, key }) => [
        `${namespace}:${key}`,
        at(JSON.parse(fs.readFileSync(path.resolve(LOCALES_DIR, 'en', `${namespace}.json`), 'utf8')), key),
      ])
    );

    for (const locale of locales.filter((name) => !['en', 'xx', 'yy'].includes(name))) {
      for (const { namespace, key } of NEW_KEYS) {
        if (SAME_WORD_IN_SOME_LOCALES.has(key)) continue;
        const bundle = JSON.parse(
          fs.readFileSync(path.resolve(LOCALES_DIR, locale, `${namespace}.json`), 'utf8')
        );
        expect(at(bundle, key), `${locale}/${namespace} ${key}`).not.toBe(english[`${namespace}:${key}`]);
      }
    }
  });

  it('T100: the refusals carry their translation keys, and the new control a kebab-case id', () => {
    const actions = source('packages/tickets/src/actions/ticketCategoryActions.ts');
    expect(actions).toContain("'features/tickets:errors.category.standardLocked'");
    expect(actions).toContain("'features/tickets:errors.category.itilBoardOwnsItsSet'");
    expect(source('packages/tickets/src/components/settings/CategoriesSettings.tsx')).toContain(
      'id="itil-board-categories-notice"'
    );
  });
});
