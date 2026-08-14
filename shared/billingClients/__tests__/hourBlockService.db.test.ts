import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
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

describe.runIf(enabled)('hourBlockService DB integration', () => {
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
});
