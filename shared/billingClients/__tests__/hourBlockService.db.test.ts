import { describe, expect, it, vi, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';
import {
  allocateTimeEntry,
  reverseTimeEntryAllocations,
  reconcileClientAllocations,
  isEntryEligibleForBlockBurn,
  getAvailableHourBlockMinutes,
} from '../hourBlockService';

// DB-backed burn-engine tests. Run ONLY against an explicitly provided
// database with:
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

function connect(): Knex {
  return knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
}

async function insertTicket(
  db: Knex,
  tenant: string,
  clientId: string,
  title: string,
): Promise<string> {
  const ticketId = uuidv4();
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title, ticket_number: `HB-${ticketId.slice(0, 8)}` });
  return ticketId;
}

async function insertService(
  db: Knex,
  tenant: string,
  name: string,
  orderNumber: number,
): Promise<{ service_id: string; service_type_id: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  await db('service_types').insert({
    id: serviceTypeId,
    tenant,
    name: `HB Type ${name}`,
    is_active: true,
    order_number: orderNumber,
  });
  await db('service_catalog').insert({
    service_id: serviceId,
    tenant,
    service_name: name,
    custom_service_type_id: serviceTypeId,
    billing_method: 'hourly',
    default_rate: 15000,
    unit_of_measure: 'hour',
    category_id: null,
    tax_rate_id: null,
    item_kind: 'service',
    is_active: true,
    is_license: false,
  });
  return { service_id: serviceId, service_type_id: serviceTypeId };
}

async function insertUser(db: Knex, tenant: string): Promise<string> {
  const userId = uuidv4();
  await db('users').insert({
    user_id: userId,
    tenant,
    username: `hb_${userId.slice(0, 8)}`,
    hashed_password: 'x',
    email: `hb_${userId.slice(0, 8)}@test.local`,
    user_type: 'internal',
    first_name: 'HB',
    last_name: 'Tester',
  });
  return userId;
}

async function insertTimeEntry(
  db: Knex,
  tenant: string,
  userId: string,
  ticketId: string,
  serviceId: string,
  billableDuration: number,
  workDate: string,
): Promise<{
  entry_id: string;
  service_id: string;
  work_item_id: string;
  work_item_type: string;
  billable_duration: number;
  contract_line_id: null;
  work_date: string;
  start_time: string;
}> {
  const entryId = uuidv4();
  const start = new Date(`${workDate}T09:00:00.000Z`);
  const end = new Date(start.getTime() + billableDuration * 60000);
  await db('time_entries').insert({
    entry_id: entryId,
    tenant,
    user_id: userId,
    service_id: serviceId,
    work_item_id: ticketId,
    work_item_type: 'ticket',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    work_date: workDate,
    work_timezone: 'UTC',
    billable_duration: billableDuration,
    approval_status: 'APPROVED',
    invoiced: false,
    contract_line_id: null,
  });
  return {
    entry_id: entryId,
    service_id: serviceId,
    work_item_id: ticketId,
    work_item_type: 'ticket',
    billable_duration: billableDuration,
    contract_line_id: null,
    work_date: workDate,
    start_time: start.toISOString(),
  };
}

async function insertBlock(
  db: Knex,
  tenant: string,
  clientId: string,
  serviceId: string,
  blockId: string,
  expirationDate: string | null,
): Promise<void> {
  await db('hour_blocks').insert({
    tenant, block_id: blockId, client_id: clientId, service_id: serviceId,
    total_minutes: 600, remaining_minutes: 600, hourly_rate: 13500,
    purchase_amount: 135000, currency_code: 'USD', status: 'active',
    purchased_at: new Date().toISOString(), expiration_date: expirationDate,
  });
}

// The burn engine's date normalization is process-timezone-dependent, so the
// timezone regression tests pin TZ explicitly and guard that Node honored it
// before asserting on dates.
function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

