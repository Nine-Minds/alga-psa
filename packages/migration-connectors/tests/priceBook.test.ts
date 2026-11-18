import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmpSqliteReader } from '@alga-psa/migration-sdk';
import {
  convertPriceBookSpreadsheet,
  inferPriceBookMapping,
  inspectSpreadsheet,
  isPriceBookTarget,
} from '../src/csv/index';

let workDir: string;
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'amp-pricebook-test-'));
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeCsv(text: string): Promise<string> {
  const path = join(workDir, `${Math.random().toString(36).slice(2)}.csv`);
  await writeFile(path, text, 'utf8');
  return path;
}

async function convert(csv: string, defaultCurrency?: string, mappingOverride?: Record<string, string>) {
  const path = await writeCsv(csv);
  const mapping = mappingOverride ?? (await inferPriceBookMapping(path));
  const outputPath = join(workDir, `${Math.random().toString(36).slice(2)}.amp`);
  const result = await convertPriceBookSpreadsheet(
    { outputPath, namespace: 'csv:test', sourceSystem: 'csv-upload', defaultCurrency, path, mapping },
    workDir
  );
  const reader = new AmpSqliteReader(outputPath);
  try {
    return {
      result,
      products: reader.allRows('products'),
      services: reader.allRows('services'),
      prices: reader.allRows('catalog_prices'),
    };
  } finally {
    reader.close();
  }
}

const ext = (row: Record<string, unknown>) => JSON.parse(String(row.extension_json ?? 'null'));

describe('price book mapping (T17)', () => {
  it('infers aliases, including repeated Price <CCY> columns and Item ref', async () => {
    const path = await writeCsv('Item ref,Type,SKU,Name,Price USD,Price (CAD),EUR Price,Service Type,Colour\n');
    expect(await inferPriceBookMapping(path)).toEqual({
      'Item ref': 'item_ref',
      Type: 'item_kind',
      SKU: 'sku',
      Name: 'name',
      'Price USD': 'price:USD',
      'Price (CAD)': 'price:CAD',
      'EUR Price': 'price:EUR',
      'Service Type': 'service_type',
    });
    expect(isPriceBookTarget('price:CAD')).toBe(true);
    expect(isPriceBookTarget('price:ZZZ')).toBe(false);
    expect(isPriceBookTarget('rate_minor')).toBe(false);
  });

  it('the confirmed mapping replaces the inferred one', async () => {
    const csv = 'Part,Label,Amount\nA1,Widget,10.00\n';
    const path = await writeCsv(csv);
    expect(await inferPriceBookMapping(path)).toMatchObject({ Part: 'sku' });
    const { prices, products } = await convert(csv, 'USD', { Part: 'sku', Label: 'name', Amount: 'price' });
    expect(products).toHaveLength(1);
    expect(prices[0]).toMatchObject({ rate_minor: 1000, currency: 'USD', sku: 'A1' });
  });

  it('rejects a target that is not a price book column', async () => {
    await expect(convert('A,B\n1,2\n', 'USD', { A: 'rate_minor', B: 'name' })).rejects.toThrow(/not a price book column/);
  });

  it('inspects headers, capped truncated sample rows and the proposed mapping', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => `S${i},${'x'.repeat(200)}`).join('\n');
    const path = await writeCsv(`SKU,Name\n${rows}\n`);
    const inspection = await inspectSpreadsheet(path, { sampleRows: 50 });
    expect(inspection.sampleRows).toHaveLength(5);
    expect(inspection.sampleRows[0].Name).toHaveLength(120);
    expect(inspection.mapping).toEqual({ SKU: 'sku', Name: 'name' });
  });
});

