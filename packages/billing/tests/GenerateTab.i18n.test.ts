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

describe('GenerateTab i18n wiring contract', () => {
  it('T037: invoice-type label, option labels, descriptions, success message, and load error resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/GenerateTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'generateTab.fields.invoiceType',
      'generateTab.types.automatic',
      'generateTab.types.manual',
      'generateTab.types.prepayment',
      'generateTab.descriptions.automatic',
      'generateTab.descriptions.manual',
      'generateTab.descriptions.prepayment',
      'generateTab.messages.success',
      'generateTab.messages.loadFailed',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
