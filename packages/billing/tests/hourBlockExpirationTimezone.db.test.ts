import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateString } from '@alga-psa/core';

// Guarded DB regression test for the hour-block expiration timezone persistence
// bug. A DatePicker selection of 2026-08-31 in Europe/Berlin used to persist as
// 2026-08-30 because the picked local-midnight Date was serialized with
// toISOString() (UTC) on the client AND re-sliced as UTC on the server. This
// suite executes the REAL client-boundary helper (toCalendarDateString) and the
// REAL server actions (grantHourBlock / updateHourBlockExpiration) and proves
// the stored expiration_date equals the selected calendar date.
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
}));

// Replicates what the DatePicker's onChange produces for a calendar day:
// a local-midnight Date in the browser's timezone.
function pickerLocalMidnightFor(isoDateOnly: string): Date {
  const [y, m, d] = isoDateOnly.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

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

describe.runIf(enabled)('hour-block expiration date persists the selected calendar day (timezone)', () => {
  // TZ is process-global; restore it so the zones set by assertTz don't leak
  // into later files in the shared fork.
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
    await db.destroy();
  });

  it('grantHourBlock: selected 2026-08-31 in Europe/Berlin round-trips to the DB byte-for-byte', async () => {
    assertTz('Europe/Berlin', -120);
    const { clientId, serviceId } = await seedBase();
    const blockId = uuidv4();

    try {
      // The picker in Berlin yields a local-midnight Date; the dialog sends it
      // through the REAL client helper before calling the action.
      const picked = pickerLocalMidnightFor('2026-08-31');
      expect(picked.toISOString()).toBe('2026-08-30T22:00:00.000Z');
      const sent = toCalendarDateString(picked);
      expect(sent).toBe('2026-08-31');

      const { grantHourBlock } = await import('../src/actions/hourBlockActions');
      const result = await grantHourBlock({
        clientId,
        serviceId,
        hours: 10,
        hourlyRate: 10000,
        expirationDate: sent,
        scopeServiceIds: [],
        reason: 'tz regression grant',
      });

      expect('block_id' in result).toBe(true);
      const createdBlockId = (result as { block_id: string }).block_id;
      expect(createdBlockId).toBeTruthy();

      const row = await db('hour_blocks').where({ tenant, block_id: createdBlockId }).first();
      expect(row).toBeTruthy();
      expect(toCalendarDateString(row.expiration_date)).toBe('2026-08-31');
      const raw = await db.raw('SELECT expiration_date::text AS d FROM hour_blocks WHERE tenant = ? AND block_id = ?', [tenant, createdBlockId]);
      expect(raw.rows[0].d).toBe('2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('grantHourBlock: selected 2026-08-31 in Pacific/Kiritimati (UTC+14) round-trips to the DB byte-for-byte', async () => {
    assertTz('Pacific/Kiritimati', -840);
    const { clientId, serviceId } = await seedBase();

    try {
      const picked = pickerLocalMidnightFor('2026-08-31');
      expect(picked.toISOString()).toBe('2026-08-30T10:00:00.000Z');
      const sent = toCalendarDateString(picked);
      expect(sent).toBe('2026-08-31');

      const { grantHourBlock } = await import('../src/actions/hourBlockActions');
      const result = await grantHourBlock({
        clientId,
        serviceId,
        hours: 10,
        hourlyRate: 10000,
        expirationDate: sent,
        scopeServiceIds: [],
        reason: 'tz regression grant kiritimati',
      });

      const createdBlockId = (result as { block_id: string }).block_id;
      const row = await db('hour_blocks').where({ tenant, block_id: createdBlockId }).first();
      expect(toCalendarDateString(row.expiration_date)).toBe('2026-08-31');
      const raw = await db.raw('SELECT expiration_date::text AS d FROM hour_blocks WHERE tenant = ? AND block_id = ?', [tenant, createdBlockId]);
      expect(raw.rows[0].d).toBe('2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('updateHourBlockExpiration: new date persists and the audit metadata records previous/new calendar dates', async () => {
    assertTz('Europe/Berlin', -120);
    const { clientId, serviceId } = await seedBase();
    const blockId = uuidv4();

    try {
      await db('hour_blocks').insert({
        block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
        currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
        source_invoice_id: null, source_type: 'grant',
        expiration_date: '2026-08-31',
      });

      const { updateHourBlockExpiration } = await import('../src/actions/hourBlockActions');
      const result = await updateHourBlockExpiration(blockId, '2026-09-15');

      expect('block_id' in result).toBe(true);

      const row = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(toCalendarDateString(row.expiration_date)).toBe('2026-09-15');

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId }).first();
      expect(audit).toBeTruthy();
      expect(audit.type).toBe('expiration_date_change');
      expect(audit.metadata.previous_expiration_date).toBe('2026-08-31');
      expect(audit.metadata.new_expiration_date).toBe('2026-09-15');
    } finally {
      await cleanup();
    }
  });

  it('listHourBlocks/getHourBlockDetail map a stored DATE back to the same calendar string', async () => {
    assertTz('Europe/Berlin', -120);
    const { clientId, serviceId } = await seedBase();
    const blockId = uuidv4();

    try {
      await db('hour_blocks').insert({
        block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
        currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
        source_invoice_id: null, source_type: 'grant',
        expiration_date: '2026-08-31',
      });

      const { listHourBlocks, getHourBlockDetail } = await import('../src/actions/hourBlockActions');
      const rows = await listHourBlocks(clientId);
      const listed = (rows as Array<Record<string, any>>).find((r) => r.block_id === blockId);
      expect(listed?.expiration_date).toBe('2026-08-31');

      const detail = await getHourBlockDetail(blockId);
      expect('block' in detail).toBe(true);
      expect((detail as { block: Record<string, any> }).block.expiration_date).toBe('2026-08-31');
    } finally {
      await cleanup();
    }
  });
});
