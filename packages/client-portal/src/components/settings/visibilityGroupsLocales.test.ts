import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localeRoot = path.resolve(
  __dirname,
  '../../../../../server/public/locales'
);

function loadLocale(locale: string) {
  return JSON.parse(
    fs.readFileSync(path.join(localeRoot, locale, 'client-portal.json'), 'utf8')
  );
}

function collectKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('client portal visibility group locale coverage', () => {
  it('T035: English client portal locale contains every new board-visibility key used by the admin UI', () => {
    const locale = loadLocale('en');
    const visibilityGroups = locale?.clientSettings?.visibilityGroups;

    expect(visibilityGroups).toMatchObject({
      title: 'Visibility Groups',
      description: expect.any(String),
      loadError: expect.any(String),
      empty: expect.any(String),
      deleteDialogTitle: expect.any(String),
      deleteAssignedError: expect.any(String),
      deleteMissingError: expect.any(String),
      assignmentsTitle: expect.any(String),
      assignmentsDescription: expect.any(String),
      fullAccess: expect.any(String),
      assignError: expect.any(String),
    });
  });

  it('T036: non-English client portal locales contain the same visibility-group keys as English', () => {
    const englishKeys = collectKeys(loadLocale('en')?.clientSettings?.visibilityGroups).sort();

    for (const locale of ['de', 'es', 'fr', 'it', 'nl', 'pl', 'xx', 'yy']) {
      const localeKeys = collectKeys(loadLocale(locale)?.clientSettings?.visibilityGroups).sort();
      expect(localeKeys, locale).toEqual(englishKeys);
    }
  });
});