describe('price book conversion', () => {
  it('routes rows by kind, ref, sku and name, preserving original row numbers', async () => {
    const { result, products, services, prices } = await convert(
      [
        'Item ref,Type,SKU,Name,Price',
        ',,P-1,Widget,10.00', // row 1: product (has a SKU)
        ',,,Onboarding,200.00', // row 2: service
        'abc-123,,,,15.00', // row 3: ref only -> price only
        ',,,,9.99', // row 4: nothing identifies it
        ',service,S-9,Hosting,5.00', // row 5: explicit service with sku
        ',,P-2,Gadget,', // row 6: item only
      ].join('\n') + '\n',
      'USD'
    );
    expect(result.valid).toBe(true);
    expect(products.map((r) => r.source_record_id).sort()).toEqual(['row-1', 'row-6']);
    expect(services.map((r) => r.source_record_id).sort()).toEqual(['row-2', 'row-5']);
    expect(prices.map((r) => r.source_record_id).sort()).toEqual(['row-1-DEFAULT', 'row-2-DEFAULT', 'row-3-DEFAULT', 'row-5-DEFAULT']);
    const byId = Object.fromEntries(prices.map((r) => [r.source_record_id as string, r]));
    expect(byId['row-1-DEFAULT']).toMatchObject({ product_package_record_id: 'products-row-1', item_kind: 'product', rate_minor: 1000, currency: 'USD' });
    expect(byId['row-2-DEFAULT']).toMatchObject({ service_package_record_id: 'services-row-2', item_kind: 'service', rate_minor: 20000 });
    // A ref row carries only the ref: no item record is created for it.
    expect(byId['row-3-DEFAULT']).toMatchObject({ item_ref: 'abc-123', product_package_record_id: null, service_package_record_id: null, rate_minor: 1500 });
    expect(result.diagnostics.some((d) => d.code === 'CSV_MISSING_REQUIRED' && d.message.includes('row 4'))).toBe(true);
    // Items carry no price.
    expect(products[0].price_minor ?? null).toBeNull();
  });

  it('writes one catalog price per currency column', async () => {
    const { result, prices } = await convert('SKU,Name,Price USD,Price CAD\nA1,Widget,10.00,13.50\n');
    expect(result.valid).toBe(true);
    expect(prices.map((r) => [r.source_record_id, r.currency, r.rate_minor]).sort()).toEqual([
      ['row-1-CAD', 'CAD', 1350],
      ['row-1-USD', 'USD', 1000],
    ]);
  });

  it('a blank currency cell takes the job currency explicitly, with the exponent of that currency', async () => {
    const { prices } = await convert('SKU,Name,Price,Currency\nA1,Widget,1500,\nA2,Gadget,10.00,EUR\n', 'JPY');
    const byId = Object.fromEntries(prices.map((r) => [r.sku as string, r]));
    expect(byId.A1).toMatchObject({ currency: 'JPY', rate_minor: 1500 });
    expect(ext(byId.A1)).toBeNull();
    expect(byId.A2).toMatchObject({ currency: 'EUR', rate_minor: 1000, source_record_id: 'row-2-EUR' });
  });

  it('JPY has no decimals: a fractional yen price is an unreadable price, not a rounded one', async () => {
    const { prices } = await convert('SKU,Name,Price,Currency\nA1,Widget,1500.5,JPY\n');
    expect(prices[0].rate_minor).toBeNull();
    expect(ext(prices[0])).toEqual({ __price_text: '1500.5', __price_error: 'precision' });
  });

  it('reports currency_unresolved with no row currency and no default', async () => {
    const { prices, result } = await convert('SKU,Name,Price\nA1,Widget,10.00\n');
    expect(result.valid).toBe(true);
    expect(prices[0]).toMatchObject({ rate_minor: null, currency: null });
    expect(ext(prices[0])).toEqual({ __price_text: '10.00', __price_error: 'currency_unresolved' });
  });

  it('flags an unsupported currency cell and a negative amount', async () => {
    const { prices } = await convert('SKU,Name,Price,Currency\nA1,W,10.00,XXX\nA2,G,-5.00,USD\n');
    const byId = Object.fromEntries(prices.map((r) => [r.sku as string, r]));
    expect(ext(byId.A1).__price_error).toBe('currency_unsupported');
    expect(ext(byId.A2).__price_error).toBe('negative');
  });

  it('an item-only row creates the item and no price', async () => {
    const { products, prices, result } = await convert('SKU,Name,Price\nA1,Widget,\n', 'USD');
    expect(result.valid).toBe(true);
    expect(products).toHaveLength(1);
    expect(prices).toHaveLength(0);
  });
});
