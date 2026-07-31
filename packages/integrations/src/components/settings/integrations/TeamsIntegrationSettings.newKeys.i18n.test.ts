import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const localesRoot = path.resolve(repoRoot, 'server/public/locales');

// New sub-trees added for the Teams production-readiness admin UI (E6/E7).
const NEW_SETTINGS_SUBTREES = [
  'wizard',
  'runbook',
  'deliveryLog',
  'auditLog',
  'troubleshooting',
  'paywall',
  'addonExpiredBanner',
  'staleManifest',
] as const;

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

function readSettings(locale: string): Record<string, unknown> {
  const file = path.resolve(localesRoot, locale, 'msp/integrations.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
  return json.integrations.teams.settings;
}

function leafKeys(node: unknown, prefix: string): string[] {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe('Teams production-readiness i18n coverage (E6/E7)', () => {
  const enSettings = readSettings('en');
  const expectedKeys = NEW_SETTINGS_SUBTREES.flatMap((subtree) =>
    leafKeys(enSettings[subtree], subtree),
  );

  it('English defines all new sub-trees', () => {
    for (const subtree of NEW_SETTINGS_SUBTREES) {
      expect(enSettings[subtree], `en is missing settings.${subtree}`).toBeTruthy();
    }
    expect(expectedKeys.length).toBeGreaterThan(50);
  });

  it('every locale defines the same new keys as non-empty strings', () => {
    for (const locale of LOCALES) {
      const settings = readSettings(locale);
      for (const key of expectedKeys) {
        const value = key.split('.').reduce<unknown>((acc, seg) => {
          if (acc && typeof acc === 'object' && seg in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[seg];
          }
          return undefined;
        }, settings);
        expect(typeof value, `${locale} missing settings.${key}`).toBe('string');
        expect((value as string).length, `${locale} empty settings.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
