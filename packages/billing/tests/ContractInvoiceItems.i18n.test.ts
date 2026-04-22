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

describe('ContractInvoiceItems i18n wiring contract', () => {
  it('T039: table headers, subtotal labels, other-items heading, product badge, and locale-aware currency formatting resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoices/ContractInvoiceItems.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'contractItems.columns.description',
      'contractItems.columns.quantity',
      'contractItems.columns.rate',
      'contractItems.columns.amount',
      'contractItems.labels.contractSubtotal',
      'contractItems.labels.otherItemsSubtotal',
      'contractItems.labels.otherItems',
      'contractItems.labels.product',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
