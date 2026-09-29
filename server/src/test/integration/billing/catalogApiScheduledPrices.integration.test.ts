import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { ServiceCatalogService } from '@/lib/api/services/ServiceCatalogService';
import { ProductCatalogService } from '@/lib/api/services/ProductCatalogService';

/**
 * Round-3 coverage: the REST catalog reads must not hand a caller a
 * not-yet-effective price. `service_prices` is effective-dated, so a bare
 * `.where(service_id).select('*')` returns the scheduled row too; these paths
 * split `prices` (current) from `scheduled_prices` (future).
 */

let db: Knex;
let tenantId: string;
let userId: string;

// The action/read split is relative to the real clock, so schedule far enough
// ahead that the future row is genuinely future.
const FUTURE_EFFECTIVE = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))
    .toISOString()
    .slice(0, 10);
})();

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    requireTenantId: vi.fn(async () => tenantId),
  };
});

const HOOK_TIMEOUT = 300_000;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedCatalogEntry(options: {
  itemKind: 'service' | 'product';
  serviceName: string;
}): Promise<string> {
  const serviceTypeId = uuidv4();
  await table('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `${options.serviceName} type`,
  });

  const serviceId = uuidv4();
  await table('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: options.serviceName,
    billing_method: options.itemKind === 'product' ? 'usage' : 'fixed',
    custom_service_type_id: serviceTypeId,
    default_rate: 10000,
    unit_of_measure: 'each',
    item_kind: options.itemKind,
    is_active: true,
  });

  await table('service_prices').insert([
    {
      price_id: uuidv4(),
      tenant: tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: 10000,
      effective_date: '1970-01-01',
    },
    {
      price_id: uuidv4(),
      tenant: tenantId,
      service_id: serviceId,
      currency_code: 'USD',
      rate: 12000,
      effective_date: FUTURE_EFFECTIVE,
    },
  ]);

  return serviceId;
}

function serviceFor<T>(Ctor: new () => T): T {
  const service = new Ctor();
  vi.spyOn(service as { getKnex: () => Promise<unknown> }, 'getKnex')
    .mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

describe('catalog API reads split current from scheduled prices', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'test_db_catalog_api' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'Catalog API Fixture',
        email: `catalog-api-${tenantId.slice(0, 8)}@example.test`,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    userId = uuidv4();
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.getById returns current in prices and future in scheduled_prices', async () => {
    const serviceId = await seedCatalogEntry({ itemKind: 'service', serviceName: 'API Service' });
    const service = serviceFor(ServiceCatalogService);

    const result = await service.getById(serviceId, { tenant: tenantId, userId } as never);

    expect(result).not.toBeNull();
    expect(result!.prices).toHaveLength(1);
    expect(Number(result!.prices![0].rate)).toBe(10000);
    expect(result!.scheduled_prices).toHaveLength(1);
    expect(Number(result!.scheduled_prices![0].rate)).toBe(12000);
  }, HOOK_TIMEOUT);

  it('ServiceCatalogService.list returns only the current price as prices', async () => {
    const serviceId = await seedCatalogEntry({ itemKind: 'service', serviceName: 'API List Service' });
    const service = serviceFor(ServiceCatalogService);

    const result = await service.list(
      { filters: {}, page: 1, limit: 25 },
      { tenant: tenantId, userId } as never,
    );

    const row = (result.data as Array<{ service_id: string; prices?: unknown[]; scheduled_prices?: unknown[] }>)
      .find((entry) => entry.service_id === serviceId);
    expect(row).toBeDefined();
    expect(row!.prices).toHaveLength(1);
    expect(Number((row!.prices![0] as { rate: number }).rate)).toBe(10000);
    expect(row!.scheduled_prices).toHaveLength(1);
    expect(Number((row!.scheduled_prices![0] as { rate: number }).rate)).toBe(12000);
  }, HOOK_TIMEOUT);

  it('ProductCatalogService.getById splits prices for a product', async () => {
    const productId = await seedCatalogEntry({ itemKind: 'product', serviceName: 'API Product' });
    const productService = serviceFor(ProductCatalogService);

    const result = await productService.getById(productId, { tenant: tenantId, userId } as never);

    expect(result).not.toBeNull();
    expect(result!.prices).toHaveLength(1);
    expect(Number(result!.prices![0].rate)).toBe(10000);
    expect(result!.scheduled_prices).toHaveLength(1);
    expect(Number(result!.scheduled_prices![0].rate)).toBe(12000);
  }, HOOK_TIMEOUT);
});
