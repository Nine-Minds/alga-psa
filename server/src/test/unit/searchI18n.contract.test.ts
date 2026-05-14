import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SEARCH_OBJECT_TYPES } from '../../lib/search/types';

function readCoreLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `public/locales/${locale}/msp/core.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectLeafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('app-wide search i18n contracts', () => {
  it('T147 defines the required English msp/core search keys', () => {
    const core = readCoreLocale('en');
    const requiredLeafKeys = [
      'search.placeholder',
      'search.shortcutHint',
      'search.loading',
      'search.pageTitle',
      'search.helperText',
      'search.resultSummary',
      'search.resultsRegionLabel',
      'search.filtersLabel',
      'search.sortLabel',
      'search.paginationLabel',
      'search.seeAllResults',
      'search.noResults',
      'search.emptyBroadenQuery',
      'search.emptyRemoveFilter',
      'search.error',
      'search.filters.all',
      'search.sort.relevance',
      'search.sort.recent',
      'search.pagination.previous',
      'search.pagination.next',
    ];

    for (const key of requiredLeafKeys) {
      expect(getPath(core, key), key).toEqual(expect.any(String));
      expect(getPath(core, key), key).not.toBe('');
    }

    for (const type of SEARCH_OBJECT_TYPES) {
      expect(getPath(core, `search.filters.${type}`), `filter ${type}`).toEqual(expect.any(String));
      expect(getPath(core, `search.groups.${type}`), `group ${type}`).toEqual(expect.any(String));
    }
  });

  it('T148 keeps the search namespace key-complete across every locale', () => {
    const localesRoot = resolve(process.cwd(), 'public/locales');
    const locales = readdirSync(localesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const english = readCoreLocale('en');
    const englishSearch = getPath(english, 'search');
    const expectedSearchKeys = collectLeafPaths(englishSearch);

    for (const locale of locales) {
      const core = readCoreLocale(locale);
      const search = getPath(core, 'search');
      expect(collectLeafPaths(search), locale).toEqual(expectedSearchKeys);
    }
  });
});
