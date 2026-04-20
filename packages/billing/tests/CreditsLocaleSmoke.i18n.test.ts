// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function flattenLeafKeys(record: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenLeafKeys(value as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

function interpolationTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return Array.from(value.matchAll(/\{\{(.*?)\}\}/g), (match) => match[1].trim());
}

describe('Credits locale smoke and parity contract', () => {
  it('T027: italian credits locale preserves representative accented forms', () => {
    const italian = read('../../../server/public/locales/it/msp/credits.json');

    expect(italian).toContain('più');
    expect(italian).toContain("Si è verificato");
    expect(italian).toContain('Tutti gli stati');
    expect(italian).not.toContain('piu');
    expect(italian).not.toContain('Si e verificato');
  });

  it('T028: all translated credits locales preserve english interpolation tokens exactly', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );
    const locales = ['fr', 'es', 'de', 'nl', 'it', 'pl'] as const;

    for (const key of flattenLeafKeys(en)) {
      const expectedTokens = interpolationTokens(getLeaf(en, key));

      for (const locale of locales) {
        const localeJson = readJson<Record<string, unknown>>(
          `../../../server/public/locales/${locale}/msp/credits.json`,
        );
        expect(interpolationTokens(getLeaf(localeJson, key))).toEqual(expectedTokens);
      }
    }
  });

  it('T029: english credits page shell keys and component sources align for /msp/billing/credits', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );
    const pageSource = read('../src/components/credits/CreditsPageClient.tsx');
    const addButtonSource = read('../src/components/credits/AddCreditButton.tsx');
    const backButtonSource = read('../src/components/credits/BackButton.tsx');

    expect(getLeaf(en, 'page.title')).toBe('Credit Management');
    expect(getLeaf(en, 'page.creditsOverview')).toBe('Credits Overview');
    expect(getLeaf(en, 'actions.addCredit')).toBe('Add Credit');
    expect(getLeaf(en, 'actions.backToCredits')).toBe('Back to Credits');
    expect(pageSource).toContain("useTranslation('msp/credits')");
    expect(addButtonSource).toContain("useTranslation('msp/credits')");
    expect(backButtonSource).toContain("useTranslation('msp/credits')");
  });

  it('T030: german credits management/reconciliation locale values differ from english for representative dashboard keys', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );
    const de = readJson<Record<string, unknown>>(
      '../../../server/public/locales/de/msp/credits.json',
    );

    const representativeKeys = [
      'management.title',
      'charts.expirationSummary',
      'stats.totalActiveCredits',
      'reconciliation.title',
      'reconciliation.reconciliationReports',
      'charts.statusDistribution',
      'status.inReview',
    ];

    for (const key of representativeKeys) {
      expect(getLeaf(de, key)).toBeDefined();
      expect(getLeaf(de, key)).not.toBe(getLeaf(en, key));
    }
  });

  it('T031: xx pseudo-locale exposes representative pseudo fill across credits page, management, reconciliation, application, and expiration flows', () => {
    const xx = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    const pseudoKeys = [
      'page.title',
      'actions.backToCredits',
      'actions.addCredit',
      'management.title',
      'management.recentCredits',
      'reconciliation.title',
      'reconciliation.reconciliationReports',
      'application.title',
      'application.noCreditsAvailable',
      'expiration.appliedCredits',
      'expirationDialog.title',
      'context.lineageMissing',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(xx, key)).toBe('11111');
    }

    expect(getLeaf(xx, 'reconciliation.validationResult')).toBe(
      '11111 {{balanceCount}} 11111 {{trackingCount}} 11111',
    );
    expect(getLeaf(xx, 'expiration.creditsAppliedToInvoice')).toBe(
      '11111 {{amount}} 11111',
    );
  });
});
