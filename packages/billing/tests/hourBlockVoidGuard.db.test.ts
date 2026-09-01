import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import {
  allocateTimeEntry,
  reverseTimeEntryAllocations,
  reconcileClientAllocations,
} from '@alga-psa/shared/billingClients/hourBlockService';

// Guarded DB test for the durable "ever used" void guard on hour blocks. Run
// ONLY against an explicitly provided database with:
//   HOUR_BLOCK_DB_HOST HOUR_BLOCK_DB_PORT HOUR_BLOCK_DB_USER
//   HOUR_BLOCK_DB_PASSWORD HOUR_BLOCK_DB_NAME HOUR_BLOCK_DB_TESTS=1
// The suite creates an isolated tenant and cleans up after itself. Skipped by
// default so CI (which has no test DB) stays green.
//
// The regression being pinned: reversal DELETES hour_block_time_allocations
// rows, so "has current allocation rows" cannot guard voiding. voidHourBlock
// must refuse any block whose immutable first_allocated_at marker is set, even
// after the burn was reversed.

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

// voidHourBlock / listHourBlocks are withAuth-wrapped and call
// createTenantKnex(); stub the auth stack and point the connection at the real
// test DB. Everything else (tenantDb, withTransaction) keeps its real
// implementation.
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

describe.runIf(enabled)('hour block durable void guard', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function cleanup() {
    await db('hour_block_time_allocations').where({ tenant }).delete();
    await db('hour_block_service_scopes').where({ tenant }).delete();
    await db('hour_block_audit').where({ tenant }).delete();
    await db('hour_blocks').where({ tenant }).delete();
    await db('time_entries').where({ tenant }).delete();
    await db('tickets').where({ tenant }).delete();
    await db('users').where({ tenant }).delete();
    await db('invoice_charges').where({ tenant }).delete();
    await db('invoices').where({ tenant }).delete();
    await db('service_catalog').where({ tenant }).delete();
    await db('service_types').where({ tenant }).delete();
    await db('clients').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
  }

  async function seedClientService() {
    const clientId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB Void Tenant', email: 'hbvoid@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Void Client' });
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Void Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Void Guard Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    const ticketId = uuidv4();
    await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'HB Void Ticket', ticket_number: `HB-${ticketId.slice(0, 8)}` });
    const entryUser = uuidv4();
    await db('users').insert({
      user_id: entryUser, tenant, username: `hbv_${entryUser.slice(0, 8)}`,
      hashed_password: 'x', email: `hbv_${entryUser.slice(0, 8)}@test.local`,
      user_type: 'internal', first_name: 'HB', last_name: 'Void',
    });
    return { clientId, serviceId, ticketId, entryUser };
  }

  async function insertBlock(clientId: string, serviceId: string, status: string): Promise<string> {
    const blockId = uuidv4();
    const isPending = status === 'pending';
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
      currency_code: 'USD', status, purchased_at: isPending ? null : new Date().toISOString(),
      source_invoice_id: null, source_type: isPending ? 'purchase' : 'grant',
    });
    return blockId;
  }

  async function insertEntry(serviceId: string, ticketId: string, entryUser: string, minutes: number, workDate = '2026-08-10') {
    const entryId = uuidv4();
    const start = new Date(`${workDate}T09:00:00.000Z`);
    await db('time_entries').insert({
      entry_id: entryId, tenant, user_id: entryUser, service_id: serviceId,
      work_item_id: ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
      work_date: workDate, work_timezone: 'UTC',
      billable_duration: minutes, approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
    });
    return {
      entry_id: entryId, service_id: serviceId, work_item_id: ticketId, work_item_type: 'ticket',
      billable_duration: minutes, contract_line_id: null, work_date: workDate, start_time: start.toISOString(),
    };
  }

  function isActionError(result: unknown): result is { actionError: string } {
    return typeof result === 'object' && result !== null && 'actionError' in result;
  }

  it('rejects voiding a block whose burn was fully reversed (the regression)', async () => {
    const { clientId, serviceId, ticketId, entryUser } = await seedClientService();
    const blockId = await insertBlock(clientId, serviceId, 'active');
    const entry = await insertEntry(serviceId, ticketId, entryUser, 60);

    try {
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      const afterBurn = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(Number(afterBurn.remaining_minutes)).toBe(540);
      expect(afterBurn.first_allocated_at).toBeTruthy();

      // Reversal deletes the allocation rows and restores the balance — the
      // exact state that used to let the block be voided.
      await db.transaction(async (trx: Knex.Transaction) => {
        await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
      });
      const afterReverse = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(Number(afterReverse.remaining_minutes)).toBe(600);
      const rows = await db('hour_block_time_allocations').where({ tenant, block_id: blockId });
      expect(rows).toHaveLength(0);
      expect(afterReverse.first_allocated_at).toBeTruthy();

      const { voidHourBlock } = await import('../src/actions/hourBlockActions');
      const result = await voidHourBlock(blockId, 'mistaken purchase');
      expect(isActionError(result)).toBe(true);
      expect((result as { actionError: string }).actionError).toMatch(/has been used/);

      // Guard refusal is atomic: the block is still active, marker intact.
      const still = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(still.status).toBe('active');
    } finally {
      await cleanup();
    }
  });

  it('sets first_allocated_at once and keeps it across reverse + re-allocate + reconcile cycles', async () => {
    const { clientId, serviceId, ticketId, entryUser } = await seedClientService();
    const blockId = await insertBlock(clientId, serviceId, 'active');
    const entry = await insertEntry(serviceId, ticketId, entryUser, 60);

    try {
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      const first = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(first.first_allocated_at).toBeTruthy();

      // reverse -> re-allocate -> reverse -> reconcile: the marker must never move.
      await db.transaction(async (trx: Knex.Transaction) => {
        await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
      });
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      await db.transaction(async (trx: Knex.Transaction) => {
        await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
      });
      await db.transaction(async (trx: Knex.Transaction) => {
        await reconcileClientAllocations(trx, tenant, clientId);
      });

      const after = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(after.first_allocated_at).toBeTruthy();
      expect(new Date(after.first_allocated_at).getTime()).toBe(new Date(first.first_allocated_at).getTime());
      // Reconcile re-allocated the still-eligible entry, so the balance is burned again.
      expect(Number(after.remaining_minutes)).toBe(540);
    } finally {
      await cleanup();
    }
  });

  it('still voids a never-burned pending block', async () => {
    const { clientId, serviceId } = await seedClientService();
    const blockId = await insertBlock(clientId, serviceId, 'pending');

    try {
      const { voidHourBlock } = await import('../src/actions/hourBlockActions');
      const result = await voidHourBlock(blockId, 'mistaken purchase');
      expect(isActionError(result)).toBe(false);
      expect((result as { block_id: string; status: string }).block_id).toBe(blockId);
      expect((result as { block_id: string; status: string }).status).toBe('voided');

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId }).first();
      expect(audit).toBeTruthy();
      expect(audit.type).toBe('void');
    } finally {
      await cleanup();
    }
  });

  it('still voids a never-burned active block', async () => {
    const { clientId, serviceId } = await seedClientService();
    const blockId = await insertBlock(clientId, serviceId, 'active');

    try {
      const { voidHourBlock } = await import('../src/actions/hourBlockActions');
      const result = await voidHourBlock(blockId, 'mistaken grant');
      expect(isActionError(result)).toBe(false);
      expect((result as { block_id: string; status: string }).status).toBe('voided');
    } finally {
      await cleanup();
    }
  });

  it('listHourBlocks used flag reflects the marker after reversal', async () => {
    const { clientId, serviceId, ticketId, entryUser } = await seedClientService();
    const usedBlock = await insertBlock(clientId, serviceId, 'active');
    const neverBlock = await insertBlock(clientId, serviceId, 'active');
    const entry = await insertEntry(serviceId, ticketId, entryUser, 60);

    try {
      await db.transaction(async (trx: Knex.Transaction) => {
        await allocateTimeEntry(trx, tenant, clientId, entry);
      });
      await db.transaction(async (trx: Knex.Transaction) => {
        await reverseTimeEntryAllocations(trx, tenant, entry.entry_id);
      });

      const { listHourBlocks } = await import('../src/actions/hourBlockActions');
      const rows = await listHourBlocks(clientId);
      expect(Array.isArray(rows)).toBe(true);

      const usedRow = (rows as Array<Record<string, any>>).find((r) => r.block_id === usedBlock);
      expect(usedRow).toBeTruthy();
      expect(usedRow.has_allocations).toBe(true);
      expect(usedRow.first_allocated_at).toBeTruthy();
      // The live allocation rows are gone but the void affordance must stay off.
      expect(Number(usedRow.remaining_minutes)).toBe(600);

      const neverRow = (rows as Array<Record<string, any>>).find((r) => r.block_id === neverBlock);
      expect(neverRow).toBeTruthy();
      expect(neverRow.has_allocations).toBe(false);
      expect(neverRow.first_allocated_at).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
