import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PREVIOUS_STANDARD_ASTS,
  applyServicePeriodAndCurrency,
  matchPreviousStandardCode,
  canonicalJson,
} = require('../utils/invoiceTemplateServicePeriodCurrency.cjs');

const CODES = Object.keys(PREVIOUS_STANDARD_ASTS);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const hasServicePeriodColumn = (node: any): boolean =>
  JSON.stringify(node).includes('"path":"servicePeriodLabel"');

describe('invoice template service period + currency migration logic', () => {
  it('knows all five standard templates', () => {
    expect(CODES.sort()).toEqual([
      'standard-default',
      'standard-detailed',
      'standard-grouped',
      'standard-invoice-by-location',
      'standard-invoice-by-ticket',
    ]);
  });

  it.each(CODES)('refreshes an unmodified clone of %s', (code) => {
    // A jsonb round-trip reorders keys; the clone must still be recognised.
    const reordered = JSON.parse(canonicalJson(PREVIOUS_STANDARD_ASTS[code]));
    expect(matchPreviousStandardCode(reordered)).toBe(code);

    const refreshed = applyServicePeriodAndCurrency(reordered);
    expect(hasServicePeriodColumn(refreshed)).toBe(true);
    expect(refreshed.bindings.values.currencyCode).toEqual({ id: 'currencyCode', kind: 'value', path: 'currencyCode' });
    expect(JSON.stringify(refreshed)).toContain('"bindingId":"currencyCode"');
  });

  it.each(CODES)('does not match an edited clone of %s', (code) => {
    const edited = clone(PREVIOUS_STANDARD_ASTS[code]);
    edited.metadata = { ...edited.metadata, templateName: 'Our own invoice' };
    expect(matchPreviousStandardCode(edited)).toBeNull();

    const reworded = clone(PREVIOUS_STANDARD_ASTS[code]);
    const text = JSON.stringify(reworded).replace('"Description"', '"Item"');
    expect(matchPreviousStandardCode(JSON.parse(text))).toBeNull();
  });

  it('does not match an already-refreshed template, and is idempotent', () => {
    for (const code of CODES) {
      const once = applyServicePeriodAndCurrency(PREVIOUS_STANDARD_ASTS[code]);
      expect(matchPreviousStandardCode(once)).toBeNull();
      expect(canonicalJson(applyServicePeriodAndCurrency(once))).toBe(canonicalJson(once));
    }
  });

  it('does not mutate its input', () => {
    const input = clone(PREVIOUS_STANDARD_ASTS['standard-detailed']);
    const before = canonicalJson(input);
    applyServicePeriodAndCurrency(input);
    expect(canonicalJson(input)).toBe(before);
  });
});
