import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateString } from '@alga-psa/core';
import { expiredHourBlocksHandler } from '@alga-psa/jobs/handlers/expiredHourBlocksHandler';

// DB-backed regression test for the auto-expiration handler's "today" boundary
// (29.8.18 mitigation). The handler used to derive today via
// `toISODate(toPlainDate(new Date().toISOString()))`, which reads the UTC
// calendar date — so in positive-offset zones (Berlin UTC+2, Kiritimati UTC+14)
// a block whose expiration_date has already passed locally was not expired for
// up to 24h (e.g. a block expiring 2026-08-31 stayed active through local
// 2026-09-01 until UTC also reached 09-01). This suite executes the REAL handler
// against the dev DB, pins the process timezone AND "today" (fake timers), and
// asserts both the status='expired' update and the auto_expiration audit row.
//
// The conversion is process-timezone-dependent, so each test pins TZ and guards
// that Node honored it via getTimezoneOffset() before asserting on dates.
//
// Run ONLY against an explicitly provided database with:
//   HOUR_BLOCK_DB_HOST HOUR_BLOCK_DB_PORT HOUR_BLOCK_DB_USER
//   HOUR_BLOCK_DB_PASSWORD HOUR_BLOCK_DB_NAME HOUR_BLOCK_DB_TESTS=1
// The suite creates an isolated tenant and cleans up after itself. Skipped by
// default so CI (which has no test DB) stays green.

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

const originalTz = process.env.TZ;

let db: Knex;
let tenant: string;

// Point the REAL handler at the test DB, mirroring hourBlockExpiringNotification.
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    getConnection: vi.fn(async () => db),
    runWithTenant: vi.fn(async (_tenantId: string, fn: () => Promise<void>) => fn()),
  };
});

function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

async function seedBase() {
  const clientId = uuidv4();
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  await db('tenants').insert({ tenant, client_name: 'HB AutoExpire Tenant', email: 'hbautoexpire@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB AutoExpire Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB AutoExpire Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'AutoExpire Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  return { clientId, serviceId };
}

async function insertBlock(blockId: string, clientId: string, serviceId: string, expirationDate: string) {
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
    total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 60000,
    currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
    source_invoice_id: null, source_type: 'grant',
    expiration_date: expirationDate,
  });
}

async function blockStatus(blockId: string): Promise<string> {
  const row = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
  return row?.status;
}

async function auditRows(blockId: string): Promise<any[]> {
  return db('hour_block_audit').where({ tenant, block_id: blockId }).select('type', 'metadata');
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

describe.runIf(enabled)('hour-block auto-expiration "today" boundary is server-local, not UTC', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
  });

  afterAll(async () => {
    if (originalTz) {
      process.env.TZ = originalTz;
    } else {
      delete process.env.TZ;
    }
    await db.destroy();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires a block on local 2026-09-01 in Europe/Berlin while UTC still reads 2026-08-31 (the reproduced failure)', async () => {
    assertTz('Europe/Berlin', -120);
    const { clientId, serviceId } = await seedBase();

    // Freeze "now" at 2026-08-31T22:00Z = 2026-09-01T00:00+02:00 Berlin: local
    // today is 2026-09-01 while UTC today is still 2026-08-31 — the exact window
    // where the old UTC-today derivation delayed auto-expiration by a day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T22:00:00.000Z'));
    expect(toCalendarDateString(new Date()), 'fake timers must pin Berlin to 2026-09-01').toBe('2026-09-01');
    expect(new Date().toISOString().slice(0, 10), 'UTC must still read 2026-08-31').toBe('2026-08-31');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-31');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-09-01');

      await expiredHourBlocksHandler({ tenantId: tenant, clientId });

      expect(await blockStatus(blockExpired)).toBe('expired');
      const audit = await auditRows(blockExpired);
      expect(audit).toHaveLength(1);
      expect(audit[0].type).toBe('auto_expiration');
      expect(audit[0].metadata?.remaining_minutes_at_expiration).toBe(600);
      expect(audit[0].metadata?.expiration_date).toBe('2026-08-31');

      expect(await blockStatus(blockStillActive)).toBe('active');
      expect(await auditRows(blockStillActive)).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('expires a block on local 2026-08-31 in Pacific/Kiritimati while UTC still reads 2026-08-30', async () => {
    assertTz('Pacific/Kiritimati', -840);
    const { clientId, serviceId } = await seedBase();

    // Freeze "now" at 2026-08-30T10:00Z = 2026-08-31T00:00+14:00 Kiritimati: local
    // today is 2026-08-31 while UTC today is still 2026-08-30.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'));
    expect(toCalendarDateString(new Date()), 'fake timers must pin Kiritimati to 2026-08-31').toBe('2026-08-31');
    expect(new Date().toISOString().slice(0, 10), 'UTC must still read 2026-08-30').toBe('2026-08-30');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-30');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-08-31');

      await expiredHourBlocksHandler({ tenantId: tenant, clientId });

      expect(await blockStatus(blockExpired)).toBe('expired');
      const audit = await auditRows(blockExpired);
      expect(audit).toHaveLength(1);
      expect(audit[0].type).toBe('auto_expiration');
      expect(audit[0].metadata?.remaining_minutes_at_expiration).toBe(600);
      expect(audit[0].metadata?.expiration_date).toBe('2026-08-30');

      expect(await blockStatus(blockStillActive)).toBe('active');
      expect(await auditRows(blockStillActive)).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});
