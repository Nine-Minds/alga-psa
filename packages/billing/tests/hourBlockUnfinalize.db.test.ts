import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { getAvailableHourBlockMinutes, allocateTimeEntry } from '@alga-psa/shared/billingClients/hourBlockService';

// Guarded DB test for the unfinalize lifecycle (29.8.18 Blocker 3, round 1):
// unfinalizing an invoice must never leave its hour block active/spendable.
// Unused blocks return to pending atomically with the invoice (a
// purchase_reversal audit row is written, FIFO burn can no longer select the
// block); blocks that have been used (immutable first_allocated_at marker, or
// live allocation rows) abort the unfinalization with an actionable error —
// invoice and block stay finalized.
//
// Round 2 (Blocker 2) adds the genuinely-concurrent coverage: the unused-check
// and the pending transition row-lock the affected hour_blocks (canonical
// block_id order — the same lock allocateTimeEntry takes), so an allocation
// that commits while unfinalization is in flight is fully visible to the
// guard (rejection) instead of landing on a block that just went pending.

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

interface Seed {
  invoiceId: string;
  blockId: string;
  clientId: string;
}

async function seed(overrides: {
  firstAllocatedAt?: string | null;
  withAllocationRows?: boolean;
}): Promise<Seed> {
  const clientId = uuidv4();
  const invoiceId = uuidv4();
  const blockId = uuidv4();
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const itemId = uuidv4();
  await db('tenants').insert({ tenant, client_name: 'HB Unfinalize Tenant', email: 'hbunf@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Unfinalize Client' });
  await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Unfinalize Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Unfinalize Svc',
    custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
    unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `HB-UNF-${invoiceId.slice(0, 8)}`,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 100000, subtotal: 100000, tax: 0, status: 'sent', is_manual: true, is_prepayment: false,
    credit_applied: 0, finalized_at: new Date().toISOString(),
  });
  await db('invoice_charges').insert({
    tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceId,
    description: 'Prepaid hour block — Unfinalize Svc', quantity: 10, unit_price: 10000,
    total_price: 100000, tax_rate: 0, is_manual: true,
  });
  await db('hour_blocks').insert({
    block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
    total_minutes: 600, remaining_minutes: overrides.firstAllocatedAt || overrides.withAllocationRows ? 480 : 600,
    hourly_rate: 10000, purchase_amount: 100000,
    currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
    source_invoice_id: invoiceId, source_invoice_charge_id: itemId, source_type: 'purchase',
    first_allocated_at: overrides.firstAllocatedAt ?? null,
  });
  if (overrides.withAllocationRows) {
    const entryUserId = uuidv4();
    await db('users').insert({
      tenant, user_id: entryUserId, username: `hbunf_${entryUserId.slice(0, 8)}`,
      hashed_password: 'x', email: `hbunf_${entryUserId.slice(0, 8)}@test.local`,
    });
    await db('time_entries').insert({
      tenant, entry_id: uuidv4(), user_id: entryUserId,
      work_date: '2026-08-10', work_timezone: 'UTC',
    });
    const entry = await db('time_entries').where({ tenant }).first();
    await db('hour_block_time_allocations').insert({
      tenant, block_id: blockId, time_entry_id: entry.entry_id, minutes: 120,
    });
  }
  return { invoiceId, blockId, clientId };
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Seeds a ticket + eligible time entry so the REAL allocateTimeEntry can burn
 * the seeded block. Returns the entry in BlockBurnTimeEntry shape.
 */
async function seedBurnableEntry(blockId: string, clientId: string, minutes = 120) {
  const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
  const ticketId = uuidv4();
  await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'HB Unfinalize Race Ticket', ticket_number: `HB-UNFR-${ticketId.slice(0, 8)}` });
  const entryUserId = uuidv4();
  await db('users').insert({
    tenant, user_id: entryUserId, username: `hbunfr_${entryUserId.slice(0, 8)}`,
    hashed_password: 'x', email: `hbunfr_${entryUserId.slice(0, 8)}@test.local`,
  });
  const entryId = uuidv4();
  const start = new Date('2026-08-10T09:00:00.000Z');
  await db('time_entries').insert({
    tenant, entry_id: entryId, user_id: entryUserId, service_id: block.service_id,
    work_item_id: ticketId, work_item_type: 'ticket',
    start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
    work_date: '2026-08-10', work_timezone: 'UTC',
    billable_duration: minutes, approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
  });
  return {
    entry_id: entryId,
    service_id: block.service_id as string,
    billable_duration: minutes,
    contract_line_id: null,
    work_item_id: ticketId,
    work_item_type: 'ticket',
    work_date: '2026-08-10',
    start_time: start.toISOString(),
  };
}

