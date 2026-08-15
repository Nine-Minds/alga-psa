import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateString } from '@alga-psa/core';
import { expiringHourBlocksNotificationHandler } from '@alga-psa/jobs/handlers/expiringHourBlocksNotificationHandler';

// DB-backed regression test for the expiring-hour-blocks notification handler
// (29.8.18 mitigation). The handler used to build its query window and its event
// payload through UTC round-trips (`toISOString()` slicing and a jobs-local
// `toPlainDate` that routes Date objects through UTC), so in non-UTC timezones a
// block stored with expiration_date = 2026-08-31 was queried against the wrong
// window and emitted with expirationDate = "2026-08-30". This suite executes the
// REAL handler against the dev DB with publishEvent stubbed, pins the process
// timezone AND "today" (fake timers) so that today + threshold = 2026-08-31, and
// proves the block is found and emitted with the exact calendar date.
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

const { publishEventMock } = vi.hoisted(() => ({
  publishEventMock: vi.fn(async () => undefined),
}));

// The handler runs in the Temporal worker and may only publish events; stub the
// publisher to capture the payload. Keep the REAL tenantDb/getConnection shape
// but point the connection at the test DB, mirroring hourBlockExpirationTimezone.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
}));
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
  await db('tenants').insert({ tenant, client_name: 'HB Notif Tenant', email: 'hbnotif@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Notif Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Notif Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Notif Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('default_billing_settings').insert({
    tenant,
    credit_expiration_notification_days: [7],
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: true,
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

async function cleanup() {
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('default_billing_settings').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

describe.runIf(enabled)('expiring hour-block notification preserves the calendar date end to end', () => {
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
    publishEventMock.mockClear();
    vi.useRealTimers();
  });

  it('queries and emits 2026-08-31 as 2026-08-31 in Europe/Berlin (UTC+2)', async () => {
    assertTz('Europe/Berlin', -120);
    const { clientId, serviceId } = await seedBase();

    // Freeze "now" at 2026-08-23T22:00Z = 2026-08-24T00:00+02:00 Berlin, so
    // local today is 2026-08-24 and today + 7 (the configured threshold) = 2026-08-31.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T22:00:00.000Z'));
    expect(toCalendarDateString(new Date()), 'fake timers must pin Berlin to 2026-08-24').toBe('2026-08-24');

    try {
      const blockGood = uuidv4();
      const blockEarly = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-31');
      // One day earlier than the target: the old UTC-sliced window
      // (['2026-08-30','2026-08-31'] in Berlin) wrongly included this block.
      await insertBlock(blockEarly, clientId, serviceId, '2026-08-30');

      await expiringHourBlocksNotificationHandler({ tenantId: tenant, clientId });

      const published = publishEventMock.mock.calls
        .map(([event]) => event)
        .filter((event) => event?.eventType === 'HOUR_BLOCK_EXPIRING');
      expect(published).toHaveLength(1);
      const blocks = published[0].payload.blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].blockId).toBe(blockGood);
      expect(blocks[0].expirationDate).toBe('2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('queries and emits 2026-08-31 as 2026-08-31 in Pacific/Kiritimati (UTC+14)', async () => {
    assertTz('Pacific/Kiritimati', -840);
    const { clientId, serviceId } = await seedBase();

    // Freeze "now" at 2026-08-23T10:00Z = 2026-08-24T00:00+14:00 Kiritimati, so
    // local today is 2026-08-24 and today + 7 = 2026-08-31.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'));
    expect(toCalendarDateString(new Date()), 'fake timers must pin Kiritimati to 2026-08-24').toBe('2026-08-24');

    try {
      const blockGood = uuidv4();
      const blockEarly = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-31');
      await insertBlock(blockEarly, clientId, serviceId, '2026-08-30');

      await expiringHourBlocksNotificationHandler({ tenantId: tenant, clientId });

      const published = publishEventMock.mock.calls
        .map(([event]) => event)
        .filter((event) => event?.eventType === 'HOUR_BLOCK_EXPIRING');
      expect(published).toHaveLength(1);
      const blocks = published[0].payload.blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].blockId).toBe(blockGood);
      expect(blocks[0].expirationDate).toBe('2026-08-31');
    } finally {
      await cleanup();
    }
  });
});
