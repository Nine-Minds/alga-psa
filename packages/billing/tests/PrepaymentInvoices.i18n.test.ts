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

describe('PrepaymentInvoices i18n wiring contract', () => {
  it('T038: headings, field labels, type options, placeholders, validation errors, and submit states resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/PrepaymentInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'prepayment.titles.prepayment',
      'prepayment.titles.creditMemo',
      'prepayment.descriptions.prepayment',
      'prepayment.descriptions.creditMemo',
      'prepayment.fields.type',
      'prepayment.fields.client',
      'prepayment.fields.amount',
      'prepayment.fields.description',
      'prepayment.types.prepaymentInvoice',
      'prepayment.types.creditMemo',
      'prepayment.placeholders.amount',
      'prepayment.placeholders.prepaymentDescription',
      'prepayment.placeholders.creditMemoDescription',
      'prepayment.errors.allFieldsRequired',
      'prepayment.errors.validAmount',
      'prepayment.errors.creditMemosUnsupported',
      'prepayment.errors.generateFailed',
      'prepayment.actions.generating',
      'prepayment.actions.generatePrepayment',
      'prepayment.actions.generateCreditMemo',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
