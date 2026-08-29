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
  it('T038: headings, field labels, placeholders, validation errors, and submit states resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/PrepaymentInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'prepayment.titles.prepayment',
      'prepayment.descriptions.prepayment',
      'prepayment.fields.client',
      'prepayment.fields.amount',
      'prepayment.fields.descriptionOptional',
      'prepayment.placeholders.amount',
      'prepayment.placeholders.prepaymentDescription',
      'prepayment.errors.allFieldsRequired',
      'prepayment.errors.validAmount',
      'prepayment.errors.generateFailed',
      'prepayment.actions.generating',
      'prepayment.actions.generatePrepayment',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
