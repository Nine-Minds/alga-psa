// @vitest-environment node

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInstance, type i18n } from 'i18next';
import { LOCALE_CONFIG, PSEUDO_LOCALES } from './config';

const LOCALES = resolve(__dirname, '../../../../../server/public/locales');
const load = (loc: string, ns: string) =>
  JSON.parse(readFileSync(resolve(LOCALES, loc, `${ns}.json`), 'utf8'));

// Every translated locale the app serves, read from the runtime config rather
// than a hand-kept list, so a locale added later is covered automatically.
const TRANSLATED_LOCALES = LOCALE_CONFIG.supportedLocales.filter(
  (locale) => locale !== LOCALE_CONFIG.defaultLocale && !PSEUDO_LOCALES.includes(locale)
);

const NAMESPACES = ['common', 'features/tickets'] as const;

let i18next: i18n;

beforeAll(async () => {
  i18next = createInstance();
  await i18next.init({
    lng: 'en',
    // No fallback: a key missing from a locale must surface as the raw key
    // instead of silently rendering the English string.
    fallbackLng: false,
    interpolation: { escapeValue: false },
    resources: Object.fromEntries(
      ['en', ...TRANSLATED_LOCALES].map((locale) => [
        locale,
        Object.fromEntries(NAMESPACES.map((ns) => [ns, load(locale, ns)])),
      ])
    ),
  });
});

describe('ticket document upload feedback resolves in every translated locale', () => {
  const plainKeys = [
    'documents.uploadSection.uploaded',
    'documents.uploadSection.failed',
    'documents.uploadSection.emptyDropTitle',
    'documents.uploadSection.emptyDropMessage',
    'documents.uploadSection.uploadInProgress',
    'documents.uploadSection.refreshFailed',
    'documents.uploadSection.clearResults',
  ];

  it.each(TRANSLATED_LOCALES)('%s', (locale) => {
    const t = i18next.getFixedT(locale, 'common');

    for (const key of plainKeys) {
      expect(t(key), `${locale} ${key}`).not.toBe(key);
    }

    const outcome = t('documents.uploadSection.outcomeSummary', { succeeded: 3, total: 5 });
    expect(outcome).not.toBe('documents.uploadSection.outcomeSummary');
    expect(outcome).toMatch(/3.*5/);
    expect(outcome).not.toContain('{{');

    const failure = t('documents.uploadSection.failureSummary', { failed: 2, total: 5 });
    expect(failure).not.toBe('documents.uploadSection.failureSummary');
    expect(failure).toMatch(/2.*5/);
    expect(failure).not.toContain('{{');
  });
});

describe('ticket time entry billable badge resolves in every translated locale', () => {
  it.each(TRANSLATED_LOCALES)('%s', (locale) => {
    const t = i18next.getFixedT(locale, 'features/tickets');

    expect(t('timeEntries.billable')).not.toBe('timeEntries.billable');
    expect(t('timeEntries.nonBillable')).not.toBe('timeEntries.nonBillable');
    expect(t('timeEntries.billable')).not.toBe(t('timeEntries.nonBillable'));
  });

  it('sv renders Swedish billing terms', () => {
    const t = i18next.getFixedT('sv', 'features/tickets');
    expect(t('timeEntries.billable')).toBe('Debiterbar');
    expect(t('timeEntries.nonBillable')).toBe('Icke-debiterbar');
  });
});
