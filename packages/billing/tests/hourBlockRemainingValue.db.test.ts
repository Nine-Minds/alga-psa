import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateString } from '@alga-psa/core';

// Guarded DB test for the remaining-value data path: the hour-block usage report and the MSP hour
// block list compute remaining_value server-side (round(remaining minutes x rate / 60), minor units,
// zero unless the block is active) and carry valid_from. Run with the HOUR_BLOCK_DB_* env and
// HOUR_BLOCK_DB_TESTS=1; skipped by default. The suite creates an isolated tenant and cleans up.

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;

// The actions are withAuth-wrapped and call createTenantKnex(); stub the auth
// stack and point the connection at the real test DB. Everything else
// (tenantDb, withTransaction) keeps its real implementation.
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db })),
  };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

async function seedBase() {
  const clientId = uuidv4();
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  await db('tenants').insert({ tenant, client_name: 'HB TZ Tenant', email: 'hbtz@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB TZ Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB TZ Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'TZ Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  return { clientId, serviceId };
}

async function cleanup() {
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

describe.runIf(enabled)('remaining value and valid_from on the report and the block list', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('computes remaining_value from remaining minutes x rate, zero for non-active blocks', async () => {
    const { clientId, serviceId } = await seedBase();
    try {
      const { grantHourBlock, listHourBlocks } = await import('../src/actions/hourBlockActions');
      const { getHourBlockUsageReport } = await import('../src/actions/contractReportActions');
      const grant = async (reason: string) => {
        const r = await grantHourBlock({ clientId, serviceId, hours: 10, hourlyRate: 11000, expirationDate: null, scopeServiceIds: [], reason });
        return (r as { block_id: string }).block_id;
      };
      const activeId = await grant('value active');
      const expiredId = await grant('value expired');
      // 90 minutes left of an 11000/h block = 16500 minor units.
      await db('hour_blocks').where({ tenant, block_id: activeId }).update({ remaining_minutes: 90, valid_from: '2026-11-01' });
      await db('hour_blocks').where({ tenant, block_id: expiredId }).update({ remaining_minutes: 90, status: 'expired' });

      const report = (await getHourBlockUsageReport()) as Array<Record<string, any>>;
      const active = report.find((row) => row.block_id === activeId)!;
      const expired = report.find((row) => row.block_id === expiredId)!;
      expect(active.remaining_value).toBe(16500);
      expect(active.valid_from).toBe('2026-11-01');
      expect(expired.remaining_value).toBe(0);
      expect(expired.valid_from).toBeNull();

      const listed = (await listHourBlocks(clientId)) as Array<Record<string, any>>;
      const listedActive = listed.find((row) => row.block_id === activeId)!;
      expect(listedActive.remaining_value).toBe(16500);
      expect(listedActive.valid_from).toBe('2026-11-01');
    } finally {
      await cleanup();
    }
  });
});
