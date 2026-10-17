import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProductCore: vi.fn(),
  findProductBySkuCore: vi.fn(),
  resolveConfiguredTenantCurrency: vi.fn(),
  createOrMatchVendorCore: vi.fn(),
  upsertVendorProductCore: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/catalog/productCatalogCore', () => ({
  createProductCore: mocks.createProductCore,
  findProductBySkuCore: mocks.findProductBySkuCore,
  normalizeProductSku: (sku: string | null | undefined) => (typeof sku === 'string' && sku.trim() ? sku.trim() : null),
}));
vi.mock('@alga-psa/inventory/lib/tenantCurrency', () => ({
  resolveConfiguredTenantCurrency: mocks.resolveConfiguredTenantCurrency,
}));
vi.mock('@alga-psa/inventory/lib/vendors', () => ({ createOrMatchVendorCore: mocks.createOrMatchVendorCore }));
vi.mock('@alga-psa/inventory/lib/vendorProducts', () => ({ upsertVendorProductCore: mocks.upsertVendorProductCore }));

import {
  ProductMigrationApplier,
  VendorProductMigrationApplier,
} from '../../../lib/migrations/appliers/entityAppliers';

const trx = {} as never;

function context(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    configuration: { products: { serviceTypeId: 'type-1' } },
    resolveReference: vi.fn(),
    ...overrides,
  } as never;
}

const base = { package_record_id: 'p1', source_record_id: 's1', external_identifier_namespace: 'ns' };

describe('ProductMigrationApplier', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveConfiguredTenantCurrency.mockResolvedValue('JPY');
    mocks.createProductCore.mockResolvedValue({ serviceId: 'svc-new' });
    mocks.findProductBySkuCore.mockResolvedValue(null);
  });

  it('matches an existing product by SKU without creating or modifying it', async () => {
    mocks.findProductBySkuCore.mockResolvedValue({ service_id: 'svc-1', service_name: 'Existing', sku: 'A-1' });
    const result = await new ProductMigrationApplier().apply(trx, context(), { ...base, name: 'X', sku: ' A-1 ' });
    expect(mocks.findProductBySkuCore).toHaveBeenCalledWith(trx, 'tenant-1', 'A-1');
    expect(mocks.createProductCore).not.toHaveBeenCalled();
    expect(result).toMatchObject({ targetEntityId: 'svc-1', matchedExisting: true });
    expect(result.warnings?.[0]).toContain('Matched existing product');
  });

  it('creates through the core with minor units as given and the tenant currency for blank currencies', async () => {
    const result = await new ProductMigrationApplier().apply(trx, context(), {
      ...base, name: ' Switch ', sku: 'N-1', price_minor: 1500, cost_minor: 900, category_name: 'Net', is_active: 0,
    });
    expect(result).toEqual({ targetEntityType: 'product', targetEntityId: 'svc-new' });
    const input = mocks.createProductCore.mock.calls[0][2];
    expect(input).toMatchObject({
      service_name: 'Switch', custom_service_type_id: 'type-1', sku: 'N-1', cost: 900,
      cost_currency: 'JPY', product_category: 'Net', is_active: false,
      prices: [{ currency_code: 'JPY', rate: 1500 }],
    });
  });

  it('creates a priceless row without a price so the core applies its default_rate 0', async () => {
    for (const price of [undefined, null]) {
      mocks.createProductCore.mockClear();
      await new ProductMigrationApplier().apply(trx, context(), { ...base, name: 'No Price', sku: 'NP-1', price_minor: price });
      const input = mocks.createProductCore.mock.calls[0][2];
      expect(input).not.toHaveProperty('prices');
      expect(input.default_rate ?? null).toBeNull(); // normalised to 0 in createProductCore (productCatalogCore.test.ts)
    }
  });

  it('keeps an explicit currency and rejects an unsupported one', async () => {
    await new ProductMigrationApplier().apply(trx, context(), { ...base, name: 'A', price_minor: 100, price_currency: 'EUR', cost_minor: 50, cost_currency: 'EUR' });
    expect(mocks.createProductCore.mock.calls[0][2]).toMatchObject({ cost_currency: 'EUR', prices: [{ currency_code: 'EUR', rate: 100 }] });
    await expect(
      new ProductMigrationApplier().apply(trx, context(), { ...base, name: 'A', price_minor: 100, price_currency: 'ZZZ' })
    ).rejects.toThrow('not a supported ISO 4217 code');
  });

  it('fails instead of guessing when the tenant has no currency', async () => {
    mocks.resolveConfiguredTenantCurrency.mockResolvedValue(null);
    await expect(
      new ProductMigrationApplier().apply(trx, context(), { ...base, name: 'A', price_minor: 100 })
    ).rejects.toThrow('no default billing currency');
    expect(mocks.createProductCore).not.toHaveBeenCalled();
  });

  it('refuses an amount converted under a different assumed currency', async () => {
    await expect(
      new ProductMigrationApplier().apply(trx, context(), {
        ...base, name: 'A', price_minor: 12950, extension_json: JSON.stringify({ __assumed_currency: 'USD' }),
      })
    ).rejects.toThrow('assuming USD');
  });

  it('requires a configured service type only when a product must be created', async () => {
    await expect(
      new ProductMigrationApplier().apply(trx, context({ configuration: {} }), { ...base, name: 'A' })
    ).rejects.toThrow('service type is not configured');
  });
});

