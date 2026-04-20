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

describe('PurchaseOrderSummaryBanner i18n wiring contract', () => {
  it('T044: PO field labels and currency formatting resolve through msp/invoicing + locale-aware formatters', () => {
    const source = read('../src/components/billing-dashboard/invoicing/PurchaseOrderSummaryBanner.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(source).toContain("const { t } = useTranslation('msp/invoicing');");
    expect(source).toContain('const { formatCurrency } = useFormatters();');
    expect(source).not.toContain("formatCurrencyFromMinorUnits(");
    expect(source).not.toContain("'en-US'");

    const keyChecks = [
      'purchaseOrder.labels.number',
      'purchaseOrder.labels.authorized',
      'purchaseOrder.labels.consumed',
      'purchaseOrder.labels.remaining',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
