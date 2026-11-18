import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmpSqliteReader } from '@alga-psa/migration-sdk';
import { convertSpreadsheets, inferSpreadsheetMapping } from '../src/csv/index';
import {
  normalizeBooleanFlag,
  normalizeCurrencyCode,
  normalizeWholeNumber,
  parseMoneyToMinorUnits,
} from '../src/csv/values';

let workDir: string;
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'amp-products-test-'));
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeCsv(name: string, text: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, text, 'utf8');
  return path;
}

describe('parseMoneyToMinorUnits', () => {
  it('uses the currency exponent: 2 decimals for USD, 0 for JPY, 3 for BHD', () => {
    expect(parseMoneyToMinorUnits('1299.00', 'USD')).toEqual({ ok: true, minor: 129900 });
    expect(parseMoneyToMinorUnits('12.5', 'EUR')).toEqual({ ok: true, minor: 1250 });
    expect(parseMoneyToMinorUnits('1500', 'JPY')).toEqual({ ok: true, minor: 1500 });
    expect(parseMoneyToMinorUnits('1.234', 'BHD')).toEqual({ ok: true, minor: 1234 });
    expect(parseMoneyToMinorUnits('0', 'USD')).toEqual({ ok: true, minor: 0 });
  });

  it('accepts comma-grouped thousands only in the canonical grouping', () => {
    expect(parseMoneyToMinorUnits('1,299.50', 'USD')).toEqual({ ok: true, minor: 129950 });
    expect(parseMoneyToMinorUnits('1,29.50', 'USD')).toMatchObject({ ok: false });
  });

  it('rejects over-precise values instead of rounding', () => {
    expect(parseMoneyToMinorUnits('10.999', 'USD')).toEqual({ ok: false, reason: 'precision' });
    expect(parseMoneyToMinorUnits('10.5', 'JPY')).toEqual({ ok: false, reason: 'precision' });
  });

  it('rejects negative, blank and garbage input', () => {
    expect(parseMoneyToMinorUnits('-5.00', 'USD')).toEqual({ ok: false, reason: 'negative' });
    expect(parseMoneyToMinorUnits('', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoneyToMinorUnits('abc', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoneyToMinorUnits('$12.00', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoneyToMinorUnits('1e3', 'USD')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoneyToMinorUnits('12', 'NOPE')).toEqual({ ok: false, reason: 'currency' });
  });
});

describe('flag, currency and whole-number normalizers', () => {
  it('parses preferred/active flags', () => {
    for (const yes of ['Y', 'yes', 'TRUE', '1']) expect(normalizeBooleanFlag(yes)).toBe(1);
    for (const no of ['N', 'no', 'false', '0']) expect(normalizeBooleanFlag(no)).toBe(0);
    expect(normalizeBooleanFlag('maybe')).toBeUndefined();
  });
  it('normalizes currency codes', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR');
    expect(normalizeCurrencyCode('ZZZZ')).toBeUndefined();
    expect(normalizeCurrencyCode('US')).toBeUndefined();
  });
  it('parses whole-number day counts', () => {
    expect(normalizeWholeNumber('5', 3650)).toBe(5);
    expect(normalizeWholeNumber('5.5', 3650)).toBeUndefined();
    expect(normalizeWholeNumber('-1', 3650)).toBeUndefined();
    expect(normalizeWholeNumber('99999', 3650)).toBeUndefined();
  });
});

describe('vendor price-list header inference', () => {
  it('maps common distributor headers onto vendor_products columns', async () => {
    const path = await writeCsv(
      'pricelist.csv',
      'Vendor,Item Number,Vendor SKU,Cost,Currency,Lead Time (days),Preferred,Notes\nIngram,FG-60F,IM-1,980.00,USD,5,Y,x\n'
    );
    expect(await inferSpreadsheetMapping(path, 'vendor_products')).toEqual({
      Vendor: 'vendor_name',
      'Item Number': 'product_sku',
      'Vendor SKU': 'vendor_sku',
      Cost: 'unit_cost_minor',
      Currency: 'cost_currency',
      'Lead Time (days)': 'lead_time_days',
      Preferred: 'is_preferred',
    });
  });

  it('maps catalog headers onto products columns and never auto-maps raw *_minor headers', async () => {
    const path = await writeCsv(
      'catalog.csv',
      'Part #,Product Name,Category,UOM,List Price,MSRP,Cost,price_minor\nA1,Widget,Cables,each,10.00,12.00,5.00,1000\n'
    );
    const mapping = await inferSpreadsheetMapping(path, 'products');
    expect(mapping['Part #']).toBe('sku');
    expect(mapping['Product Name']).toBe('name');
    expect(mapping.Category).toBe('category_name');
    expect(mapping.UOM).toBe('unit_of_measure');
    expect(mapping['List Price']).toBe('price_minor');
    expect(mapping.Cost).toBe('cost_minor');
    expect(mapping.price_minor).toBeUndefined();
  });
});

describe('products and vendor_products conversion', () => {
  async function convert(csv: string, entityType: 'products' | 'vendor_products', defaultCurrency?: string) {
    const path = await writeCsv(`${entityType}-${Math.random().toString(36).slice(2)}.csv`, csv);
    const mapping = await inferSpreadsheetMapping(path, entityType);
    const outputPath = join(workDir, `${Math.random().toString(36).slice(2)}.amp`);
    const result = await convertSpreadsheets(
      {
        outputPath,
        namespace: 'csv:test',
        sourceSystem: 'generic-csv',
        defaultCurrency,
        files: [{ entityType, path, mapping }],
      },
      workDir
    );
    const reader = new AmpSqliteReader(outputPath);
    try {
      return { result, rows: reader.allRows(entityType) };
    } finally {
      reader.close();
    }
  }

  it('produces a valid products package with exponent-aware minor units', async () => {
    const { result, rows } = await convert(
      'SKU,Name,List Price,Cost,Currency,Active\nA1,Widget,10.50,5,EUR,yes\nA2,Yen item,1500,900,JPY,0\n',
      'products'
    );
    expect(result.valid).toBe(true);
    const byName = Object.fromEntries(rows.map((row) => [row.name as string, row]));
    expect(byName.Widget).toMatchObject({ price_minor: 1050, price_currency: 'EUR', is_active: 1 });
    expect(byName['Yen item']).toMatchObject({ price_minor: 1500, price_currency: 'JPY', is_active: 0 });
  });

  it('applies one generic Currency column to both price and cost', async () => {
    const { result, rows } = await convert('SKU,Name,Price,Cost,Currency\nA1,Widget,10.50,5.25,EUR\n', 'products', 'USD');
    expect(result.valid).toBe(true);
    expect(rows[0]).toMatchObject({
      price_minor: 1050,
      price_currency: 'EUR',
      cost_minor: 525,
      cost_currency: 'EUR',
    });
    expect(rows[0].extension_json ?? null).toBeNull();
  });

  it('parses price and cost with the shared currency exponent (JPY)', async () => {
    const { result, rows } = await convert('SKU,Name,Price,Cost,Currency\nA1,Widget,1500,900,JPY\n', 'products', 'USD');
    expect(result.valid).toBe(true);
    expect(rows[0]).toMatchObject({ price_minor: 1500, price_currency: 'JPY', cost_minor: 900, cost_currency: 'JPY' });
    expect(rows[0].extension_json ?? null).toBeNull();
  });

  it('uses the supplied default currency only for the exponent, leaving the currency null', async () => {
    const { result, rows } = await convert('SKU,Name,List Price\nA1,Widget,10.50\n', 'products', 'JPY');
    // 10.50 is over-precise for a 0-decimal default currency and must be rejected.
    expect(result.diagnostics.map((d) => d.code)).toContain('CSV_INVALID_MONEY');
    expect(rows[0].price_minor ?? null).toBeNull();

    const ok = await convert('SKU,Name,List Price\nA1,Widget,10.50\n', 'products', 'USD');
    expect(ok.rows[0]).toMatchObject({ price_minor: 1050, price_currency: null });
    expect(JSON.parse(String(ok.rows[0].extension_json))).toEqual({ __assumed_currency: 'USD' });
  });

  it('drops money with a diagnostic when no currency can be determined', async () => {
    const { result, rows } = await convert('SKU,Name,List Price\nA1,Widget,10.50\n', 'products');
    expect(result.diagnostics.map((d) => d.code)).toContain('CSV_MISSING_CURRENCY');
    expect(rows[0].price_minor ?? null).toBeNull();
  });

  it('reports negative, garbage and invalid-currency cells as row diagnostics', async () => {
    const { result } = await convert(
      'SKU,Name,List Price,Cost,Currency\nA1,Neg,-1.00,2.00,USD\nA2,Junk,abc,2.00,USD\nA3,BadCcy,1.00,2.00,ZZZ\n',
      'products'
    );
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes.filter((c) => c === 'CSV_INVALID_MONEY')).toHaveLength(2);
    expect(codes).toContain('CSV_INVALID_CURRENCY');
    expect(codes).toContain('CSV_MONEY_DROPPED');
    expect(result.valid).toBe(true);
  });

  it('produces valid vendor_products rows and requires a product reference', async () => {
    const { result, rows } = await convert(
      'Vendor,Part Number,Vendor SKU,Cost,Currency,Lead Time (days),Preferred\nIngram,FG-60F,IM-1,980.00,USD,5,Y\nTD Synnex,,S-1,10.00,USD,2,N\n',
      'vendor_products'
    );
    expect(result.valid).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendor_name: 'Ingram',
      product_sku: 'FG-60F',
      vendor_sku: 'IM-1',
      unit_cost_minor: 98000,
      cost_currency: 'USD',
      lead_time_days: 5,
      is_preferred: 1,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('CSV_MISSING_REQUIRED');
  });
});