describe('VendorProductMigrationApplier', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveConfiguredTenantCurrency.mockResolvedValue('JPY');
    mocks.createOrMatchVendorCore.mockResolvedValue({ vendor: { vendor_id: 'v1', vendor_name: 'Ingram Micro' }, created: true });
    mocks.upsertVendorProductCore.mockResolvedValue({ vendor_id: 'v1', service_id: 'svc-1' });
  });

  it('resolves the product by package reference and upserts with an explicit currency', async () => {
    const ctx = context({ resolveReference: vi.fn().mockResolvedValue('svc-1') });
    const result = await new VendorProductMigrationApplier().apply(trx, ctx, {
      ...base, product_package_record_id: 'p1', vendor_name: 'Ingram Micro', unit_cost_minor: 900, lead_time_days: 3, is_preferred: 1,
    });
    expect(mocks.upsertVendorProductCore).toHaveBeenCalledWith(trx, 'tenant-1', expect.objectContaining({
      vendor_id: 'v1', service_id: 'svc-1', unit_cost: 900, cost_currency: 'JPY', lead_time_days: 3, is_preferred: true,
    }));
    expect(result).toMatchObject({ targetEntityType: 'vendor', targetEntityId: 'v1', warnings: ['Created vendor "Ingram Micro".'] });
  });

  it('falls back to product_sku and fails when neither resolves', async () => {
    mocks.findProductBySkuCore.mockResolvedValue({ service_id: 'svc-9' });
    await new VendorProductMigrationApplier().apply(trx, context(), { ...base, product_sku: 'A-1', vendor_name: 'V' });
    expect(mocks.upsertVendorProductCore.mock.calls[0][2]).toMatchObject({ service_id: 'svc-9', is_preferred: false, unit_cost: null });

    mocks.findProductBySkuCore.mockResolvedValue(null);
    await expect(
      new VendorProductMigrationApplier().apply(trx, context(), { ...base, product_sku: 'NOPE', vendor_name: 'V' })
    ).rejects.toThrow('No product with SKU NOPE');
    const unapplied = context({ resolveReference: vi.fn().mockResolvedValue(null) });
    await expect(
      new VendorProductMigrationApplier().apply(trx, unapplied, { ...base, product_package_record_id: 'p9', vendor_name: 'V' })
    ).rejects.toThrow('has not been applied');
  });
});
