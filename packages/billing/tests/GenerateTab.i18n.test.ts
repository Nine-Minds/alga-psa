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
    // The data-first invoicing redesign moved the invoice-type selector out of
    // GenerateTab and onto the InvoicingHub tab-bar row, so the type option
    // labels now resolve through the hub while GenerateTab keeps the
    // success/load-error copy. Every key still lives in the en namespace.
    const generateTab = read('../src/components/billing-dashboard/invoicing/GenerateTab.tsx');
    const hub = read('../src/components/billing-dashboard/InvoicingHub.tsx');
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

    // Invoice-type option labels resolve through the hub selector.
    expect(hub).toContain("useTranslation('msp/invoicing')");
    for (const key of ['generateTab.types.automatic', 'generateTab.types.manual', 'generateTab.types.prepayment']) {
      expect(hub).toContain(key);
    }

    // Success + load-error copy resolves through GenerateTab.
    expect(generateTab).toContain("useTranslation('msp/invoicing')");
    for (const key of ['generateTab.messages.success', 'generateTab.messages.loadFailed']) {
      expect(generateTab).toContain(key);
    }

    // Every invoice-type key (field label, option labels, descriptions, messages)
    // remains defined in the en namespace for translators.
    for (const key of keyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
