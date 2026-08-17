import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { expiringHourBlocksNotificationHandler } from '@alga-psa/jobs/handlers/expiringHourBlocksNotificationHandler';

// DB-backed regression test for the expiring-hour-blocks notification handler
// (29.8.18 mitigation). The invariant: the "today + N days" window is computed
// on the TENANT's calendar date (`tenant_settings.settings.timezone`), NOT the
// worker host's local date and NOT UTC. A Berlin tenant with a 7-day threshold
// gets notified for a 2026-08-31 expiration the moment Berlin enters 2026-08-24
// — even when the worker runs in UTC and still reads 2026-08-23. This suite
// executes the REAL handler against the dev DB with publishEvent stubbed, pins
// the worker process TZ to a zone that disagrees with the tenant's timezone,
// freezes "now" (fake timers), and proves the block is found and emitted with
// the exact calendar date. When no tenant timezone is configured the handler
// falls back to UTC (documented) — that fallback is pinned too.
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
// but point the connection at the test DB. resolveEffectiveTimeZone (from
// @alga-psa/db) stays real and reads the test tenant_settings row.
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

function assertWorkerTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `worker TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

async function seedBase(timezone: string | null) {
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
  await db('tenant_settings').insert({
    tenant,
    settings: timezone ? { timezone } : {},
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
  // The shared dev DB has a background permission provisioner that may race the
  // test lifecycle and insert permissions rows for a freshly-created tenant;
  // clear those first so the tenants delete never trips the FK.
  await db('role_permissions').where({ tenant }).delete();
  await db('permissions').where({ tenant }).delete();
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('tenant_settings').where({ tenant }).delete();
  await db('default_billing_settings').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

/**
 * Runs the real handler and asserts the ONLY emitted block is `expectedBlockId`
 * with the exact calendar expiration date. Any other block in the window would
 * have been emitted too.
 */
async function assertOnlyBlockEmitted(expectedBlockId: string, expectedExpirationDate: string) {
  await expiringHourBlocksNotificationHandler({ tenantId: tenant });

  const published = publishEventMock.mock.calls
    .map(([event]) => event)
    .filter((event) => event?.eventType === 'HOUR_BLOCK_EXPIRING');
  expect(published).toHaveLength(1);
  const blocks = published[0].payload.blocks;
  expect(blocks).toHaveLength(1);
  expect(blocks[0].blockId).toBe(expectedBlockId);
  expect(blocks[0].expirationDate).toBe(expectedExpirationDate);
}

describe.runIf(enabled)('expiring hour-block notification window is the tenant calendar date, worker-independent', () => {
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

  it('windows today+7 on the Berlin tenant calendar while a UTC worker still reads a day earlier (the reviewer\'s scenario)', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase('Europe/Berlin');

    // Freeze "now" at 2026-08-23T22:00Z = 2026-08-24T00:00+02:00 Berlin: tenant
    // today is 2026-08-24 (+7 = 2026-08-31) while the UTC worker still reads
    // 2026-08-23 (+7 = 2026-08-30). The old host-local window hit the wrong day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T22:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin'), 'tenant (Berlin) must read 2026-08-24').toBe('2026-08-24');
    expect(new Date().toISOString().slice(0, 10), 'worker (UTC) must still read 2026-08-23').toBe('2026-08-23');

    try {
      const blockGood = uuidv4();
      const blockWrongDay = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-31');
      // One day earlier than the tenant-local target: the old UTC-window
      // (['2026-08-30','2026-08-31']) wrongly emitted this block.
      await insertBlock(blockWrongDay, clientId, serviceId, '2026-08-30');

      await assertOnlyBlockEmitted(blockGood, '2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('windows today+7 on the Kiritimati tenant calendar while a UTC worker still reads a day earlier', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase('Pacific/Kiritimati');

    // Freeze "now" at 2026-08-23T10:00Z = 2026-08-24T00:00+14:00 Kiritimati.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Pacific/Kiritimati'), 'tenant (Kiritimati) must read 2026-08-24').toBe('2026-08-24');
    expect(new Date().toISOString().slice(0, 10), 'worker (UTC) must still read 2026-08-23').toBe('2026-08-23');

    try {
      const blockGood = uuidv4();
      const blockWrongDay = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-31');
      await insertBlock(blockWrongDay, clientId, serviceId, '2026-08-30');

      await assertOnlyBlockEmitted(blockGood, '2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('produces the identical Berlin window when the worker runs in America/New_York (worker-independence)', async () => {
    assertWorkerTz('America/New_York', 240);
    const { clientId, serviceId } = await seedBase('Europe/Berlin');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T22:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin')).toBe('2026-08-24');
    expect(toCalendarDateStringInTimeZone(new Date(), 'America/New_York')).toBe('2026-08-23');

    try {
      const blockGood = uuidv4();
      const blockWrongDay = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-31');
      await insertBlock(blockWrongDay, clientId, serviceId, '2026-08-30');

      await assertOnlyBlockEmitted(blockGood, '2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('falls back to the UTC calendar when the tenant has no timezone configured (documented)', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase(null);

    // No tenant timezone => UTC calendar: at 2026-08-23T22:00Z UTC-today is
    // 2026-08-23, +7 = 2026-08-30 — the 08-30 block is the target, not 08-31.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-23T22:00:00.000Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-23');

    try {
      const blockGood = uuidv4();
      const blockWrongDay = uuidv4();
      await insertBlock(blockGood, clientId, serviceId, '2026-08-30');
      await insertBlock(blockWrongDay, clientId, serviceId, '2026-08-31');

      await assertOnlyBlockEmitted(blockGood, '2026-08-30');
    } finally {
      await cleanup();
    }
  });
});
