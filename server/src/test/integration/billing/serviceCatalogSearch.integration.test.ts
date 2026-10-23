import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let userId: string;

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction)),
    requireTenantId: vi.fn(async () => tenantId),
  };
});

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

let getServices: typeof import('@alga-psa/billing/actions/serviceActions')['getServices'];

describe('service catalog management search', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'test_db_catalog_search' });
    tenantId = uuidv4();
    otherTenantId = uuidv4();
    userId = uuidv4();
    for (const [tenant, suffix] of [[tenantId, 'primary'], [otherTenantId, 'other']] as const) {
      await tenantDb(db, tenant).unscoped('tenants', 'test fixture creates tenant rows').insert({
        tenant,
        client_name: `Catalog Search ${suffix}`,
        email: `catalog-search-${suffix}-${tenant.slice(0, 8)}@example.test`,
      });
    }
    setupCommonMocks({ tenantId, userId, permissionCheck: () => true });
    ({ getServices } = await import('@alga-psa/billing/actions/serviceActions'));
  }, 300_000);

  afterAll(async () => {
    if (db) {
      await db('service_catalog').whereIn('tenant', [tenantId, otherTenantId]).delete();
      await db('service_types').whereIn('tenant', [tenantId, otherTenantId]).delete();
      await db('tenants').whereIn('tenant', [tenantId, otherTenantId]).delete();
      await db.destroy();
    }
  });

  it('searches only matching services in the active tenant and counts filtered rows', async () => {
    const matchingService = uuidv4();
    const matchingProduct = uuidv4();
    const otherTenantService = uuidv4();
    const serviceTypeId = uuidv4();
    const otherServiceTypeId = uuidv4();
    await db('service_types').insert([
      { id: serviceTypeId, tenant: tenantId, name: 'Search test service type' },
      { id: otherServiceTypeId, tenant: otherTenantId, name: 'Other tenant service type' },
    ]);
    const rows = [
      { tenant: tenantId, service_id: matchingService, service_name: 'Searchable managed service', item_kind: 'service', custom_service_type_id: serviceTypeId },
      { tenant: tenantId, service_id: matchingProduct, service_name: 'Searchable managed product', item_kind: 'product', custom_service_type_id: serviceTypeId },
      { tenant: otherTenantId, service_id: otherTenantService, service_name: 'Searchable other tenant service', item_kind: 'service', custom_service_type_id: otherServiceTypeId },
    ];
    await db('service_catalog').insert(rows.map((row) => ({
      ...row,
      billing_method: 'fixed',
      default_rate: 10000,
      unit_of_measure: 'each',
      is_active: true,
    })));

    const result = await getServices(1, 10, { item_kind: 'service', search: 'Searchable' });
    expect(result).toMatchObject({ totalCount: 1, page: 1, pageSize: 10 });
    expect('services' in result ? result.services.map((service) => service.service_id) : []).toEqual([matchingService]);
  });
});
