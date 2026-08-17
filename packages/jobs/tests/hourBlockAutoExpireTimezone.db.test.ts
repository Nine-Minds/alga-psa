import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import { expiredHourBlocksHandler } from '@alga-psa/jobs/handlers/expiredHourBlocksHandler';
import { allocateTimeEntry } from '@alga-psa/shared/billingClients/hourBlockService';

// DB-backed regression test for the auto-expiration handler's "today" boundary
// (29.8.18 mitigation). The invariant: "today" is the calendar date in the
// TENANT's IANA timezone (`tenant_settings.settings.timezone`), NOT the worker
// host's local date and NOT UTC. A Berlin tenant's block expiring 2026-08-31 is
// expired the moment Berlin enters 2026-09-01 — even when the worker runs in
// UTC (or any other zone) and still reads 2026-08-31. A UTC worker and a Berlin
// worker must produce identical expiration behavior for the same tenant.
//
// This suite executes the REAL handler against the dev DB, pins the worker
// process TZ to a zone that disagrees with the tenant's timezone, freezes "now"
// (fake timers) at an instant where the tenant-local date has rolled over but
// the worker-local date has not, and asserts both the status='expired' update
// and the auto_expiration audit row. When no tenant timezone is configured the
// handler falls back to UTC (documented, deterministic across workers) — that
// fallback is pinned too.
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
// resolveEffectiveTimeZone (from @alga-psa/db) stays real and reads the test
// tenant_settings row.
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
  await db('tenants').insert({ tenant, client_name: 'HB AutoExpire Tenant', email: 'hbautoexpire@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB AutoExpire Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB AutoExpire Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'AutoExpire Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('tenant_settings').insert({
    tenant,
    settings: timezone ? { timezone } : {},
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
  // The shared dev DB has a background permission provisioner that may race the
  // test lifecycle and insert permissions rows for a freshly-created tenant;
  // clear those first so the tenants delete never trips the FK.
  await db('role_permissions').where({ tenant }).delete();
  await db('permissions').where({ tenant }).delete();
  await db('hour_block_time_allocations').where({ tenant }).delete();
  await db('hour_block_service_scopes').where({ tenant }).delete();
  await db('hour_block_audit').where({ tenant }).delete();
  await db('hour_blocks').where({ tenant }).delete();
  await db('time_entries').where({ tenant }).delete();
  await db('tickets').where({ tenant }).delete();
  await db('users').where({ tenant }).delete();
  await db('invoices').where({ tenant }).delete();
  await db('invoice_charges').where({ tenant }).delete();
  await db('tenant_settings').where({ tenant }).delete();
  await db('service_catalog').where({ tenant }).delete();
  await db('service_types').where({ tenant }).delete();
  await db('clients').where({ tenant }).delete();
  await db('tenants').where({ tenant }).delete();
}

/**
 * Asserts the full auto-expiration outcome for a pair of blocks around the
 * boundary at a frozen instant: `expiredBlock` (expires the tenant-local day
 * before the frozen instant) MUST be expired; `activeBlock` (expires the
 * tenant-local day of the frozen instant) MUST NOT be.
 */
async function assertBoundary(
  expiredBlock: string,
  activeBlock: string,
  expectedExpiredAuditDate: string,
) {
  await expiredHourBlocksHandler({ tenantId: tenant });

  expect(await blockStatus(expiredBlock), 'past-tenant-day block must be auto-expired').toBe('expired');
  const audit = await auditRows(expiredBlock);
  expect(audit).toHaveLength(1);
  expect(audit[0].type).toBe('auto_expiration');
  expect(audit[0].metadata?.remaining_minutes_at_expiration).toBe(600);
  expect(audit[0].metadata?.expiration_date).toBe(expectedExpiredAuditDate);

  expect(await blockStatus(activeBlock), 'tenant-today block must NOT be auto-expired').toBe('active');
  expect(await auditRows(activeBlock)).toHaveLength(0);
}

describe.runIf(enabled)('hour-block auto-expiration "today" is the tenant calendar date, worker-independent', () => {
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

  it('expires a Berlin block on tenant 2026-09-01 while a UTC worker still reads 2026-08-31 (the reviewer\'s exact scenario)', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase('Europe/Berlin');

    // Freeze "now" at 2026-08-31T22:00Z = 2026-09-01T00:00+02:00 Berlin: tenant
    // today is 2026-09-01 while worker (UTC) today is still 2026-08-31 — the
    // window where the old host-local/UTC-today derivation delayed auto-expiration.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T22:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin'), 'tenant (Berlin) must read 2026-09-01').toBe('2026-09-01');
    expect(new Date().toISOString().slice(0, 10), 'worker (UTC) must still read 2026-08-31').toBe('2026-08-31');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-31');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-09-01');

      await assertBoundary(blockExpired, blockStillActive, '2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('expires a Kiritimati block on tenant 2026-08-31 while a UTC worker still reads 2026-08-30', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase('Pacific/Kiritimati');

    // Freeze "now" at 2026-08-30T10:00Z = 2026-08-31T00:00+14:00 Kiritimati.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Pacific/Kiritimati'), 'tenant (Kiritimati) must read 2026-08-31').toBe('2026-08-31');
    expect(new Date().toISOString().slice(0, 10), 'worker (UTC) must still read 2026-08-30').toBe('2026-08-30');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-30');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-08-31');

      await assertBoundary(blockExpired, blockStillActive, '2026-08-30');
    } finally {
      await cleanup();
    }
  });

  it('produces the identical Berlin result when the worker runs in America/New_York (worker-independence)', async () => {
    assertWorkerTz('America/New_York', 240);
    const { clientId, serviceId } = await seedBase('Europe/Berlin');

    // Freeze "now" at 2026-08-31T22:00Z = 2026-09-01T00:00+02:00 Berlin; the New
    // York worker reads 2026-08-31T18:00 and the Berlin tenant reads 2026-09-01.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T22:00:00.000Z'));
    expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin')).toBe('2026-09-01');
    expect(toCalendarDateStringInTimeZone(new Date(), 'America/New_York')).toBe('2026-08-31');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-31');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-09-01');

      await assertBoundary(blockExpired, blockStillActive, '2026-08-31');
    } finally {
      await cleanup();
    }
  });

  it('falls back to UTC-today when the tenant has no timezone configured (documented, worker-independent)', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase(null);

    // No tenant timezone => the boundary is UTC-today. At 2026-08-31T22:00Z
    // UTC-today is 2026-08-31: the block expiring 08-31 is still tenant-today
    // (NOT expired) and 08-30 is past (expired).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T22:00:00.000Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-31');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-30');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-08-31');

      await assertBoundary(blockExpired, blockStillActive, '2026-08-30');
    } finally {
      await cleanup();
    }
  });

  it('treats an invalid stored tenant timezone as unset (UTC fallback)', async () => {
    assertWorkerTz('UTC', 0);
    const { clientId, serviceId } = await seedBase('Not/AZone');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T22:00:00.000Z'));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-31');

    try {
      const blockExpired = uuidv4();
      const blockStillActive = uuidv4();
      await insertBlock(blockExpired, clientId, serviceId, '2026-08-30');
      await insertBlock(blockStillActive, clientId, serviceId, '2026-08-31');

      await assertBoundary(blockExpired, blockStillActive, '2026-08-30');
    } finally {
      await cleanup();
    }
  });

  // Genuinely-concurrent expiration coverage (29.8.18 Blocker 2): the nightly
  // expiration pass and a back-dated burn race on the same block — the block's
  // expiration day has passed on the tenant calendar (the job wants to expire
  // it) while an entry WORKED on that day is still eligible to burn it. Both
  // sides now row-lock the hour_blocks row (canonical order), so the
  // interleaving serializes: the burn commits while the block is active and
  // the job then expires the post-burn state — the job never re-reads a
  // stale pre-burn row, and the burn never lands on an already-expired block.
  it('race: a back-dated burn committing mid-expiration serializes — the job parks at the row lock and expires the post-burn state', async () => {
    const originalTzState = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const { clientId, serviceId } = await seedBase(null); // UTC fallback: deterministic "today"
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const blockId = uuidv4();
      await insertBlock(blockId, clientId, serviceId, yesterday);

      // Ticket + user + back-dated entry (worked ON the expiration day, so the
      // burn engine still considers the block eligible for it).
      const ticketId = uuidv4();
      await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'HB Expire Race Ticket', ticket_number: `HB-EXPR-${ticketId.slice(0, 8)}` });
      const entryUserId = uuidv4();
      await db('users').insert({
        tenant, user_id: entryUserId, username: `hbexpr_${entryUserId.slice(0, 8)}`,
        hashed_password: 'x', email: `hbexpr_${entryUserId.slice(0, 8)}@test.local`,
      });
      const entryId = uuidv4();
      const start = new Date(`${yesterday}T09:00:00.000Z`);
      const entry = {
        entry_id: entryId, service_id: serviceId, billable_duration: 120, contract_line_id: null,
        work_item_id: ticketId, work_item_type: 'ticket', work_date: yesterday, start_time: start.toISOString(),
      };
      await db('time_entries').insert({
        tenant, entry_id: entryId, user_id: entryUserId, service_id: serviceId,
        work_item_id: ticketId, work_item_type: 'ticket',
        start_time: start.toISOString(), end_time: new Date(start.getTime() + 120 * 60000).toISOString(),
        work_date: yesterday, work_timezone: 'UTC',
        billable_duration: 120, approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
      });

      // Transaction A (the burn side): lock the block — where a mid-flight
      // allocateTimeEntry sits after its eligible-block select.
      const holderDb = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 1 } });
      try {
        const holderTrx = await holderDb.transaction();
        await holderTrx('hour_blocks').where({ tenant, block_id: blockId }).select('block_id').forUpdate();

        // Transaction B: the nightly job starts and must PARK at its own
        // SELECT ... FOR UPDATE on the candidate rows.
        let handlerSettled = false;
        const handlerPromise = (async () => {
          await expiredHourBlocksHandler({ tenantId: tenant });
          handlerSettled = true;
        })();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(handlerSettled, 'the expiration pass must block on the hour_blocks row lock while the burn holds it').toBe(false);

        // The burn commits (real burn engine, same locking discipline) while
        // the block is still active.
        const allocations = await allocateTimeEntry(holderTrx as unknown as Knex.Transaction, tenant, clientId, entry);
        expect(allocations).toEqual([{ block_id: blockId, minutes: 120 }]);
        await holderTrx.commit();

        // B unparks on the committed state: the block expires now, with the
        // burn already recorded — the audit proves the job read the post-burn
        // remaining balance, not a stale pre-burn row.
        await handlerPromise;
        const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
        expect(block.status).toBe('expired');
        expect(block.first_allocated_at).toBeTruthy();
        expect(Number(block.remaining_minutes)).toBe(480);
        const audit = await auditRows(blockId);
        expect(audit).toHaveLength(1);
        expect(audit[0].type).toBe('auto_expiration');
        expect(audit[0].metadata?.remaining_minutes_at_expiration).toBe(480);
        const liveRows = await db('hour_block_time_allocations').where({ tenant, block_id: blockId });
        expect(liveRows).toHaveLength(1);
        expect(Number(liveRows[0].minutes)).toBe(120);
      } finally {
        await holderDb.destroy();
      }
    } finally {
      if (originalTzState) {
        process.env.TZ = originalTzState;
      } else {
        delete process.env.TZ;
      }
      await cleanup();
    }
  });

  // The mirrored serialization order: the expiration pass commits first, and
  // an allocation started after it (real burn engine) refuses the expired
  // block — no allocation row is ever written against an expired block.
  it('race (mirror): after the expiration pass commits, a burn started against the committed state writes nothing', async () => {
    const originalTzState = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const { clientId, serviceId } = await seedBase(null);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const blockId = uuidv4();
      await insertBlock(blockId, clientId, serviceId, yesterday);

      const ticketId = uuidv4();
      await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'HB Expire Mirror Ticket', ticket_number: `HB-EXPM-${ticketId.slice(0, 8)}` });
      const entryUserId = uuidv4();
      await db('users').insert({
        tenant, user_id: entryUserId, username: `hbexpm_${entryUserId.slice(0, 8)}`,
        hashed_password: 'x', email: `hbexpm_${entryUserId.slice(0, 8)}@test.local`,
      });
      const entryId = uuidv4();
      const start = new Date(`${yesterday}T09:00:00.000Z`);
      const entry = {
        entry_id: entryId, service_id: serviceId, billable_duration: 120, contract_line_id: null,
        work_item_id: ticketId, work_item_type: 'ticket', work_date: yesterday, start_time: start.toISOString(),
      };
      await db('time_entries').insert({
        tenant, entry_id: entryId, user_id: entryUserId, service_id: serviceId,
        work_item_id: ticketId, work_item_type: 'ticket',
        start_time: start.toISOString(), end_time: new Date(start.getTime() + 120 * 60000).toISOString(),
        work_date: yesterday, work_timezone: 'UTC',
        billable_duration: 120, approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
      });

      // The expiration pass commits first.
      await expiredHourBlocksHandler({ tenantId: tenant });
      expect(await blockStatus(blockId)).toBe('expired');

      // A burn started now (back-dated entry, real burn engine): the locked
      // re-read sees the committed expired status and refuses the block.
      const allocations = await db.transaction(async (trx: Knex.Transaction) => allocateTimeEntry(trx, tenant, clientId, entry));
      expect(allocations).toEqual([]);
      expect(await db('hour_block_time_allocations').where({ tenant, block_id: blockId })).toHaveLength(0);
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('expired');
      expect(block.first_allocated_at).toBeNull();
      expect(Number(block.remaining_minutes)).toBe(600);
    } finally {
      if (originalTzState) {
        process.env.TZ = originalTzState;
      } else {
        delete process.env.TZ;
      }
      await cleanup();
    }
  });
});
