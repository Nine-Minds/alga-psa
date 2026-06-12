/**
 * Tests for the QuickBooks CSV import header normalization helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  COLUMN_ALIASES,
  REQUIRED_TAX_IMPORT_COLUMNS,
  normalizeCSVHeaders,
  validateRequiredColumns,
  getSuggestionsForMissingColumns,
  getColumnDisplayName,
  getColumnAliases,
  levenshteinDistance,
  formatColumnAliases
} from '../csvFieldNormalizer';

describe('normalizeCSVHeaders', () => {
  it('maps canonical QuickBooks column aliases to their indices case-insensitively', () => {
    const headers = ['Invoice Number', ' invoice date ', 'TAX AMOUNT', 'Customer Name', 'Qty'];
    const map = normalizeCSVHeaders(headers);

    expect(map.get('invoiceNo')).toBe(0);
    expect(map.get('invoiceDate')).toBe(1);
    expect(map.get('taxAmount')).toBe(2);
    expect(map.get('customer')).toBe(3);
    expect(map.get('quantity')).toBe(4);
  });

  it('uses the first matching column when multiple aliases are present', () => {
    // Both 'Invoice #' and 'Doc Number' are aliases for invoiceNo.
    const map = normalizeCSVHeaders(['Invoice #', 'Doc Number']);
    expect(map.get('invoiceNo')).toBe(0);
  });

  it('leaves unknown headers unmapped', () => {
    const map = normalizeCSVHeaders(['Some Random Column']);
    expect(map.size).toBe(0);
  });

  it('recognizes regional tax column names (VAT/GST)', () => {
    expect(normalizeCSVHeaders(['VAT']).get('taxAmount')).toBe(0);
    expect(normalizeCSVHeaders(['GST']).get('taxAmount')).toBe(0);
  });
});

describe('validateRequiredColumns', () => {
  it('passes when all required tax import columns are mapped', () => {
    const map = normalizeCSVHeaders(['InvoiceNo', 'Invoice Date', 'Tax Amount']);
    expect(validateRequiredColumns(map)).toEqual({
      valid: true,
      missing: [],
      present: ['invoiceNo', 'invoiceDate', 'taxAmount']
    });
  });

  it('reports the missing canonical columns', () => {
    const map = normalizeCSVHeaders(['InvoiceNo']);
    expect(validateRequiredColumns(map)).toEqual({
      valid: false,
      missing: ['invoiceDate', 'taxAmount'],
      present: ['invoiceNo']
    });
  });

  it('honours a custom required column list', () => {
    const map = normalizeCSVHeaders(['Customer']);
    expect(validateRequiredColumns(map, ['customer'])).toEqual({
      valid: true,
      missing: [],
      present: ['customer']
    });
  });

  it('exposes the documented required columns for tax import', () => {
    expect(REQUIRED_TAX_IMPORT_COLUMNS).toEqual(['invoiceNo', 'invoiceDate', 'taxAmount']);
  });
});

describe('getSuggestionsForMissingColumns', () => {
  it('suggests near-miss headers within an edit distance of 3', () => {
    const suggestions = getSuggestionsForMissingColumns(
      ['Invoce Number', 'Tax Amnt', 'Completely Different'],
      ['invoiceNo', 'taxAmount']
    );

    expect(suggestions.get('invoiceNo')).toEqual(['Invoce Number']);
    expect(suggestions.get('taxAmount')).toEqual(['Tax Amnt']);
  });

  it('returns no entry when nothing is close enough', () => {
    const suggestions = getSuggestionsForMissingColumns(['ZZZZZZZZZZ'], ['invoiceNo']);
    expect(suggestions.has('invoiceNo')).toBe(false);
  });
});

describe('levenshteinDistance', () => {
  it('computes classic edit distances', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('display helpers', () => {
  it('returns the first alias as the display name and falls back to the canonical name', () => {
    expect(getColumnDisplayName('invoiceNo')).toBe('InvoiceNo');
    expect(getColumnDisplayName('unknownField')).toBe('unknownField');
  });

  it('returns all known aliases or an empty list', () => {
    expect(getColumnAliases('dueDate')).toEqual(['DueDate', 'Due Date', 'Due', 'Payment Due']);
    expect(getColumnAliases('nope')).toEqual([]);
  });

  it('formats alias lists and truncates beyond maxAliases', () => {
    expect(formatColumnAliases('dueDate')).toBe('DueDate, Due Date, Due, Payment Due');
    expect(formatColumnAliases('invoiceNo', 3)).toBe(
      `InvoiceNo, Invoice Number, Invoice #, ... (+${COLUMN_ALIASES.invoiceNo.length - 3} more)`
    );
    expect(formatColumnAliases('unknownField')).toBe('unknownField');
  });
});
