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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('BillingDashboard i18n wiring contract', () => {
  it('T027: wires the billing dashboard shell labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/BillingDashboard.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('dashboard.title', { defaultValue: 'Billing' })");
    expect(source).toContain("t('dashboard.errorPrefix', { defaultValue: 'Error:' })");
    expect(source).toContain("t('dashboard.quoteTemplatesHeading', { defaultValue: 'Quote Templates' })");
    expect(source).toContain("t('dashboard.backToPresets', { defaultValue: 'Back to Contract Line Presets List' })");
  });

  it('T028: keeps the billing dashboard shell backed by xx pseudo-locale keys for remaining shell labels', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    const pseudoKeys = [
      'dashboard.title',
      'dashboard.errorPrefix',
      'dashboard.quoteTemplatesHeading',
      'dashboard.backToPresets',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});
