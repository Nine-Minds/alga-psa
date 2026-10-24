import fs from 'node:fs';
import path from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { pseudoPattern } from '../../../../../tools/i18n/lib/pseudo-locale.mjs';

const root = path.resolve(__dirname, '../../../../public/locales');
const locales = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const sections = [
  ['features/tickets', 'namedConversations'],
  ['msp/email-providers', 'replyReview'],
  ['msp/settings', 'ticketing.boards.fields.inboundReplyReopen'],
] as const;
const readPack = (locale: string, ns: string) =>
  JSON.parse(fs.readFileSync(path.join(root, locale, `${ns}.json`), 'utf8'));
function leaves(value: Record<string, unknown>, prefix: string): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => typeof child === 'string'
    ? [[`${prefix}.${key}`, child] as [string, string]]
    : leaves(child as Record<string, unknown>, `${prefix}.${key}`));
}

describe('conversation locale resolution', () => {
  it.each(locales)('%s renders conversation, delivery and review copy without fallback', async (locale) => {
    const english = Object.fromEntries(sections.map(([ns]) => [ns, readPack('en', ns)]));
    const translated = Object.fromEntries(sections.map(([ns]) => [ns, readPack(locale, ns)]));
    const i18n = createInstance();
    await i18n.init({
      lng: locale, fallbackLng: 'en', ns: sections.map(([ns]) => ns),
      resources: { en: english, [locale]: translated },
      interpolation: { escapeValue: false },
    });

    // These UI calls have inline English defaults, so also guard against keys
    // missing from English itself (which cannot be found by comparing packs).
    for (const key of ['recipients', 'recipientsPlaceholder', 'recipientsInvalid', 'newCorrespondent', 'removeRecipient']) {
      expect(i18n.exists(`namedConversations.${key}`, { ns: 'features/tickets', lng: 'en' }), key).toBe(true);
    }
    for (const key of ['sideConversationsLabel', 'sideConversationsHelp']) {
      expect(i18n.exists(`ticketing.boards.fields.inboundReplyReopen.${key}`, { ns: 'msp/settings', lng: 'en' }), key).toBe(true);
    }

    for (const [ns, prefix] of sections) {
      const group = prefix.split('.').reduce((value, key) => value[key], english[ns]);
      for (const [key, defaultValue] of leaves(group, prefix)) {
        const variables = Object.fromEntries([...defaultValue.matchAll(/\{\{(\w+)\}\}/g)]
          .map((match) => [match[1], `value-${match[1]}`]));
        const result = i18n.t(key, { ns, defaultValue, ...variables, returnDetails: true });
        expect(result.usedLng, `${locale}:${ns}:${key} fell back to English`).toBe(locale);
        expect(result.res).not.toBe(key);
        if (defaultValue) expect(result.res).not.toBe('');
        for (const value of Object.values(variables)) expect(result.res).toContain(value);
        expect(result.res).not.toMatch(/\{\{\w+\}\}/);
        if ((locale === 'xx' || locale === 'yy') && defaultValue) {
          expect(result.res).toMatch(pseudoPattern(locale));
        }
      }
    }
  });
});
