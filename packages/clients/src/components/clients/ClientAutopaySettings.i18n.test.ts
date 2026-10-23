// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.resolve(__dirname, '../../../../../server/public/locales');
const TRANSLATED_LOCALES = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt'];

function readClients(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'msp/clients.json'), 'utf8'));
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
}

describe('ClientAutopaySettings i18n', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'ClientAutopaySettings.tsx'), 'utf8');
  const usedKeys = [...new Set([...source.matchAll(/t\('(clientAutopay\.[\w.]+)'/g)].map((match) => match[1]))];
  const en = readClients('en');

  it('resolves every clientAutopay key the component uses in English and every translated locale', () => {
    expect(usedKeys.length).toBeGreaterThan(10);
    for (const locale of ['en', ...TRANSLATED_LOCALES]) {
      const catalog = locale === 'en' ? en : readClients(locale);
      for (const key of usedKeys) {
        const value = getLeaf(catalog, key);
        expect(typeof value === 'string' && value.length > 0, `${locale}: ${key}`).toBe(true);
        expect(placeholders(value as string), `${locale}: ${key} placeholders`).toEqual(
          placeholders(getLeaf(en, key) as string),
        );
      }
    }
  });

  it('keeps every English msp/clients key in each translated locale', () => {
    // A main merge once resolved these files to the branch side and silently
    // dropped keys other features had added upstream.
    const enKeys = leafPaths(en);
    for (const locale of TRANSLATED_LOCALES) {
      const catalog = readClients(locale);
      const missing = enKeys.filter((key) => typeof getLeaf(catalog, key) !== 'string');
      expect(missing, locale).toEqual([]);
    }
  });
});
