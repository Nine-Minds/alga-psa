import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

// Derived, not hand-listed: an earlier hard-coded six ('en' plus de/es/fr/it/nl)
// went stale when pl and pt joined the registry, so this contract passed while
// those two packs were missing every key it claims to cover.
const translatedLocales = Object.keys(
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'tools/i18n/locales.registry.json'), 'utf8')),
).sort();
const locales = ['en', ...translatedLocales];

function readLocale(locale: string): Record<string, any> {
  const file = path.join(repoRoot, 'server/public/locales', locale, 'features/tickets.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('ticket bundle status propagation copy contract', () => {
  it('covers every locale the registry ships, not a hand-listed subset', () => {
    expect(translatedLocales).toEqual(['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']);
  });

  it('states the propagation behaviour in the bundle help and master panel for every locale', () => {
    const english = readLocale('en');
    const opening = 'Children keep their current status when bundled.';
    const syncMeaning = [
      /closing or reopening the master closes or reopens all children/,
      /their workflow fields are locked/,
    ];
    const linkOnlyMeaning = /children manage their own status, assignee and priority/;
    const englishCopy: Record<string, { value: string; syncLead: RegExp; offLead: RegExp }> = {
      'bulk.bundleSyncUpdatesHelp': {
        value: english.bulk.bundleSyncUpdatesHelp,
        syncLead: /With sync updates on, closing or reopening/,
        offLead: /With it off, children manage/,
      },
      'bulk.bundle.syncUpdatesHelp': {
        value: english.bulk.bundle.syncUpdatesHelp,
        syncLead: /With sync updates on, closing or reopening/,
        offLead: /With it off, children manage/,
      },
      'details.bundle.childrenDescription': {
        value: english.details.bundle.childrenDescription,
        syncLead: /In Sync Updates mode, closing or reopening/,
        offLead: /In Link Only mode, children manage/,
      },
    };

    for (const [key, { value, syncLead, offLead }] of Object.entries(englishCopy)) {
      expect(typeof value, key).toBe('string');
      expect(value, key).toContain(opening);
      // Sync mode: master close/reopen cascades and child workflow fields are locked.
      for (const re of syncMeaning) expect(value, key).toMatch(re);
      expect(value, key).toMatch(syncLead);
      // Link Only / sync off: children manage themselves, and that is scoped to the off mode.
      expect(value, key).toMatch(linkOnlyMeaning);
      expect(value, key).toMatch(offLead);
      expect(value.search(syncLead), key).toBeLessThan(value.search(offLead));
    }

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
        expect(json.bulk.bundle.syncUpdatesHelp).not.toBe(english.bulk.bundle.syncUpdatesHelp);
        expect(json.details.bundle.childrenDescription).not.toBe(english.details.bundle.childrenDescription);
        // The panel copy names both modes (product terms stay untranslated).
        expect(json.details.bundle.childrenDescription).toContain('Sync Updates');
        expect(json.details.bundle.childrenDescription).toContain('Link Only');
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