describe.runIf(enabled)('unfinalizeInvoice hour-block lifecycle (Blocker 3)', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    tenant = uuidv4();
    userId = uuidv4();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('unused block: unfinalize returns the block to pending and FIFO burn can no longer select it', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    try {
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(600);

      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);
      expect(result).toEqual({ success: true });

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('draft');
      expect(invoice.finalized_at).toBeNull();

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('pending');
      expect(block.purchased_at).toBeNull();
      // Mint-time economics are retained for the next finalization.
      expect(block.total_minutes).toBe(600);
      expect(block.remaining_minutes).toBe(600);

      const audit = await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' }).first();
      expect(audit).toBeTruthy();
      expect(audit.reason).toBe('Invoice unfinalized');
      expect(audit.metadata.source_invoice_id).toBe(invoiceId);

      // The block is unavailable to burn while the invoice is a draft.
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('unused block: refinalizing activates it again (coherent pending → active → pending → active cycle)', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    try {
      const { unfinalizeInvoice, activateHourBlocksForFinalizedInvoice } = await import('../src/actions/invoiceModification');
      await unfinalizeInvoice(invoiceId);
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(0);

      await activateHourBlocksForFinalizedInvoice(invoiceId, db, tenant, userId);

      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(block.purchased_at).toBeTruthy();
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(600);
    } finally {
      await cleanup();
    }
  });

  it('used block (immutable marker set): unfinalization is rejected with an actionable error and nothing rolls back', async () => {
    const { invoiceId, blockId } = await seed({ firstAllocatedAt: new Date().toISOString() });
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);

      expect(result).toHaveProperty('actionError');
      const message = (result as { actionError: string }).actionError;
      expect(message).toContain(blockId);
      expect(message).toContain('2.0 of 10.0 hrs');
      expect(message).toContain('hour block');

      // Atomic rejection: invoice stays finalized, block stays active.
      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('sent');
      expect(invoice.finalized_at).toBeTruthy();
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' }).first()).toBeFalsy();
    } finally {
      await cleanup();
    }
  });

  it('used block (live allocation rows only, marker null): unfinalization is still rejected (belt-and-suspenders)', async () => {
    const { invoiceId, blockId } = await seed({ withAllocationRows: true });
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const result = await unfinalizeInvoice(invoiceId);

      expect(result).toHaveProperty('actionError');
      expect((result as { actionError: string }).actionError).toContain(blockId);

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('sent');
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
    } finally {
      await cleanup();
    }
  });

  // Genuinely concurrent (29.8.18 Blocker 2): the unfinalize path's first
  // touch of the block is a SELECT ... FOR UPDATE, so when an allocation
  // transaction holds/queues on the same row lock, unfinalization PARKS until
  // that allocation commits — then the guard sees the committed
  // first_allocated_at marker and live rows and rejects. Pre-fix, the guard
  // read a stale unused block and the update landed after the allocation
  // committed: a `pending` (unburnable) block with a live allocation against
  // it (review run b2b3038e reproduction).
  it('race: an allocation committing while unfinalization is in flight parks unfinalization at the row lock, which then rejects on the committed burn', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    const holderDb = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 1 } });
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const entry = await seedBurnableEntry(blockId, clientId, 120);

      // Transaction A (the allocation side): lock the block — exactly where a
      // mid-flight allocateTimeEntry sits after its eligible-block select.
      const holderTrx = await holderDb.transaction();
      await holderTrx('hour_blocks').where({ tenant, block_id: blockId }).select('block_id').forUpdate();

      // Transaction B: unfinalization starts and must PARK at its own
      // SELECT ... FOR UPDATE on the block row.
      let unfinalizeSettled = false;
      const unfinalizePromise = (async () => {
        const result = await unfinalizeInvoice(invoiceId);
        unfinalizeSettled = true;
        return result;
      })();
      await sleep(300);
      expect(unfinalizeSettled, 'unfinalizeInvoice must block on the hour_blocks row lock while the allocation holds it').toBe(false);

      // The allocation commits (real burn engine code, same locking
      // discipline) — 120 minutes against the still-active block.
      const allocations = await allocateTimeEntry(holderTrx as unknown as Knex.Transaction, tenant, clientId, entry);
      expect(allocations).toEqual([{ block_id: blockId, minutes: 120 }]);
      await holderTrx.commit();

      // B unparks on the committed state and behaves correctly: rejection,
      // not a pending block with a live allocation.
      const result = await unfinalizePromise;
      expect(result).toHaveProperty('actionError');
      expect((result as { actionError: string }).actionError).toContain(blockId);

      const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
      expect(invoice.status).toBe('sent');
      expect(invoice.finalized_at).toBeTruthy();
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('active');
      expect(block.first_allocated_at).toBeTruthy();
      expect(Number(block.remaining_minutes)).toBe(480);
      const liveRows = await db('hour_block_time_allocations').where({ tenant, block_id: blockId });
      expect(liveRows).toHaveLength(1);
      expect(Number(liveRows[0].minutes)).toBe(120);
      expect(await db('hour_block_audit').where({ tenant, block_id: blockId, type: 'purchase_reversal' }).first()).toBeFalsy();
    } finally {
      await holderDb.destroy();
      await cleanup();
    }
  });

  // The mirrored serialization order: unfinalization's pending transition
  // commits first, and a subsequently started allocation (real burn engine)
  // no longer sees an eligible block — the loser sees committed state.
  it('race (mirror): after unfinalization commits, a concurrent-start allocation finds no burnable block and writes nothing', async () => {
    const { invoiceId, blockId, clientId } = await seed({});
    try {
      const { unfinalizeInvoice } = await import('../src/actions/invoiceModification');
      const entry = await seedBurnableEntry(blockId, clientId, 120);

      // Unfinalization's pending transition commits first...
      const result = await unfinalizeInvoice(invoiceId);
      expect(result).toEqual({ success: true });
      expect(await db('hour_blocks').where({ tenant, block_id: blockId }).first()).toHaveProperty('status', 'pending');

      // ...and an allocation started against that committed state (real burn
      // engine, same locking discipline) finds no burnable block and writes
      // nothing.
      const allocations = await db.transaction(async (trx: Knex.Transaction) => allocateTimeEntry(trx, tenant, clientId, entry));
      expect(allocations).toEqual([]);
      expect(await db('hour_block_time_allocations').where({ tenant, block_id: blockId })).toHaveLength(0);
      const block = await db('hour_blocks').where({ tenant, block_id: blockId }).first();
      expect(block.status).toBe('pending');
      expect(block.first_allocated_at).toBeNull();
      expect(Number(block.remaining_minutes)).toBe(600);
      expect(await getAvailableHourBlockMinutes(db, tenant, clientId)).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
