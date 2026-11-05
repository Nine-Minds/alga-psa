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
  getAvailableHourBlockMinutesForSubjects,
  getContractLineCoverageForClient,
  resolveBlockBurnTarget,
  reconcileLineAllocations,
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
//
// Probe the offset at a fixed summer instant (the scenarios below are Aug/Sep 2026), not "now":
// Europe/Berlin and America/New_York change offset at DST transitions, so a wall-clock probe
// fails whenever the suite runs outside summer time.
const TZ_PROBE_INSTANT = new Date('2026-08-31T12:00:00.000Z');

function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(TZ_PROBE_INSTANT.getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
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
        const stateAfterFirst = await trx('hour_blocks').where({ tenant }).orderBy('block_id').select('block_id', 'remaining_minutes');
        const second = await reconcileClientAllocations(trx, tenant, clientId);
        const stateAfterSecond = await trx('hour_blocks').where({ tenant }).orderBy('block_id').select('block_id', 'remaining_minutes');
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

  it('composes scoped and unscoped blocks once per bucket subject using tenant-local expiry', async () => {
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();
    const originalTz = process.env.TZ;
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
      assertTz('UTC', 0);
      await db('tenants').insert({ tenant, client_name: 'HB Subject Composition', email: 'hb-subject@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Subject Composition Client' });
      const { service_id: serviceA } = await insertService(db, tenant, 'Subject A', 1);
      const { service_id: serviceB } = await insertService(db, tenant, 'Subject B', 2);

      const unscoped = uuidv4();
      const scopedA = uuidv4();
      const scopedB = uuidv4();
      const expired = uuidv4();
      const subjectA = uuidv4();
      const subjectB = uuidv4();
      const subjectC = uuidv4();
      await insertBlock(db, tenant, clientId, serviceA, unscoped, null);
      await insertBlock(db, tenant, clientId, serviceA, scopedA, null);
      await insertBlock(db, tenant, clientId, serviceB, scopedB, null);
      await insertBlock(db, tenant, clientId, serviceA, expired, '2026-08-19');
      await db('hour_block_service_scopes').insert([
        { tenant, block_id: scopedA, service_id: serviceA },
        { tenant, block_id: scopedB, service_id: serviceB },
        { tenant, block_id: expired, service_id: serviceA },
      ]);
      await Promise.all([
        db('hour_blocks').where({ tenant, block_id: unscoped }).update({ replenishment_bucket_usage_id: subjectB }),
        db('hour_blocks').where({ tenant, block_id: scopedA }).update({ replenishment_bucket_usage_id: subjectA }),
        db('hour_blocks').where({ tenant, block_id: scopedB }).update({ replenishment_bucket_usage_id: subjectC }),
      ]);

      const minutes = await getAvailableHourBlockMinutesForSubjects(db, tenant, clientId, [
        { key: subjectA, serviceId: serviceA },
        { key: subjectB, serviceId: serviceA },
        { key: subjectC, serviceId: serviceB },
      ]);

      // The replenishment block is attributed to the exact bucket that caused
      // its invoice even though another same-service subject sorts first. The
      // ordinary service-A and service-B scoped blocks remain single-counted,
      // and the expired block is excluded by the tenant-local date.
      expect(minutes.get(subjectA)).toBe(600);
      expect(minutes.get(subjectB)).toBe(600);
      expect(minutes.get(subjectC)).toBe(600);
      expect([...minutes.values()].reduce((sum, value) => sum + value, 0)).toBe(1800);
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTz;
      await db('hour_block_service_scopes').where({ tenant }).delete();
      await db('hour_blocks').where({ tenant }).delete();
      await db('service_catalog').where({ tenant }).delete();
      await db('service_types').where({ tenant }).delete();
      await db('clients').where({ tenant }).delete();
      await db('tenants').where({ tenant }).delete();
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

describe.runIf(enabled)('hourBlockService contract-line coverage (DB)', () => {
  const today = '2026-10-13';

  async function seedLine(
    db: Knex,
    tenant: string,
    clientId: string,
    serviceIds: string[],
    name: string,
    start: string,
    end: string | null,
  ): Promise<void> {
    const contractId = uuidv4();
    const lineId = uuidv4();
    await db('contracts').insert({
      tenant, contract_id: contractId, contract_name: `Contract ${name}`, is_template: false, status: 'active',
    });
    await db('contract_lines').insert({
      tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: `Line ${name}`, is_template: false,
    });
    for (const serviceId of serviceIds) {
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
    }
    await db('client_contracts').insert({
      tenant, client_contract_id: uuidv4(), client_id: clientId, contract_id: contractId,
      start_date: start, end_date: end, is_active: true,
    });
  }

  async function cleanup(db: Knex, tenant: string) {
    await db('client_contracts').where({ tenant }).delete();
    await db('contract_line_services').where({ tenant }).delete();
    await db('contract_lines').where({ tenant }).delete();
    await db('contracts').where({ tenant }).delete();
    await db('time_entries').where({ tenant }).delete();
    await db('tickets').where({ tenant }).delete();
    await db('service_catalog').where({ tenant }).delete();
    await db('service_types').where({ tenant }).delete();
    await db('users').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  }

  it('reports coverage by window and keeps the burn rule unchanged', async () => {
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();
    try {
      await db('tenants').insert({ tenant, client_name: 'HB Cov Tenant', email: 'cov@test.local', billing_source: 'test' });
      await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Cov Client' });
      const { service_id: one } = await insertService(db, tenant, 'Cov One', 1);
      const { service_id: two } = await insertService(db, tenant, 'Cov Two', 2);
      const { service_id: later } = await insertService(db, tenant, 'Cov Later', 3);
      const { service_id: far } = await insertService(db, tenant, 'Cov Far', 4);
      const { service_id: ended } = await insertService(db, tenant, 'Cov Ended', 5);
      const { service_id: none } = await insertService(db, tenant, 'Cov None', 6);
      const userId = await insertUser(db, tenant);
      const ticketId = await insertTicket(db, tenant, clientId, 'Cov Ticket');

      await seedLine(db, tenant, clientId, [one], 'One', '2026-01-01', null);
      await seedLine(db, tenant, clientId, [two], 'Two A', '2026-01-01', null);
      await seedLine(db, tenant, clientId, [two], 'Two B', '2026-02-01', '2027-02-01');
      await seedLine(db, tenant, clientId, [later], 'Later', '2026-12-01', null);
      await seedLine(db, tenant, clientId, [far], 'Far', '2027-11-20', null); // 13 months out
      await seedLine(db, tenant, clientId, [ended], 'Ended', '2025-01-01', '2026-10-12');

      const get = (serviceIds: string[] | null, expirationDate: string | null) =>
        getContractLineCoverageForClient(db, tenant, clientId, { serviceIds, expirationDate, today });

      const r1 = await get([one], null);
      expect(r1).toHaveLength(1);
      expect(r1[0].assignment).toBe('automatic');
      expect(r1[0].lines).toHaveLength(1);

      const r2 = await get([two], null);
      expect(r2[0].assignment).toBe('when_assigned');
      expect(r2[0].lines).toHaveLength(2);

      // Starts after today but before expiry: included.
      expect((await get([later], '2027-01-31')).map((c) => c.service_id)).toEqual([later]);
      // No expiry => today + 12 months; a line starting 13 months out is excluded.
      expect(await get([far], null)).toEqual([]);
      // Ended before today: excluded.
      expect(await get([ended], null)).toEqual([]);
      expect(await get([none], null)).toEqual([]);

      // Unscoped returns every covered service in the window.
      const all = await get(null, null);
      expect(all.map((c) => c.service_name).sort()).toEqual(['Cov Later', 'Cov One', 'Cov Two']);

      // Regression: burn rule unchanged by the builder refactor.
      await db.transaction(async (trx: Knex.Transaction) => {
        const entryOne = await insertTimeEntry(db, tenant, userId, ticketId, one, 60, today);
        const entryTwo = await insertTimeEntry(db, tenant, userId, ticketId, two, 60, today);
        expect(await isEntryEligibleForBlockBurn(trx, tenant, entryOne)).toBe(false);
        expect(await isEntryEligibleForBlockBurn(trx, tenant, entryTwo)).toBe(true);
      });
    } finally {
      await cleanup(db, tenant);
    }
  });
});

// ---------------------------------------------------------------------------
// Prepaid Block contract lines (alga-2026-0002695, plan section 2): burn
// target resolution, per-line isolation, gap draw on the line's pending block,
// line re-draw (idempotent), and release when a pending block is voided.
// ---------------------------------------------------------------------------
describe.runIf(enabled)('hourBlockService prepaid block contract lines', () => {
  interface World {
    db: Knex;
    tenant: string;
    clientId: string;
    userId: string;
    ticketId: string;
    svcA: string;
    svcB: string;
    svcC: string; // covered by a plain (no block config) contract line
    svcFree: string; // covered by no contract line
    lineA: string;
    lineB: string;
    linePlain: string;
  }

  async function setup(): Promise<World> {
    const db = connect();
    const tenant = uuidv4();
    const clientId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'PB Tenant', email: 'pb@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'PB Client' });
    const svcA = (await insertService(db, tenant, 'PB Svc A', 1)).service_id;
    const svcB = (await insertService(db, tenant, 'PB Svc B', 2)).service_id;
    const svcC = (await insertService(db, tenant, 'PB Svc C', 3)).service_id;
    const svcFree = (await insertService(db, tenant, 'PB Svc Free', 4)).service_id;
    const userId = await insertUser(db, tenant);
    const ticketId = await insertTicket(db, tenant, clientId, 'PB Ticket');

    async function addLine(name: string, serviceId: string, withBlockConfig: boolean): Promise<string> {
      const contractId = uuidv4();
      const lineId = uuidv4();
      await db('contracts').insert({ tenant, contract_id: contractId, contract_name: name });
      await db('client_contracts').insert({
        tenant, client_contract_id: uuidv4(), client_id: clientId, contract_id: contractId,
        start_date: '2026-01-01', is_active: true,
      });
      await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: name });
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
      if (withBlockConfig) {
        await db('contract_line_prepaid_blocks').insert({ tenant, contract_line_id: lineId, block_minutes: 600, block_price: 100000 });
      }
      return lineId;
    }
    const lineA = await addLine('PB Contract A', svcA, true);
    const lineB = await addLine('PB Contract B', svcB, true);
    const linePlain = await addLine('PB Contract Plain', svcC, false);
    return { db, tenant, clientId, userId, ticketId, svcA, svcB, svcC, svcFree, lineA, lineB, linePlain };
  }

  async function teardown(w: World) {
    const { db, tenant } = w;
    await db('hour_block_time_allocations').where({ tenant }).delete();
    await db('hour_block_audit').where({ tenant }).delete();
    await db('hour_block_service_scopes').where({ tenant }).delete();
    await db('hour_blocks').where({ tenant }).delete();
    await db('time_entries').where({ tenant }).delete();
    await db('tickets').where({ tenant }).delete();
    await db('contract_line_prepaid_blocks').where({ tenant }).delete();
    await db('contract_line_services').where({ tenant }).delete();
    await db('contract_lines').where({ tenant }).delete();
    await db('client_contracts').where({ tenant }).delete();
    await db('contracts').where({ tenant }).delete();
    await db('service_catalog').where({ tenant }).delete();
    await db('service_types').where({ tenant }).delete();
    await db('users').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  }

  async function block(
    w: World,
    opts: {
      line?: string | null;
      status?: 'active' | 'pending' | 'voided' | 'expired';
      remaining?: number;
      total?: number;
      expiration?: string | null;
      validFrom?: string | null;
      serviceId?: string;
      purchasedOffsetMs?: number;
    },
  ): Promise<string> {
    const blockId = uuidv4();
    const total = opts.total ?? 600;
    await w.db('hour_blocks').insert({
      tenant: w.tenant, block_id: blockId, client_id: w.clientId,
      service_id: opts.serviceId ?? w.svcA,
      total_minutes: total, remaining_minutes: opts.remaining ?? total, hourly_rate: 13500,
      purchase_amount: 135000, currency_code: 'USD', status: opts.status ?? 'active',
      purchased_at: opts.status === 'pending' ? null : new Date(Date.now() + (opts.purchasedOffsetMs ?? 0)).toISOString(),
      expiration_date: opts.expiration ?? null,
      valid_from: opts.validFrom ?? null,
      source_type: opts.line ? 'contract' : 'purchase',
      contract_line_id: opts.line ?? null,
      // Contract blocks must name their origin (hour_blocks_contract_source_check).
      service_period_record_id: opts.line ? uuidv4() : null,
    });
    return blockId;
  }

  async function entry(
    w: World,
    serviceId: string,
    minutes: number,
    lineId: string | null,
    workDate = '2026-08-10',
    hourOffset = 0,
  ) {
    const entryId = uuidv4();
    const start = new Date(`${workDate}T${String(9 + hourOffset).padStart(2, '0')}:00:00.000Z`);
    await w.db('time_entries').insert({
      entry_id: entryId, tenant: w.tenant, user_id: w.userId, service_id: serviceId,
      work_item_id: w.ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
      work_date: workDate, work_timezone: 'UTC', billable_duration: minutes,
      approval_status: 'APPROVED', invoiced: false, contract_line_id: lineId,
    });
    return {
      entry_id: entryId, service_id: serviceId, work_item_id: w.ticketId, work_item_type: 'ticket',
      billable_duration: minutes, contract_line_id: lineId, work_date: workDate, start_time: start.toISOString(),
    };
  }

  const remaining = async (w: World, blockId: string, conn: Knex | Knex.Transaction = w.db) =>
    Number((await conn('hour_blocks').where({ tenant: w.tenant, block_id: blockId }).first()).remaining_minutes);
  const allocatedFor = async (w: World, entryId: string) =>
    (await w.db('hour_block_time_allocations').where({ tenant: w.tenant, time_entry_id: entryId }).orderBy('block_id'))
      .map((r: any) => ({ block_id: r.block_id as string, minutes: Number(r.minutes) }));

  it('resolves burn targets: contract (explicit or deterministic), adhoc, and null for plain contract lines', async () => {
    const w = await setup();
    try {
      await w.db.transaction(async (trx: Knex.Transaction) => {
        const explicit = await entry(w, w.svcA, 60, w.lineA);
        expect(await resolveBlockBurnTarget(trx, w.tenant, explicit)).toEqual({ kind: 'contract', contractLineId: w.lineA });

        // No saved line, but svcA is covered by exactly one active line which carries a block config.
        const deterministic = await entry(w, w.svcA, 60, null);
        expect(await resolveBlockBurnTarget(trx, w.tenant, deterministic)).toEqual({ kind: 'contract', contractLineId: w.lineA });

        // Uncovered service: ad-hoc rule unchanged.
        const free = await entry(w, w.svcFree, 60, null);
        expect(await resolveBlockBurnTarget(trx, w.tenant, free)).toEqual({ kind: 'adhoc' });

        // Contract-covered by a plain line (no block config): contracts always win.
        const plainExplicit = await entry(w, w.svcC, 60, w.linePlain);
        expect(await resolveBlockBurnTarget(trx, w.tenant, plainExplicit)).toBeNull();
        const plainDeterministic = await entry(w, w.svcC, 60, null);
        expect(await resolveBlockBurnTarget(trx, w.tenant, plainDeterministic)).toBeNull();
        expect(await isEntryEligibleForBlockBurn(trx, w.tenant, plainDeterministic)).toBe(false);

        const zero = await entry(w, w.svcA, 0, w.lineA);
        expect(await resolveBlockBurnTarget(trx, w.tenant, zero)).toBeNull();
      });
    } finally {
      await teardown(w);
    }
  });

  it('isolates blocks: line A blocks only draw line A time; B, plain contract and non-contract time never touch them; ad-hoc is never drawn by contract time', async () => {
    const w = await setup();
    try {
      const blkA = await block(w, { line: w.lineA, serviceId: w.svcA });
      const blkB = await block(w, { line: w.lineB, serviceId: w.svcB });
      const adhoc = await block(w, { line: null, serviceId: w.svcFree });

      await w.db.transaction(async (trx: Knex.Transaction) => {
        const a = await entry(w, w.svcA, 60, w.lineA);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, a)).toEqual([{ block_id: blkA, minutes: 60 }]);

        const b = await entry(w, w.svcB, 90, w.lineB);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, b)).toEqual([{ block_id: blkB, minutes: 90 }]);

        // Unattributed time on an uncovered service draws ONLY the ad-hoc block.
        const free = await entry(w, w.svcFree, 30, null);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, free)).toEqual([{ block_id: adhoc, minutes: 30 }]);

        // Plain-contract time draws nothing, not even the ad-hoc all-labor block.
        const plain = await entry(w, w.svcC, 30, w.linePlain);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, plain)).toEqual([]);

        // Contract time overflowing its own block never spills into B's or the ad-hoc block.
        const bigA = await entry(w, w.svcA, 1000, w.lineA);
        const bigAlloc = await allocateTimeEntry(trx, w.tenant, w.clientId, bigA);
        expect(bigAlloc).toEqual([{ block_id: blkA, minutes: 540 }]);

        expect(await remaining(w, blkA, trx)).toBe(0);
        expect(await remaining(w, blkB, trx)).toBe(510);
        expect(await remaining(w, adhoc, trx)).toBe(570);
      });
    } finally {
      await teardown(w);
    }
  });

  it('gap draw: active blocks FIFO first, then the line pending block; overflow beyond pending stays unallocated', async () => {
    const w = await setup();
    try {
      const active = await block(w, { line: w.lineA, remaining: 120, expiration: '2027-01-01' });
      // Pending expires EARLIER than the active block, yet is drawn last.
      const pending = await block(w, { line: w.lineA, status: 'pending', total: 100, expiration: '2026-12-31' });

      await w.db.transaction(async (trx: Knex.Transaction) => {
        const e1 = await entry(w, w.svcA, 150, w.lineA);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, e1)).toEqual(
          [{ block_id: active, minutes: 120 }, { block_id: pending, minutes: 30 }],
        );
        // Overflow: only 70 left on the pending block, entry needs 200.
        const e2 = await entry(w, w.svcA, 200, w.lineA, '2026-08-10', 1);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, e2)).toEqual([{ block_id: pending, minutes: 70 }]);
        expect(await remaining(w, active, trx)).toBe(0);
        expect(await remaining(w, pending, trx)).toBe(0);
        // No further minutes anywhere: a third entry is entirely unallocated.
        const e3 = await entry(w, w.svcA, 45, w.lineA, '2026-08-10', 2);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, e3)).toEqual([]);
      });
    } finally {
      await teardown(w);
    }
  });

  it('reconcileLineAllocations re-draws overflow onto a new pending block, is idempotent, and releases on void', async () => {
    const w = await setup();
    try {
      const active = await block(w, { line: w.lineA, remaining: 120 });
      const e1 = await entry(w, w.svcA, 100, w.lineA, '2026-08-10', 0);
      const e2 = await entry(w, w.svcA, 100, w.lineA, '2026-08-11', 0);
      const otherLine = await entry(w, w.svcB, 60, w.lineB, '2026-08-11', 1);
      const blkB = await block(w, { line: w.lineB, serviceId: w.svcB });

      await w.db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, w.tenant, w.clientId, e1);
        await allocateTimeEntry(trx, w.tenant, w.clientId, e2); // only 20 left -> partial
        await allocateTimeEntry(trx, w.tenant, w.clientId, otherLine);
      });
      expect(await allocatedFor(w, e2.entry_id)).toEqual([{ block_id: active, minutes: 20 }]);

      // A follow-on is drafted: pending block. Overflow already logged lands on it.
      const pending = await block(w, { line: w.lineA, status: 'pending', total: 600 });
      const snapshot = async () => ({
        blocks: await w.db('hour_blocks').where({ tenant: w.tenant }).orderBy('block_id').select('block_id', 'remaining_minutes'),
        allocations: await w.db('hour_block_time_allocations').where({ tenant: w.tenant }).orderBy(['block_id', 'time_entry_id']).select('block_id', 'time_entry_id', 'minutes'),
      });

      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, e1.entry_id)).toEqual([{ block_id: active, minutes: 100 }]);
      expect(await allocatedFor(w, e2.entry_id)).toEqual(
        [{ block_id: active, minutes: 20 }, { block_id: pending, minutes: 80 }].sort((x, y) => (x.block_id < y.block_id ? -1 : 1)),
      );
      expect(await remaining(w, active)).toBe(0);
      expect(await remaining(w, pending)).toBe(520);
      // Line B untouched by line A's re-draw.
      expect(await remaining(w, blkB)).toBe(540);
      expect(await allocatedFor(w, otherLine.entry_id)).toEqual([{ block_id: blkB, minutes: 60 }]);

      // Idempotent.
      const first = await snapshot();
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await snapshot()).toEqual(first);

      // Void the pending block: minutes are released and fall back to unallocated (overage).
      await w.db('hour_blocks').where({ tenant: w.tenant, block_id: pending }).update({ status: 'voided' });
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, e2.entry_id)).toEqual([{ block_id: active, minutes: 20 }]);
      expect(await remaining(w, pending)).toBe(600);
      expect(
        Number((await w.db('hour_block_time_allocations').where({ tenant: w.tenant, block_id: pending }).count({ n: '*' }).first())!.n),
      ).toBe(0);

      // Invoiced entries are never re-drawn.
      await w.db('time_entries').where({ tenant: w.tenant, entry_id: e1.entry_id }).update({ invoiced: true });
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, e1.entry_id)).toEqual([{ block_id: active, minutes: 100 }]);
    } finally {
      await teardown(w);
    }
  });

  it('draws eligible historical capacity in FIFO order, excluding voided and out-of-window blocks', async () => {
    const w = await setup();
    try {
      const outside = await block(w, { line: w.lineA, status: 'expired', expiration: '2026-08-09', remaining: 600 });
      const voided = await block(w, { line: w.lineA, status: 'voided', expiration: '2026-08-11', remaining: 600 });
      const historical = await block(w, { line: w.lineA, status: 'expired', validFrom: '2026-08-01', expiration: '2026-08-15', remaining: 90 });
      const active = await block(w, { line: w.lineA, status: 'active', validFrom: '2026-08-01', expiration: '2026-08-31', remaining: 60 });
      const future = await block(w, { line: w.lineA, status: 'active', validFrom: '2026-09-01', remaining: 600 });
      const pending = await block(w, { line: w.lineA, status: 'pending', expiration: '2026-08-12', remaining: 40 });
      const work = await entry(w, w.svcA, 200, w.lineA, '2026-08-10');
      await w.db.transaction(async (trx: Knex.Transaction) => {
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, work)).toEqual([
          { block_id: historical, minutes: 90 }, { block_id: active, minutes: 60 }, { block_id: pending, minutes: 40 },
        ]);
      });
      expect(await Promise.all([outside, voided, historical, active, future, pending].map((id) => remaining(w, id))))
        .toEqual([600, 600, 0, 0, 600, 0]);
    } finally {
      await teardown(w);
    }
  });

  it('reconcileLineAllocations keeps entries drawn against an expired contract block', async () => {
    const w = await setup();
    try {
      const expired = await block(w, { line: w.lineA, status: 'active', remaining: 600, expiration: '2026-08-31' });
      const e1 = await entry(w, w.svcA, 100, w.lineA, '2026-08-10');
      await w.db.transaction((trx: Knex.Transaction) => allocateTimeEntry(trx, w.tenant, w.clientId, e1));
      await w.db('hour_blocks').where({ tenant: w.tenant, block_id: expired }).update({ status: 'expired' });
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, e1.entry_id)).toEqual([{ block_id: expired, minutes: 100 }]);
      expect(await remaining(w, expired)).toBe(500);
    } finally {
      await teardown(w);
    }
  });

  it('reconcileLineAllocations keeps a null-line entry drawn via deterministic resolution, re-draws it onto a new pending block, and releases it on void', async () => {
    const w = await setup();
    try {
      const active = await block(w, { line: w.lineA, remaining: 120 });
      const explicit = await entry(w, w.svcA, 100, w.lineA, '2026-08-10', 0);
      const nullLine = await entry(w, w.svcA, 100, null, '2026-08-11', 0);
      await w.db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, w.tenant, w.clientId, explicit);
        await allocateTimeEntry(trx, w.tenant, w.clientId, nullLine); // 20 left -> partial
      });
      expect(await allocatedFor(w, nullLine.entry_id)).toEqual([{ block_id: active, minutes: 20 }]);

      // Plain reconcile must not strip the null-line entry's coverage.
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, nullLine.entry_id)).toEqual([{ block_id: active, minutes: 20 }]);
      expect(await allocatedFor(w, explicit.entry_id)).toEqual([{ block_id: active, minutes: 100 }]);

      // A pending block appears: overflow of the null-line entry lands on it.
      const pending = await block(w, { line: w.lineA, status: 'pending', total: 600 });
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, nullLine.entry_id)).toEqual(
        [{ block_id: active, minutes: 20 }, { block_id: pending, minutes: 80 }].sort((x, y) => (x.block_id < y.block_id ? -1 : 1)),
      );
      expect(await remaining(w, pending)).toBe(520);

      // Void: released, back to the active block's 20 minutes only.
      await w.db('hour_blocks').where({ tenant: w.tenant, block_id: pending }).update({ status: 'voided' });
      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      expect(await allocatedFor(w, nullLine.entry_id)).toEqual([{ block_id: active, minutes: 20 }]);
      expect(await remaining(w, pending)).toBe(600);
      expect(await remaining(w, active)).toBe(0);
    } finally {
      await teardown(w);
    }
  });

  it('nightly client reconcile covers block-line entries (incl. unattributed) without crossing lines, and stays idempotent', async () => {
    const w = await setup();
    try {
      const blkA = await block(w, { line: w.lineA });
      const blkB = await block(w, { line: w.lineB, serviceId: w.svcB });
      const adhoc = await block(w, { line: null, serviceId: w.svcFree });
      const onA = await entry(w, w.svcA, 60, w.lineA, '2026-08-10', 0);
      const unattributedA = await entry(w, w.svcA, 30, null, '2026-08-10', 1);
      const onB = await entry(w, w.svcB, 40, w.lineB, '2026-08-10', 2);
      const free = await entry(w, w.svcFree, 20, null, '2026-08-10', 3);
      const plain = await entry(w, w.svcC, 50, w.linePlain, '2026-08-10', 4);

      await w.db.transaction((trx: Knex.Transaction) => reconcileClientAllocations(trx, w.tenant, w.clientId));
      expect(await allocatedFor(w, onA.entry_id)).toEqual([{ block_id: blkA, minutes: 60 }]);
      expect(await allocatedFor(w, unattributedA.entry_id)).toEqual([{ block_id: blkA, minutes: 30 }]);
      expect(await allocatedFor(w, onB.entry_id)).toEqual([{ block_id: blkB, minutes: 40 }]);
      expect(await allocatedFor(w, free.entry_id)).toEqual([{ block_id: adhoc, minutes: 20 }]);
      expect(await allocatedFor(w, plain.entry_id)).toEqual([]);

      const state = async () => w.db('hour_blocks').where({ tenant: w.tenant }).orderBy('block_id').select('block_id', 'remaining_minutes');
      const before = await state();
      await w.db.transaction((trx: Knex.Transaction) => reconcileClientAllocations(trx, w.tenant, w.clientId));
      expect(await state()).toEqual(before);
    } finally {
      await teardown(w);
    }
  });

  it('balances: ad-hoc balance and bucket subjects exclude contract blocks; contractLineId filters to one line', async () => {
    const w = await setup();
    try {
      await block(w, { line: w.lineA, remaining: 300 });
      await block(w, { line: w.lineB, serviceId: w.svcB, remaining: 200 });
      await block(w, { line: null, serviceId: w.svcFree, remaining: 100 });
      // A pending contract block is never part of any available balance.
      await block(w, { line: w.lineA, status: 'pending', remaining: 600 });

      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId)).toBe(600);
      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId, undefined, { adhocOnly: true })).toBe(100);
      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId, undefined, { contractLineId: w.lineA })).toBe(300);
      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId, undefined, { contractLineId: w.lineB })).toBe(200);

      const subjects = await getAvailableHourBlockMinutesForSubjects(w.db, w.tenant, w.clientId, [
        { key: 'bucket-1', serviceId: w.svcA },
        { key: 'bucket-2', serviceId: w.svcFree },
      ]);
      // svcA's contract block is excluded; only the unscoped ad-hoc block is attributable.
      expect(Array.from(subjects.values()).reduce((sum, v) => sum + v, 0)).toBe(100);
    } finally {
      await teardown(w);
    }
  });

  // D5 / R8: hour_blocks.valid_from bounds the burn window from below, so a
  // cadence block never draws time worked before its service period starts.
  it('valid_from excludes time before the block starts on allocate, and NULL valid_from is unbounded', async () => {
    const w = await setup();
    try {
      const nov = await block(w, { line: w.lineA, validFrom: '2026-11-01', expiration: '2026-11-30' });
      const dec = await block(w, { line: w.lineA, validFrom: '2026-12-01', expiration: '2026-12-31' });
      const open = await block(w, { line: w.lineA, validFrom: null, expiration: null, remaining: 60, total: 60 });

      await w.db.transaction(async (trx: Knex.Transaction) => {
        // Before every window: only the unbounded block can draw.
        const early = await entry(w, w.svcA, 30, w.lineA, '2026-10-20');
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, early)).toEqual([{ block_id: open, minutes: 30 }]);

        // November time: Nov block (expires first) then the unbounded block; never December.
        const novEntry = await entry(w, w.svcA, 640, w.lineA, '2026-11-20');
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, novEntry)).toEqual([
          { block_id: nov, minutes: 600 },
          { block_id: open, minutes: 30 },
        ]);
        expect(await remaining(w, dec, trx)).toBe(600);

        // Window boundaries are inclusive on both ends.
        const first = await entry(w, w.svcA, 10, w.lineA, '2026-12-01');
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, first)).toEqual([{ block_id: dec, minutes: 10 }]);
        const lastNov = await entry(w, w.svcA, 10, w.lineA, '2026-11-30', 1);
        // Nov is exhausted and the open block is drained: nothing eligible, Dec still not drawn.
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, lastNov)).toEqual([]);
        expect(await remaining(w, dec, trx)).toBe(590);
      });
    } finally {
      await teardown(w);
    }
  });

  it('valid_from keeps a late November entry off the December block through line and client reconcile', async () => {
    const w = await setup();
    try {
      const nov = await block(w, { line: w.lineA, validFrom: '2026-11-01', expiration: '2026-11-30' });
      const dec = await block(w, { line: w.lineA, validFrom: '2026-12-01', expiration: '2026-12-31' });
      const novFull = await entry(w, w.svcA, 600, w.lineA, '2026-11-10');
      const decEntry = await entry(w, w.svcA, 120, w.lineA, '2026-12-03');
      // Entered late (after the December block exists): November time beyond the Nov block is overage.
      const lateNov = await entry(w, w.svcA, 60, w.lineA, '2026-11-25');

      await w.db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, w.tenant, w.clientId, novFull);
        await allocateTimeEntry(trx, w.tenant, w.clientId, decEntry);
        expect(await allocateTimeEntry(trx, w.tenant, w.clientId, lateNov)).toEqual([]);
      });
      const expected = async () => {
        expect(await allocatedFor(w, novFull.entry_id)).toEqual([{ block_id: nov, minutes: 600 }]);
        expect(await allocatedFor(w, decEntry.entry_id)).toEqual([{ block_id: dec, minutes: 120 }]);
        expect(await allocatedFor(w, lateNov.entry_id)).toEqual([]);
        expect(await remaining(w, nov)).toBe(0);
        expect(await remaining(w, dec)).toBe(480);
      };
      await expected();

      await w.db.transaction((trx: Knex.Transaction) => reconcileLineAllocations(trx, w.tenant, w.lineA));
      await expected();
      await w.db.transaction((trx: Knex.Transaction) => reconcileClientAllocations(trx, w.tenant, w.clientId));
      await expected();
    } finally {
      await teardown(w);
    }
  });

  it('valid_from excludes not-yet-valid blocks from available minutes (line, ad-hoc and subject balances)', async () => {
    const w = await setup();
    try {
      // No tenant timezone configured: "today" is the UTC calendar date.
      const shift = (days: number) => {
        const d = new Date(`${toCalendarDateStringInTimeZone(new Date(), 'UTC')}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      await block(w, { line: w.lineA, remaining: 100, validFrom: null });
      await block(w, { line: w.lineA, remaining: 200, validFrom: shift(-1), expiration: shift(30) });
      await block(w, { line: w.lineA, remaining: 400, validFrom: shift(0), expiration: shift(30) });
      await block(w, { line: w.lineA, remaining: 800, validFrom: shift(1), expiration: shift(30) });
      await block(w, { line: null, serviceId: w.svcFree, remaining: 50, validFrom: null });
      await block(w, { line: null, serviceId: w.svcFree, remaining: 25, validFrom: shift(5) });

      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId, undefined, { contractLineId: w.lineA })).toBe(700);
      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId, undefined, { adhocOnly: true })).toBe(50);
      expect(await getAvailableHourBlockMinutes(w.db, w.tenant, w.clientId)).toBe(750);

      const subjects = await getAvailableHourBlockMinutesForSubjects(w.db, w.tenant, w.clientId, [
        { key: 'bucket-1', serviceId: w.svcFree },
      ]);
      expect(subjects.get('bucket-1')).toBe(50);
    } finally {
      await teardown(w);
    }
  });
});
