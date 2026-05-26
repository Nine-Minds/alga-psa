/* @vitest-environment node */
/* @behavioralCoverage packages/ui/src/keyboard-shortcuts/i18n.contract.test.ts */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORTCUT_ACTION_CATALOG } from './catalog';

const repoRoot = resolve(__dirname, '../../../..');
const productionLocales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt'] as const;

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8'));
}

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, nested]) => flattenKeys(nested, prefix ? `${prefix}.${key}` : key));
}

function valueAtPath(value: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((current, part) => current?.[part], value);
}

describe('keyboard shortcuts i18n contract', () => {
  it('has namespace files with production-locale key parity', () => {
    const english = readJson('server/public/locales/en/msp/keyboard-shortcuts.json');
    const englishKeys = flattenKeys(english).sort();

    for (const locale of productionLocales) {
      const relativePath = `server/public/locales/${locale}/msp/keyboard-shortcuts.json`;
      expect(existsSync(resolve(repoRoot, relativePath))).toBe(true);
      expect(flattenKeys(readJson(relativePath)).sort()).toEqual(englishKeys);
    }
  });

  it('covers every catalogued action label and group key', () => {
    const english = readJson('server/public/locales/en/msp/keyboard-shortcuts.json');
    for (const action of SHORTCUT_ACTION_CATALOG) {
      expect(valueAtPath(english, action.labelKey)).toEqual(expect.any(String));
      expect(valueAtPath(english, action.descriptionKey ?? action.labelKey)).toEqual(expect.any(String));
      expect(valueAtPath(english, action.groupKey)).toEqual(expect.any(String));
    }
  });

  it('adds the Profile tab label (EN authored first; other locales fall back via defaultValue)', () => {
    const profile = readJson('server/public/locales/en/msp/profile.json');
    expect(profile.profile?.tabs?.keyboardShortcuts).toEqual(expect.any(String));
    expect(profile.profile.tabs.keyboardShortcuts.length).toBeGreaterThan(0);
  });

  it('preloads the namespace on MSP routes and uses translation keys in UI', () => {
    const config = readFileSync(resolve(repoRoot, 'packages/core/src/lib/i18n/config.ts'), 'utf8');
    expect(config).toContain("'/msp': ['common', 'msp/core', 'msp/dashboard', 'msp/keyboard-shortcuts']");
    expect(config).toContain("'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/keyboard-shortcuts'");

    const userProfile = readFileSync(resolve(repoRoot, 'server/src/components/settings/profile/UserProfile.tsx'), 'utf8');
    expect(userProfile).toContain("t('profile.tabs.keyboardShortcuts'");
    const settingsPage = readFileSync(resolve(repoRoot, 'server/src/components/settings/SettingsPage.tsx'), 'utf8');
    expect(settingsPage).not.toContain("tabs.keyboardShortcuts");

    const helpDialog = readFileSync(resolve(repoRoot, 'packages/ui/src/keyboard-shortcuts/ShortcutHelpDialog.tsx'), 'utf8');
    expect(helpDialog).toContain("useTranslation('msp/keyboard-shortcuts')");
    expect(helpDialog).toContain('t(action.labelKey)');
    expect(helpDialog).not.toContain('groupKey.replace');
  });
});