describe.runIf(enabled)('hourBlockService DB integration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('allocates FIFO across blocks, respects scope, reverses, and reconciles idempotently', async () => {
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();
    const workDate = '2026-08-10';

    try {
      await db('tenants').insert({
        tenant,
        client_name: 'HB Test Tenant',
        email: 'hb@test.local',
        billing_source: 'test',
      });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Test Client' });
      const { service_id: svcA } = await insertService(db, tenant, 'Support Hours', 1);
      const { service_id: svcB } = await insertService(db, tenant, 'Onboarding', 2);
      const userId = await insertUser(db, tenant);
      const ticketId = await insertTicket(db, tenant, clientId, 'HB Ticket');

      // Block 1: expires earlier, scoped to svcA only.
      const block1 = uuidv4();
      await db('hour_blocks').insert({
        tenant, block_id: block1, client_id: clientId, service_id: svcA,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 13500,
        purchase_amount: 135000, currency_code: 'USD', status: 'active',
        purchased_at: new Date().toISOString(), expiration_date: '2026-09-01',
      });
      await db('hour_block_service_scopes').insert({ tenant, block_id: block1, service_id: svcA });

      // Block 2: no expiry, purchased later, all labor (no scope rows).
      const block2 = uuidv4();
      await db('hour_blocks').insert({
        tenant, block_id: block2, client_id: clientId, service_id: svcA,
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 13500,
        purchase_amount: 135000, currency_code: 'USD', status: 'active',
        purchased_at: new Date(Date.now() + 60000).toISOString(), expiration_date: null,
      });

      await db.transaction(async (trx: Knex.Transaction) => {
        // Scope: an svcB entry must NOT burn block1 (scoped to svcA only), even
        // though block1 is the FIFO-first block; it burns the all-labor block2.
        const entryScoped = await insertTimeEntry(db, tenant, userId, ticketId, svcB, 60, workDate);
        expect(await isEntryEligibleForBlockBurn(trx, tenant, entryScoped)).toBe(true);
        const allocationsScoped = await allocateTimeEntry(trx, tenant, clientId, entryScoped);
        expect(allocationsScoped).toEqual([{ block_id: block2, minutes: 60 }]);
        const [b1Scope, b2Scope] = await Promise.all([
          trx('hour_blocks').where({ tenant, block_id: block1 }).first(),
          trx('hour_blocks').where({ tenant, block_id: block2 }).first(),
        ]);
        expect(Number(b1Scope.remaining_minutes)).toBe(600);
        expect(Number(b2Scope.remaining_minutes)).toBe(540);

        const entryA = await insertTimeEntry(db, tenant, userId, ticketId, svcA, 720, workDate);
        expect(await isEntryEligibleForBlockBurn(trx, tenant, entryA)).toBe(true);
        const allocations = await allocateTimeEntry(trx, tenant, clientId, entryA);
        expect(allocations).toHaveLength(2);
        expect(allocations[0].block_id).toBe(block1);
        expect(allocations[0].minutes).toBe(600);
        expect(allocations[1].block_id).toBe(block2);
        expect(allocations[1].minutes).toBe(120);

        const [b1, b2] = await Promise.all([
          trx('hour_blocks').where({ tenant, block_id: block1 }).first(),
          trx('hour_blocks').where({ tenant, block_id: block2 }).first(),
        ]);
        expect(Number(b1.remaining_minutes)).toBe(0);
        expect(Number(b2.remaining_minutes)).toBe(420);

        // Exhaustion overflow: 600 more minutes, only 420 left → partial burn.
        const entryC = await insertTimeEntry(db, tenant, userId, ticketId, svcB, 600, workDate);
        const allocationsC = await allocateTimeEntry(trx, tenant, clientId, entryC);
        const totalC = allocationsC.reduce((sum, a) => sum + a.minutes, 0);
        expect(totalC).toBe(420);

        // Reverse entryA: minutes restored to both blocks.
        await reverseTimeEntryAllocations(trx, tenant, entryA.entry_id);
        const [b1r, b2r] = await Promise.all([
          trx('hour_blocks').where({ tenant, block_id: block1 }).first(),
          trx('hour_blocks').where({ tenant, block_id: block2 }).first(),
        ]);
        expect(Number(b1r.remaining_minutes)).toBe(600);
        expect(Number(b2r.remaining_minutes)).toBe(120);

        // Reconcile: recomputes from scratch; running twice yields identical state.
        const first = await reconcileClientAllocations(trx, tenant, clientId);
        const stateAfterFirst = await trx('hour_blocks').where({ tenant }).select('block_id', 'remaining_minutes');
        const second = await reconcileClientAllocations(trx, tenant, clientId);
        const stateAfterSecond = await trx('hour_blocks').where({ tenant }).select('block_id', 'remaining_minutes');
        expect(second).toBeGreaterThanOrEqual(0);
        expect(stateAfterSecond).toEqual(stateAfterFirst);
        expect(first).toBeGreaterThan(0);

        // Derived available balance: sum of remaining over active blocks.
        const available = await getAvailableHourBlockMinutes(trx, tenant, clientId);
        const sumState = stateAfterSecond.reduce((sum, row) => sum + Number(row.remaining_minutes), 0);
        expect(available).toBe(sumState);
      });
    } finally {
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  // Regression: the durable "ever used" marker. hour_block_time_allocations
  // rows are DELETED on reversal, so the void guard must rely on the immutable
  // first_allocated_at column: set at the first burn, never cleared by reverse
  // or re-allocate cycles.
  it('sets the immutable first_allocated_at marker on first burn and never clears it on reversal', async () => {
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();
    const workDate = '2026-08-10';

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Marker Tenant', email: 'hbmarker@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Marker Client' });
      const { service_id: svc } = await insertService(db, tenant, 'Marker Svc', 1);
      const userId = await insertUser(db, tenant);
      const ticketId = await insertTicket(db, tenant, clientId, 'HB Marker Ticket');
      const blockId = uuidv4();
      await insertBlock(db, tenant, clientId, svc, blockId, null);

      const entry = await insertTimeEntry(db, tenant, userId, ticketId, svc, 60, workDate);
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      const afterBurn = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(afterBurn.first_allocated_at).toBeTruthy();

      await db.transaction(async (trx: Knex.Transaction) => {
        await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
      });
      const afterReverse = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(afterReverse.first_allocated_at).toBeTruthy();
      expect(Number(afterReverse.remaining_minutes)).toBe(600);

      // Re-allocate then reverse again: the marker keeps its first-burn value.
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      const afterRealloc = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(new Date(afterRealloc.first_allocated_at).getTime()).toBe(new Date(afterBurn.first_allocated_at).getTime());
    } finally {
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  it('keeps every client\'s burns across a full handler-style pass and never reverses invoiced entries', async () => {
    const db = connect();
    const tenant = uuidv4();
    const workDate = '2026-08-10';

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Multi Tenant', email: 'hb3@test.local', billing_source: 'test' });
      const { service_id: svcA } = await insertService(db, tenant, 'Multi Svc', 1);

      // Two clients, each with their own block, user, ticket, and burned entry.
      const clientA = uuidv4();
      const clientB = uuidv4();
      const blockA = uuidv4();
      const blockB = uuidv4();
      await db('clients').insert({ tenant, client_id: clientA, client_name: 'Client A' });
      await db('clients').insert({ tenant, client_id: clientB, client_name: 'Client B' });
      const userA = await insertUser(db, tenant);
      const userB = await insertUser(db, tenant);
      const ticketA = await insertTicket(db, tenant, clientA, 'Ticket A');
      const ticketB = await insertTicket(db, tenant, clientB, 'Ticket B');
      for (const [clientId, blockId] of [[clientA, blockA], [clientB, blockB]] as const) {
        await db('hour_blocks').insert({
          tenant, block_id: blockId, client_id: clientId, service_id: svcA,
          total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000,
          purchase_amount: 60000, currency_code: 'USD', status: 'active',
          purchased_at: new Date().toISOString(), expiration_date: null,
        });
      }

      // Burn 120 minutes from each client's block.
      const entryA = await insertTimeEntry(db, tenant, userA, ticketA, svcA, 120, workDate);
      const entryB = await insertTimeEntry(db, tenant, userB, ticketB, svcA, 120, workDate);
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientA, entryA);
        await allocateTimeEntry(trx, tenant, clientB, entryB);
      });

      // Mark client B's entry invoiced (locked by a finalized invoice).
      await db('time_entries').where({ tenant, entry_id: entryB.entry_id }).update({ invoiced: true });

      // Full handler-style pass: reconcile client A, then client B.
      await db.transaction(async (trx: Knex.Transaction) => {
        await reconcileClientAllocations(trx, tenant, clientA);
      });
      await db.transaction(async (trx: Knex.Transaction) => {
        await reconcileClientAllocations(trx, tenant, clientB);
      });

      // Both blocks keep their burns — the pass for one client must never
      // reverse the other client's allocations.
      const [bA, bB] = await Promise.all([
        db('hour_blocks').where({ tenant, block_id: blockA }).first(),
        db('hour_blocks').where({ tenant, block_id: blockB }).first(),
      ]);
      expect(Number(bA.remaining_minutes)).toBe(480);
      expect(Number(bB.remaining_minutes)).toBe(480);

      // Client B's entry is invoiced: its allocation must be untouched and its
      // block balance must NOT be restored.
      const allocationsAfter = await db('hour_block_time_allocations')
        .where({ tenant, time_entry_id: entryB.entry_id })
        .select('minutes');
      expect(allocationsAfter).toHaveLength(1);
      expect(Number(allocationsAfter[0].minutes)).toBe(120);

      // Client A's (uninvoiced) entry survived reconcile with its burn intact.
      const allocationsA = await db('hour_block_time_allocations')
        .where({ tenant, time_entry_id: entryA.entry_id })
        .select('minutes');
      expect(allocationsA).toHaveLength(1);
      expect(Number(allocationsA[0].minutes)).toBe(120);
    } finally {
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  // Regression: the burn engine reads work_date and expiration_date as pg DATE
  // columns, which node-postgres materializes as local-midnight Date objects.
  // Routing those through toISOString() shifted them backward a day in positive-
  // offset zones, so a block that had already expired locally still matched an
  // entry's work date and was wrongly burned. Each zone pins TZ and drives the
  // REAL reconcile path (selectClientEligibleEntries → pg DATE read →
  // toDateOnly → selectEligibleBlocks), the exact code path that regressed.
  it('expiration-boundary burn uses local calendar dates on the pg DATE read path (Europe/Berlin UTC+2)', async () => {
    const originalTz = process.env.TZ;
    assertTz('Europe/Berlin', -120);
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();

    try {
      await db('tenants').insert({ tenant, client_name: 'HB TZ Berlin', email: 'hbtz-berlin@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB TZ Berlin Client' });
      const { service_id: svc } = await insertService(db, tenant, 'TZ Berlin Svc', 1);
      const userId = await insertUser(db, tenant);
      const ticket = await insertTicket(db, tenant, clientId, 'HB TZ Berlin Ticket');

      const expiring = uuidv4();
      await insertBlock(db, tenant, clientId, svc, expiring, '2026-08-30');

      await db.transaction(async (trx: Knex.Transaction) => {
        // Sanity: pg materializes the 2026-08-31 DATE as a local-midnight Date
        // whose UTC day is the PREVIOUS day in Berlin — the exact input that used
        // to shift the work date backward and keep an expired block eligible.
        const entry = await insertTimeEntry(db, tenant, userId, ticket, svc, 60, '2026-08-31');
        const entryRow = await trx('time_entries').where({ tenant, entry_id: entry.entry_id }).first();
        expect(entryRow.work_date).toBeInstanceOf(Date);
        expect(entryRow.work_date.toISOString()).toBe('2026-08-30T22:00:00.000Z');

        // Entry on 2026-08-31: the block expired on 2026-08-30, so nothing burns.
        await reconcileClientAllocations(trx, tenant, clientId);
        const block = await trx('hour_blocks').where({ tenant, block_id: expiring }).first();
        expect(Number(block.remaining_minutes)).toBe(600);

        // Positive control: an entry worked ON the block's expiration day must
        // burn it — the fix must not over-exclude.
        await insertTimeEntry(db, tenant, userId, ticket, svc, 60, '2026-08-30');
        await reconcileClientAllocations(trx, tenant, clientId);
        const block2 = await trx('hour_blocks').where({ tenant, block_id: expiring }).first();
        expect(Number(block2.remaining_minutes)).toBe(540);
      });
    } finally {
      process.env.TZ = originalTz;
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  it('expiration-boundary burn uses local calendar dates on the pg DATE read path (Pacific/Kiritimati UTC+14)', async () => {
    const originalTz = process.env.TZ;
    assertTz('Pacific/Kiritimati', -840);
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();

    try {
      await db('tenants').insert({ tenant, client_name: 'HB TZ Kiritimati', email: 'hbtz-kiritimati@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB TZ Kiritimati Client' });
      const { service_id: svc } = await insertService(db, tenant, 'TZ Kiritimati Svc', 1);
      const userId = await insertUser(db, tenant);
      const ticket = await insertTicket(db, tenant, clientId, 'HB TZ Kiritimati Ticket');

      const expiring = uuidv4();
      await insertBlock(db, tenant, clientId, svc, expiring, '2026-08-30');

      await db.transaction(async (trx: Knex.Transaction) => {
        const entry = await insertTimeEntry(db, tenant, userId, ticket, svc, 60, '2026-08-31');
        const entryRow = await trx('time_entries').where({ tenant, entry_id: entry.entry_id }).first();
        expect(entryRow.work_date).toBeInstanceOf(Date);
        expect(entryRow.work_date.toISOString()).toBe('2026-08-30T10:00:00.000Z');

        const reconciled = await reconcileClientAllocations(trx, tenant, clientId);
        void reconciled;
        const block = await trx('hour_blocks').where({ tenant, block_id: expiring }).first();
        expect(Number(block.remaining_minutes)).toBe(600);

        await insertTimeEntry(db, tenant, userId, ticket, svc, 60, '2026-08-30');
        await reconcileClientAllocations(trx, tenant, clientId);
        const block2 = await trx('hour_blocks').where({ tenant, block_id: expiring }).first();
        expect(Number(block2.remaining_minutes)).toBe(540);
      });
    } finally {
      process.env.TZ = originalTz;
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  // "Today" for expiration eligibility must be the TENANT's calendar date, not
  // the worker host's and not UTC: expiration dates are stored as tenant-local
  // calendar dates, so a block expiring 2026-08-30 is expired the moment the
  // tenant enters 2026-08-31 even while a UTC worker still reads 2026-08-30.
  // Each case pins the WORKER process TZ to a zone that disagrees with the
  // tenant's configured timezone, freezes "now" at an instant where the tenant
  // calendar has rolled over but the worker's has not, and proves the boundary
  // follows the tenant calendar. Blocks: the tenant-yesterday block is excluded,
  // the tenant-today and never-expiring blocks count => 1200.
  it('available-minutes "today" follows the tenant calendar for a Berlin tenant on a UTC worker (the reviewer\'s scenario)', async () => {
    await assertAvailableBoundary({
      workerTz: 'UTC',
      workerOffsetMinutes: 0,
      tenantTz: 'Europe/Berlin',
      freezeAt: '2026-08-30T23:00:00.000Z', // Berlin 2026-08-31 01:00
      tenantToday: '2026-08-31',
      workerToday: '2026-08-30',
      expiredDay: '2026-08-30',
      todayDay: '2026-08-31',
    });
  });

  it('available-minutes "today" follows the tenant calendar for a Kiritimati tenant on a UTC worker', async () => {
    await assertAvailableBoundary({
      workerTz: 'UTC',
      workerOffsetMinutes: 0,
      tenantTz: 'Pacific/Kiritimati',
      freezeAt: '2026-08-30T10:00:00.000Z', // Kiritimati 2026-08-31 00:00
      tenantToday: '2026-08-31',
      workerToday: '2026-08-30',
      expiredDay: '2026-08-30',
      todayDay: '2026-08-31',
    });
  });

  it('available-minutes "today" is worker-independent: identical Berlin boundary from a New York worker', async () => {
    await assertAvailableBoundary({
      workerTz: 'America/New_York',
      workerOffsetMinutes: 240,
      tenantTz: 'Europe/Berlin',
      freezeAt: '2026-08-30T23:00:00.000Z', // New York 2026-08-30 19:00, Berlin 2026-08-31 01:00
      tenantToday: '2026-08-31',
      workerToday: '2026-08-30',
      expiredDay: '2026-08-30',
      todayDay: '2026-08-31',
    });
  });

  it('available-minutes "today" falls back to the UTC calendar when the tenant has no timezone configured (documented)', async () => {
    await assertAvailableBoundary({
      workerTz: 'UTC',
      workerOffsetMinutes: 0,
      tenantTz: null,
      freezeAt: '2026-08-31T22:00:00.000Z', // UTC today 2026-08-31
      tenantToday: '2026-08-31',
      workerToday: '2026-08-31',
      expiredDay: '2026-08-30',
      todayDay: '2026-08-31',
    });
  });

  // 29.8.18 Blocker 2: two genuinely concurrent allocations of the same
  // block must serialize on the hour_blocks row lock the eligible-block select
  // takes. Pre-fix, both transactions read remaining_minutes = 600 before
  // either committed, each allocated the full 600, and the block went to
  // -600 (oversold). Post-fix the second transaction parks at SELECT ... FOR
  // UPDATE, re-evaluates the committed row (remaining 0, predicate fails),
  // and allocates nothing.
  it('serializes two concurrent full-block allocations: no oversell, second allocation sees committed exhaustion', async () => {
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const tenant = uuidv4();
    const clientId = uuidv4();
    const workDate = '2026-08-10';

    try {
      await db('tenants').insert({ tenant, client_name: 'HB Oversell Tenant', email: 'hboversell@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Oversell Client' });
      const { service_id: svc } = await insertService(db, tenant, 'Oversell Svc', 1);
      const userId = await insertUser(db, tenant);
      const ticketId = await insertTicket(db, tenant, clientId, 'HB Oversell Ticket');
      const blockId = uuidv4();
      await insertBlock(db, tenant, clientId, svc, blockId, null);

      // Two entries, each needing the block's full 600 minutes.
      const entry1 = await insertTimeEntry(db, tenant, userId, ticketId, svc, 600, workDate);
      const entry2 = await insertTimeEntry(db, tenant, userId, ticketId, svc, 600, workDate);

      // Transaction A: real burn engine; after allocating it HOLDS its locks
      // briefly so transaction B genuinely interleaves mid-flight.
      const allocation1 = db.transaction(async (trx: Knex.Transaction) => {
        const result = await allocateTimeEntry(trx, tenant, clientId, entry1);
        await new Promise((resolve) => setTimeout(resolve, 400));
        return result;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Transaction B: starts while A is mid-flight and must PARK at the
      // hour_blocks row lock A holds.
      let allocation2Settled = false;
      const allocation2 = (async () => {
        const result = await db.transaction(async (trx: Knex.Transaction) => allocateTimeEntry(trx, tenant, clientId, entry2));
        allocation2Settled = true;
        return result;
      })();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(allocation2Settled, 'the second allocation must block on the hour_blocks row lock the first holds').toBe(false);

      const [first, second] = await Promise.all([allocation1, allocation2]);

      // Exactly one burn of the full block; the loser saw committed
      // exhaustion and wrote nothing — never a negative balance.
      expect(first).toEqual([{ block_id: blockId, minutes: 600 }]);
      expect(second).toEqual([]);

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(Number(block.remaining_minutes)).toBe(0);
      expect(block.first_allocated_at).toBeTruthy();
      const rows = await db('hour_block_time_allocations').where({ tenant, block_id: blockId });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].minutes)).toBe(600);
    } finally {
      await db('hour_blocks').where({ tenant }).delete();
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_block_time_allocations').where({ tenant }).delete();
      await db('hour_block_audit').where({ tenant }).delete();
      await db('time_entries').where({ tenant }).delete();
      await db('tickets').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('users').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
      await db.destroy();
    }
  });

  // The exact Berlin availability boundary: an instant where the UTC calendar
  // day and the Europe/Berlin calendar day disagree (2026-08-31T22:30Z = Berlin
  // 2026-09-01 00:30). A block expiring 2026-08-31 is still "today" on the UTC
  // calendar but already "yesterday" on the Berlin calendar, so availability
  // must flip on the TENANT's configured timezone alone — the block, the frozen
  // instant, and the worker host (UTC) are identical across both tenants. The
  // comparison is inclusive: a block expiring the tenant's today stays available
  // through the end of that local day (verified on the non-straddle side).
  it('available-minutes flips at the UTC/Berlin calendar straddle on tenant timezone alone', async () => {
    const originalTz = process.env.TZ;
    assertTz('UTC', 0); // worker stays on UTC; only the tenant timezone differs
    const db = connect();
    const tenants: string[] = [];

    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-31T22:30:00.000Z'));
      expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin'), 'Berlin must already be 2026-09-01').toBe('2026-09-01');
      expect(new Date().toISOString().slice(0, 10), 'UTC worker must still read 2026-08-31').toBe('2026-08-31');

      const berlinTenant = uuidv4();
      tenants.push(berlinTenant);
      const berlinClientId = uuidv4();
      await db('tenants').insert({ tenant: berlinTenant, client_name: 'HB Straddle Berlin', email: 'hbstraddle-berlin@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant: berlinTenant, client_id: berlinClientId, client_name: 'HB Straddle Berlin Client' });
      const { service_id: berlinSvc } = await insertService(db, berlinTenant, 'Straddle Svc', 1);
      await db('tenant_settings').insert({ tenant: berlinTenant, settings: { timezone: 'Europe/Berlin' } });
      await insertBlock(db, berlinTenant, berlinClientId, berlinSvc, uuidv4(), '2026-08-31');
      expect(await getAvailableHourBlockMinutes(db, berlinTenant, berlinClientId), 'Berlin is already 09-01: the 08-31 block is expired').toBe(0);

      const utcTenant = uuidv4();
      tenants.push(utcTenant);
      const utcClientId = uuidv4();
      await db('tenants').insert({ tenant: utcTenant, client_name: 'HB Straddle UTC', email: 'hbstraddle-utc@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant: utcTenant, client_id: utcClientId, client_name: 'HB Straddle UTC Client' });
      const { service_id: utcSvc } = await insertService(db, utcTenant, 'Straddle Svc UTC', 1);
      await insertBlock(db, utcTenant, utcClientId, utcSvc, uuidv4(), '2026-08-31');
      expect(await getAvailableHourBlockMinutes(db, utcTenant, utcClientId), 'UTC fallback still reads 08-31: the 08-31 block is available').toBe(600);

      // Non-straddle side: one hour earlier Berlin is still 08-31 23:30, so the
      // same block must still be available — expiration is inclusive through the
      // end of the tenant-local day.
      vi.setSystemTime(new Date('2026-08-31T21:30:00.000Z'));
      expect(toCalendarDateStringInTimeZone(new Date(), 'Europe/Berlin'), 'Berlin must still read 2026-08-31').toBe('2026-08-31');
      expect(await getAvailableHourBlockMinutes(db, berlinTenant, berlinClientId), 'Berlin is still 08-31: the 08-31 block is available through the local day').toBe(600);
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTz;
      for (const tenant of tenants) {
        await db('hour_blocks').where({ tenant }).delete();
        await db('hour_block_service_scopes').where({ tenant }).delete();
        await db('hour_block_time_allocations').where({ tenant }).delete();
        await db('hour_block_audit').where({ tenant }).delete();
        await db('tenant_settings').where({ tenant }).delete();
        await db('time_entries').where({ tenant }).delete();
        await db('tickets').where({ tenant }).delete();
        await db('service_catalog').where({ tenant }).delete();
        await db('service_types').where({ tenant }).delete();
        await db('users').where({ tenant }).delete();
        await db('clients').where({ tenant }).delete();
        await db('tenants').where({ tenant }).delete();
      }
      await db.destroy();
    }
  });
});

async function assertAvailableBoundary(opts: {
  workerTz: string;
  workerOffsetMinutes: number;
  tenantTz: string | null;
  freezeAt: string;
  tenantToday: string;
  workerToday: string;
  expiredDay: string;
  todayDay: string;
}): Promise<void> {
  const originalTz = process.env.TZ;
  assertTz(opts.workerTz, opts.workerOffsetMinutes);
  const db = connect();
  const tenant = uuidv4();
  const clientId = uuidv4();

  try {
    await db('tenants').insert({ tenant, client_name: 'HB TZ Today', email: 'hbtz-today@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB TZ Today Client' });
    const { service_id: svc } = await insertService(db, tenant, 'Today Svc', 1);
    await db('tenant_settings').insert({ tenant, settings: opts.tenantTz ? { timezone: opts.tenantTz } : {} });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(opts.freezeAt));
    expect(toCalendarDateStringInTimeZone(new Date(), opts.tenantTz ?? 'UTC'), 'tenant calendar must be at tenantToday').toBe(opts.tenantToday);
    expect(new Date().toISOString().slice(0, 10), 'worker calendar must still be at workerToday').toBe(opts.workerToday);

    const blockExpired = uuidv4();
    await insertBlock(db, tenant, clientId, svc, blockExpired, opts.expiredDay); // expired on the tenant calendar
    const blockToday = uuidv4();
    await insertBlock(db, tenant, clientId, svc, blockToday, opts.todayDay); // tenant today
    const blockNever = uuidv4();
    await insertBlock(db, tenant, clientId, svc, blockNever, null);

    const available = await getAvailableHourBlockMinutes(db, tenant, clientId);
    // The tenant-calendar-expired block is excluded; tenant-today and never
    // count. The old host/UTC-today logic kept the expired block available.
    expect(available).toBe(1200);
  } finally {
    vi.useRealTimers();
    process.env.TZ = originalTz;
    await db('hour_blocks').where({ tenant }).delete();
    await db('hour_block_service_scopes').where({ tenant }).delete();
    await db('hour_block_time_allocations').where({ tenant }).delete();
    await db('hour_block_audit').where({ tenant }).delete();
    await db('tenant_settings').where({ tenant }).delete();
    await db('time_entries').where({ tenant }).delete();
    await db('tickets').where({ tenant }).delete();
    await db('service_catalog').where({ tenant }).delete();
    await db('service_types').where({ tenant }).delete();
    await db('users').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  }
}
