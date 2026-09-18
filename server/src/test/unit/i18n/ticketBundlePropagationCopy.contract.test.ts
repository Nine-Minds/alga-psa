import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const locales = ['en', 'de', 'es', 'fr', 'it', 'nl'] as const;

function readLocale(locale: string): Record<string, any> {
  const file = path.join(repoRoot, 'server/public/locales', locale, 'features/tickets.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('ticket bundle status propagation copy contract', () => {
  it('states the propagation behaviour in the bundle help and master panel for all six locales', () => {
    const english = readLocale('en');
    const expectedEnglish =
      'Children keep their current status when bundled. Afterwards, closing or reopening the master closes or reopens all children';

    expect(english.bulk.bundleSyncUpdatesHelp).toContain(expectedEnglish);
    expect(english.bulk.bundle.syncUpdatesHelp).toContain(expectedEnglish);
    expect(english.details.bundle.childrenDescription).toContain(expectedEnglish);

    for (const locale of locales) {
      const json = readLocale(locale);
      for (const value of [
        json.bulk?.bundleSyncUpdatesHelp,
        json.bulk?.bundle?.syncUpdatesHelp,
        json.details?.bundle?.childrenDescription,
      ]) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
      if (locale !== 'en') {
        // Translations must not leave the English text in place.
        expect(json.bulk.bundleSyncUpdatesHelp).not.toBe(english.bulk.bundleSyncUpdatesHelp);
        expect(json.details.bundle.childrenDescription).not.toBe(english.details.bundle.childrenDescription);
      }
    }
  });

  it('ships the propagation dialog and bulk summary keys in every locale', () => {
    for (const locale of locales) {
      const json = readLocale(locale);
      const propagation = json.details?.bundle?.propagation ?? {};
      for (const key of [
        'closeTitle',
        'reopenTitle',
        'closeBody',
        'reopenBody',
        'stayClosedHeading',
        'boardRulesNote',
        'closeConfirm',
        'reopenConfirm',
        'masterOnlyClose',
        'masterOnlyReopen',
      ]) {
        expect(typeof propagation[key], `${locale} details.bundle.propagation.${key}`).toBe('string');
      }
      for (const key of ['propagationSummary', 'masterSummary', 'applyToChildren', 'mastersOnly']) {
        expect(typeof json.bulk?.bundle?.[key], `${locale} bulk.bundle.${key}`).toBe('string');
      }
    }
  });
});
