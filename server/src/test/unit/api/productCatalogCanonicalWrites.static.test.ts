import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Product create/update logic lives in the billing-package core; the REST
// service only delegates to it. The canonical writes are asserted on the core.
const source = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/lib/catalog/productCatalogCore.ts'),
  'utf8',
);
const service = readFileSync(
  path.resolve(process.cwd(), 'src/lib/api/services/ProductCatalogService.ts'),
  'utf8',
);

describe('product catalog canonical billing writes', () => {
  it('writes canonical usage billing_method for product create/update paths', () => {
    expect(source).toContain("billing_method: 'usage'");
    expect(source).not.toContain("billing_method: 'per_unit'");
    expect(service).not.toContain("billing_method: 'per_unit'");
  });

  it('REST service delegates product writes to the core', () => {
    expect(service).toContain('createProductCore(');
    expect(service).toContain('updateProductCore(');
  });

  // service_catalog has no column for these productShape keys; spreading them
  // into the insert/update returns Postgres 42703 (alga0002285).
  it.each(['create', 'update'])('%sProductCore destructures every non-column product key out of the catalog write', (method) => {
    const start = source.indexOf(`export async function ${method}ProductCore(`);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('export ', start + 10);
    const body = source.slice(start, next === -1 ? undefined : next);
    expect(body).toMatch(/currency_code:\s*currencyCode/);
    expect(body).toMatch(/prices:\s*explicitPrices/);
    expect(body).toMatch(/scheduled_prices:\s*scheduledPrices/);
    expect(body).toMatch(/billing_method:\s*_billingMethod/);
  });

  it('productShape non-column keys are all stripped by the service', () => {
    const schema = readFileSync(path.resolve(process.cwd(), 'src/lib/api/schemas/productSchemas.ts'), 'utf8');
    const shape = schema.slice(schema.indexOf('const productShape = {'), schema.indexOf('} as const;'));
    const keys = [...shape.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]);
    const nonColumn = ['currency_code', 'prices', 'scheduled_prices', 'billing_method'];
    for (const key of nonColumn) expect(keys).toContain(key);
    // Any new key must be a service_catalog column; update this list deliberately.
    const columns = ['service_name', 'custom_service_type_id', 'default_rate', 'unit_of_measure', 'unit_code', 'category_id', 'tax_rate_id', 'description', 'sku', 'barcode', 'cost', 'cost_currency', 'vendor', 'manufacturer', 'product_category', 'is_license', 'license_term', 'license_billing_cadence', 'is_active'];
    expect(keys.filter((k) => !nonColumn.includes(k)).sort()).toEqual([...columns].sort());
  });
});
