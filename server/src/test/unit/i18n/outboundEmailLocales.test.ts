import fs from 'node:fs';
import path from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { pseudoPattern } from '../../../../../tools/i18n/lib/pseudo-locale.mjs';

const localesRoot = path.resolve(__dirname, '../../../../public/locales');
const locales = fs.readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'en')
  .map((entry) => entry.name);
const namespaces = ['msp/admin', 'msp/email-providers'];
const readPack = (locale: string, namespace: string) =>
  JSON.parse(fs.readFileSync(path.join(localesRoot, locale, `${namespace}.json`), 'utf8'));

function leaves(value: Record<string, unknown>, prefix: string): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = `${prefix}.${key}`;
    return typeof child === 'string'
      ? [[fullKey, child] as [string, string]]
      : leaves(child as Record<string, unknown>, fullKey);
  });
}

describe('outbound email locale resolution', () => {
  it.each(locales)('%s resolves diagnostics and outbound settings without English fallback', async (locale) => {
    const english = Object.fromEntries(namespaces.map((ns) => [ns, readPack('en', ns)]));
    const translated = Object.fromEntries(namespaces.map((ns) => [ns, readPack(locale, ns)]));
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      ns: namespaces,
      resources: { en: english, [locale]: translated },
      interpolation: { escapeValue: false },
    });

    // Exercise the actual runtime lookup, including dynamic result/status keys,
    // inline defaults, and interpolation. A missing pack entry otherwise silently
    // displays English even though the rest of the dialog is translated.
    const sections = [
      ['msp/admin', leaves(english['msp/admin'].outboundDiagnostics, 'outboundDiagnostics')],
      ['msp/email-providers', leaves(english['msp/email-providers'].managed.outbound, 'managed.outbound')],
    ] as const;
    for (const [ns, entries] of sections) {
      for (const [key, defaultValue] of entries) {
        const variables = Object.fromEntries(
          [...defaultValue.matchAll(/\{\{(\w+)\}\}/g)]
            .map((match) => [match[1], `value-${match[1]}`]),
        );
        const result = i18n.t(key, { ns, defaultValue, ...variables, returnDetails: true });
        expect(result.usedLng, `${locale}:${ns}:${key} fell back to English`).toBe(locale);
        expect(result.res).not.toBe(key);
        for (const value of Object.values(variables)) expect(result.res).toContain(value);
        expect(result.res).not.toMatch(/\{\{\w+\}\}/);
        if (locale === 'xx' || locale === 'yy') {
          expect(result.res).toMatch(pseudoPattern(locale));
        }
      }
    }

    // Populated English placeholders are not a translation either.
    for (const [ns, key] of [
      ['msp/admin', 'outboundDiagnostics.introduction'],
      ['msp/email-providers', 'managed.outbound.saveSettings'],
    ]) {
      expect(i18n.t(key, { ns })).not.toBe(i18n.t(key, { ns, lng: 'en' }));
    }
  });
});
