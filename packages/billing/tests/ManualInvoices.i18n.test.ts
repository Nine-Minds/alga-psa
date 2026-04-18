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

describe('ManualInvoices i18n wiring contract', () => {
  it('T011: headings, descriptions, field labels, placeholders, automated item headers, and line-item section titles resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/ManualInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'manualInvoices.title',
      'manualInvoices.detailsTitle',
      'manualInvoices.detailsDescription',
      'manualInvoices.description',
      'manualInvoices.fields.client',
      'manualInvoices.fields.invoiceNumber',
      'manualInvoices.fields.invoiceNumberOptional',
      'manualInvoices.placeholders.selectClient',
      'manualInvoices.placeholders.invoiceNumberOptional',
      'manualInvoices.automatedItems.title',
      'manualInvoices.automatedItems.service',
      'manualInvoices.automatedItems.total',
      'manualInvoices.lineItems.manual',
      'manualInvoices.lineItems.all',
      'manualInvoices.labels.total',
      'common.labels.unknownClient',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');
    expect(source).toContain("placeholder={t('manualInvoices.placeholders.selectClient'");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
