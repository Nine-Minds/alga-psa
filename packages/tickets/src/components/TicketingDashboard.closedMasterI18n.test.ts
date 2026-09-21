// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES_DIR = path.join(REPO_ROOT, 'server/public/locales');
const NAMESPACE = 'features/tickets';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readPack(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${NAMESPACE}.json`), 'utf8'));
}

function getLeaf(pack: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((node, segment) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    return (node as Record<string, unknown>)[segment];
  }, pack);
}

// i18next v4 stores count-based keys under CLDR plural suffixes, so t('key', { count })
// resolves through key_one/key_other. Mirror scripts/find-missing-i18n-keys.cjs.
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function resolves(pack: Record<string, unknown>, dottedKey: string): boolean {
  if (typeof getLeaf(pack, dottedKey) === 'string') return true;
  return PLURAL_SUFFIXES.some((suffix) => typeof getLeaf(pack, `${dottedKey}_${suffix}`) === 'string');
}

function staticTranslationKeys(source: string): string[] {
  return [...new Set([...source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map((match) => match[1]))];
}

const TRANSLATED_LOCALES = Object.keys(
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/i18n/locales.registry.json'), 'utf8')),
);

describe('TicketingDashboard closed-master bundle i18n', () => {
  it('resolves every static translation key the dashboard renders', () => {
    const en = readPack('en');
    const unresolved = staticTranslationKeys(readSource('./TicketingDashboard.tsx')).filter(
      (key) => !resolves(en, key),
    );

    // A key with no pack entry falls back to its inline English default, so English
    // users notice nothing while every other locale silently renders English.
    expect(unresolved).toEqual([]);
  });

  it('rejects a closed-master bundle with the same key the server action returns', () => {
    const dashboard = readSource('./TicketingDashboard.tsx');
    const action = readSource('../actions/ticketBundleActions.ts');

    expect(dashboard).toContain("t('errors.bundle.closedMasterChoiceRequired'");
    expect(dashboard).not.toContain('details.bundle.closedMasterChoiceRequired');
    expect(action).toContain("'features/tickets:errors.bundle.closedMasterChoiceRequired'");

    // Client pre-flight and server rejection are the same refusal, so they must not
    // drift into two differently-worded messages.
    expect(getLeaf(readPack('en'), 'errors.bundle.closedMasterChoiceRequired')).toBe(
      "This bundle's master is closed. Choose how to add the child: {{choices}}.",
    );
  });

  it('ships the closed-master choice strings translated in every locale', () => {
    const en = readPack('en');
    const closedMasterKeys = [
      'errors.bundle.closedMasterChoiceRequired',
      'errors.bundle.closedMasterChoiceNotAllowed',
      'errors.bundle.choiceOnOpenMaster',
      'details.bundle.closedMasterDialogTitle',
      'details.bundle.closedMasterDialogIntro',
      'details.bundle.keepClosedLabel',
      'details.bundle.applyResolutionLabel',
      'details.bundle.reopenMasterLabel',
      'details.bundle.closedMasterGating',
    ];

    const stillEnglish: string[] = [];
    for (const locale of TRANSLATED_LOCALES) {
      const pack = readPack(locale);
      for (const key of closedMasterKeys) {
        const value = getLeaf(pack, key);
        expect(typeof value).toBe('string');
        if (value === getLeaf(en, key)) stillEnglish.push(`${locale}:${key}`);
      }
    }

    expect(stillEnglish).toEqual([]);
  });
});
