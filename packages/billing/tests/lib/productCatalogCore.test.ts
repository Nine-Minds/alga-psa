import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/shared/billingClients/tenantUnitsOfMeasure', () => ({
  resolveCatalogUnitForCreate: vi.fn(async () => ({})),
  resolveCatalogUnitForUpdate: vi.fn(async () => ({})),
}));
vi.mock('@alga-psa/shared/billingClients/defaultTaxRate', () => ({
  resolveCatalogTaxRateIdForCreate: vi.fn(async () => null),
}));

import { tenantDb } from '@alga-psa/db';
import { createProductCore, normalizeProductSku, ProductCatalogCoreError, updateProductCore } from '../../src/lib/catalog/productCatalogCore';

function insertFailing(constraint: string) {
  vi.mocked(tenantDb).mockReturnValue({
    table: () => ({
      insert: () => ({ returning: async () => Promise.reject(Object.assign(new Error('dup'), { code: '23505', constraint })) }),
    }),
  } as never);
}

describe('productCatalogCore', () => {
  it('normalizes SKUs by trimming and treats blanks as absent', () => {
    expect(normalizeProductSku('  A-1 ')).toBe('A-1');
    expect(normalizeProductSku('   ')).toBeNull();
    expect(normalizeProductSku(undefined)).toBeNull();
  });

  it('maps unique violations to typed errors', async () => {
    insertFailing('service_catalog_product_sku_unique');
    await expect(createProductCore({} as never, 't', { cost_currency: 'USD', service_name: 'x' })).rejects.toMatchObject({
      name: 'ProductCatalogCoreError',
      code: 'sku_conflict',
    });
    insertFailing('service_catalog_product_barcode_unique');
    await expect(createProductCore({} as never, 't', { cost_currency: 'USD', service_name: 'x' })).rejects.toMatchObject({
      code: 'barcode_conflict',
    });
  });

  it('stores default_rate 0 when a product is created without a price', async () => {
    const insert = vi.fn(() => ({ returning: async () => [{ service_id: 's1' }] }));
    vi.mocked(tenantDb).mockReturnValue({ table: () => ({ insert }) } as never);
    for (const input of [{}, { default_rate: undefined }, { default_rate: null }, { default_rate: '' }]) {
      insert.mockClear();
      await createProductCore({} as never, 't', { cost_currency: 'USD', service_name: 'x', ...input } as never);
      expect((insert.mock.calls[0] as unknown[])[0]).toMatchObject({ default_rate: 0 });
    }
    insert.mockClear();
    await createProductCore({} as never, 't', { cost_currency: 'USD', service_name: 'x', default_rate: 1250 } as never);
    expect((insert.mock.calls[0] as unknown[])[0]).toMatchObject({ default_rate: 1250 });
  });

  it('reports a missing or non-product row as not_found', async () => {
    vi.mocked(tenantDb).mockReturnValue({
      table: () => ({ where: () => ({ select: () => ({ first: async () => ({ item_kind: 'service' }) }) }) }),
    } as never);
    const error = await updateProductCore({} as never, 't', 'id', { service_name: 'y' }).catch((e) => e);
    expect(error).toBeInstanceOf(ProductCatalogCoreError);
    expect(error.code).toBe('not_found');
  });
});
