import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import { activateHourBlocksForFinalizedInvoice } from '../src/actions/invoiceModification';
import { allocateTimeEntry } from '@alga-psa/shared/billingClients/hourBlockService';

// Guarded DB test for the hour-block lock-discipline gaps closed in 29.8.18
// mitigation round 3. Two violations of the r2 invariant (every hour_blocks
// check-then-act site takes SELECT ... FOR UPDATE in canonical block_id
// order) are pinned here:
//   1. Finalize-activation used to snapshot the pending blocks OUTSIDE its
//      transaction with no lock and flip them with a status-blind UPDATE, so
//      a void/expire/unfinalize committing in between was resurrected to
//      `active` with a `purchase` audit on top of the void audit.
//   2. Manual adjust used to read the block unlocked, compute the absolute
//      new remaining in JS, and write it — a classic lost update that
//      silently erased a concurrent burn's decrement.
// Round 4 pins the remaining gap, the draft-deletion hook:
//   3. voidPendingHourBlocksForDeletedInvoice used to read the linked blocks
//      from an unlocked snapshot and void/detach with status-blind UPDATEs,
//      so a finalization committing in between was stomped: the just-active
//      block was re-voided, the finalized invoice deleted, and a bogus void
//      audit written on top of the purchase audit.
// The race tests hold a REAL pg transaction mid-flight on a second connection
// and assert the action parks at the row lock and then behaves on the
// committed state. No sleep-and-hope: the row lock serializes the outcome;
// the sleep only evidences the parking (same harness as
// hourBlockUnfinalize.db.test.ts).

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

// adjustHourBlockRemaining is withAuth-wrapped and calls createTenantKnex();
// stub the auth stack and point the connection at the real test DB.
// tenantDb / withTransaction keep their real implementations (withTransaction
// opens its own trx on `db`, or joins a trx the caller passes).
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isActionError(result: unknown): result is { actionError: string } {
  return typeof result === 'object' && result !== null && 'actionError' in result;
}

interface PendingPurchaseSeed {
  invoiceId: string;
  blockId: string;
  itemId: string;
  clientId: string;
  serviceId: string;
}

interface ActiveBlockSeed {
  blockId: string;
  clientId: string;
  serviceId: string;
  entry: {
    entry_id: string;
    service_id: string;
    work_item_id: string;
    work_item_type: 'ticket';
    billable_duration: number;
    contract_line_id: null;
    work_date: string;
    start_time: string;
  };
}

describe.runIf(enabled)('hour block lock discipline (29.8.18 mitigation round 3)', () => {
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

  /** Draft purchase invoice + linked pending block (hourBlockFinalizeSync shape). */
  async function seedPendingPurchase(): Promise<PendingPurchaseSeed> {
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    const blockId = uuidv4();
    const itemId = uuidv4();
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB Lock Tenant', email: 'hblock@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Lock Client' });
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Lock Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Lock Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('invoices').insert({
      invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `HB-LOCK-${invoiceId.slice(0, 8)}`,
      invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
      total_amount: 100000, subtotal: 100000, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
    });
    await db('invoice_charges').insert({
      tenant, item_id: itemId, invoice_id: invoiceId, service_id: serviceId,
      description: 'Prepaid hour block — Lock Svc', quantity: 10, unit_price: 10000,
      total_price: 100000, tax_rate: 0, is_manual: true,
    });
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 100000,
      currency_code: 'USD', status: 'pending', purchased_at: null, source_invoice_id: invoiceId,
      source_invoice_charge_id: itemId, source_type: 'purchase',
    });
    return { invoiceId, blockId, itemId, clientId, serviceId };
  }

  /** Active grant-style block plus a burnable ticket time entry (hourBlockVoidGuard shape). */
  async function seedActiveBlockWithBurnableEntry(minutes = 120): Promise<ActiveBlockSeed> {
    const clientId = uuidv4();
    const serviceTypeId = uuidv4();
    const serviceId = uuidv4();
    const blockId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'HB Adj Tenant', email: 'hbadj@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'HB Adj Client' });
    await db('service_types').insert({ id: serviceTypeId, tenant, name: 'HB Adj Type', is_active: true, order_number: 1 });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: 'Adj Svc',
      custom_service_type_id: serviceTypeId, billing_method: 'hourly', default_rate: 10000,
      unit_of_measure: 'hour', category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    await db('hour_blocks').insert({
      block_id: blockId, tenant, client_id: clientId, service_id: serviceId,
      total_minutes: 600, remaining_minutes: 600, hourly_rate: 10000, purchase_amount: 0,
      currency_code: 'USD', status: 'active', purchased_at: new Date().toISOString(),
      source_invoice_id: null, source_type: 'grant',
    });
    const ticketId = uuidv4();
    await db('tickets').insert({ tenant, ticket_id: ticketId, client_id: clientId, title: 'HB Adj Ticket', ticket_number: `HB-ADJ-${ticketId.slice(0, 8)}` });
    const entryUserId = uuidv4();
    await db('users').insert({
      tenant, user_id: entryUserId, username: `hbadj_${entryUserId.slice(0, 8)}`,
      hashed_password: 'x', email: `hbadj_${entryUserId.slice(0, 8)}@test.local`,
      user_type: 'internal', first_name: 'HB', last_name: 'Adj',
    });
    const entryId = uuidv4();
    const start = new Date('2026-08-10T09:00:00.000Z');
    await db('time_entries').insert({
      tenant, entry_id: entryId, user_id: entryUserId, service_id: serviceId,
      work_item_id: ticketId, work_item_type: 'ticket',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + minutes * 60000).toISOString(),
      work_date: '2026-08-10', work_timezone: 'UTC',
      billable_duration: minutes, approval_status: 'APPROVED', invoiced: false, contract_line_id: null,
    });
    return {
      blockId,
      clientId,
      serviceId,
      entry: {
        entry_id: entryId,
        service_id: serviceId,
        work_item_id: ticketId,
        work_item_type: 'ticket' as const,
        billable_duration: minutes,
        contract_line_id: null,
        work_date: '2026-08-10',
        start_time: start.toISOString(),
      },
    };
  }

  // Resurrection guard, sequential shape (the race outcome with the void
  // already committed): the locked, status-filtered pending select must treat
  // the block as not-its-business — no activation, no purchase audit, mint
  // values and void provenance untouched.
  it('activation never resurrects a block that was voided before finalization', async () => {
    const s = await seedPendingPurchase();
    try {
      const voidedAt = new Date().toISOString();
      await db('hour_blocks').where({ tenant, block_id: s.blockId }).update({
        status: 'voided', voided_at: voidedAt, voided_by: userId,
        void_reason: 'mistaken purchase', updated_at: voidedAt,
      });

      await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, userId);

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.void_reason).toBe('mistaken purchase');
      expect(Number(block.total_minutes)).toBe(600);
      expect(Number(block.remaining_minutes)).toBe(600);
      expect(block.purchased_at).toBeNull();
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();
    } finally {
      await cleanup();
    }
  });

  // Resurrection guard, genuinely concurrent: a void transaction is mid-flight
  // (row locked, status flip written but uncommitted) when activation starts.
  // Activation's first touch must be a SELECT ... FOR UPDATE that PARKS on the
  // row lock; when the void commits, the locked select re-evaluates committed
  // state and excludes the block — activation no-ops. Pre-fix, the unlocked
  // snapshot saw `pending`, and the status-blind UPDATE waited on the lock and
  // then resurrected the voided block to `active`.
  it('race: a void committing while activation is in flight parks activation at the row lock; the block stays voided', async () => {
    const s = await seedPendingPurchase();
    const holderDb = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 1 } });
    try {
      // Transaction A (mid-flight voidHourBlock): lock the block, flip it to
      // voided, and hold the transaction open.
      const holderTrx = await holderDb.transaction();
      await holderTrx('hour_blocks').where({ tenant, block_id: s.blockId }).select('block_id').forUpdate();
      const voidedAt = new Date().toISOString();
      await holderTrx('hour_blocks').where({ tenant, block_id: s.blockId }).update({
        status: 'voided', voided_at: voidedAt, voided_by: userId,
        void_reason: 'mistaken purchase', updated_at: voidedAt,
      });

      // Transaction B: activation starts and must PARK at its own
      // SELECT ... FOR UPDATE on the block row.
      let activateSettled = false;
      const activatePromise = (async () => {
        await activateHourBlocksForFinalizedInvoice(s.invoiceId, db, tenant, userId);
        activateSettled = true;
      })();
      await sleep(300);
      expect(activateSettled, 'activation must block on the hour_blocks row lock while the void holds it').toBe(false);

      // The void wins the race and commits.
      await holderTrx.commit();

      // Activation unparks on the committed state and no-ops: the voided
      // block is never resurrected.
      await activatePromise;
      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('voided');
      expect(block.void_reason).toBe('mistaken purchase');
      expect(Number(block.total_minutes)).toBe(600);
      expect(Number(block.remaining_minutes)).toBe(600);
      expect(block.purchased_at).toBeNull();
      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first()).toBeFalsy();
    } finally {
      await holderDb.destroy();
      await cleanup();
    }
  });

  // Adjust vs burn lost update, genuinely concurrent: transaction A runs the
  // REAL burn engine (allocateTimeEntry) and holds its transaction open — it
  // holds the hour_blocks row lock from its eligible-block select. Transaction
  // B is a manual adjust: its first touch of the block must be a
  // SELECT ... FOR UPDATE that PARKS. When the burn commits, B reads the
  // post-burn balance and applies the delta on top. Pre-fix, B's unlocked read
  // saw the pre-burn 600 and its absolute write (660) silently erased the
  // burn's decrement; the audit recorded a stale previous_remaining_minutes.
  it('race: manual adjust parks on the row lock and applies the delta to the post-burn balance (no lost update)', async () => {
    const s = await seedActiveBlockWithBurnableEntry(120);
    const holderDb = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 1 } });
    try {
      // Transaction A (the burn side): real burn engine code, uncommitted —
      // the row lock is held, exactly where a mid-flight allocateTimeEntry
      // sits after its eligible-block select.
      const holderTrx = await holderDb.transaction();
      const allocations = await allocateTimeEntry(holderTrx as unknown as Knex.Transaction, tenant, s.clientId, s.entry);
      expect(allocations).toEqual([{ block_id: s.blockId, minutes: 120 }]);

      // Transaction B: the manual adjust starts and must PARK at its own
      // SELECT ... FOR UPDATE on the block row.
      let adjustSettled = false;
      const adjustPromise = (async () => {
        const { adjustHourBlockRemaining } = await import('../src/actions/hourBlockActions');
        const result = await adjustHourBlockRemaining(s.blockId, 60, 'goodwill credit');
        adjustSettled = true;
        return result;
      })();
      await sleep(300);
      expect(adjustSettled, 'adjustHourBlockRemaining must block on the hour_blocks row lock while the burn holds it').toBe(false);

      // The burn commits: 600 → 480.
      await holderTrx.commit();

      // B unparks on the committed state: delta applied to the post-burn
      // balance (480 + 60 = 540), never the stale pre-burn 600 (+60 = 660).
      const result = await adjustPromise;
      expect(isActionError(result)).toBe(false);

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(Number(block.remaining_minutes)).toBe(540);

      // The audit's previous_remaining_minutes is the post-burn value the
      // locked read actually saw, and the burn's allocation row is intact.
      const audit = await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'adjustment' }).first();
      expect(audit).toBeTruthy();
      expect(Number(audit.minutes_delta)).toBe(60);
      expect(audit.metadata.previous_remaining_minutes).toBe(480);
      const burnRows = await db('hour_block_time_allocations').where({ tenant, block_id: s.blockId });
      expect(burnRows).toHaveLength(1);
      expect(Number(burnRows[0].minutes)).toBe(120);
    } finally {
      await holderDb.destroy();
      await cleanup();
    }
  });

  // Draft-deletion vs finalization race, genuinely concurrent (29.8.18
  // mitigation round 4): transaction A is the REAL finalize-activation code
  // joined onto a held-open holder trx (withTransaction reuses a passed trx),
  // sitting exactly where a finalize transaction sits after activation,
  // before commit — the hour_blocks row lock is held with the pending→active
  // flip written but uncommitted. Transaction B is hardDeleteInvoice: its
  // first touch of the block must be a SELECT ... FOR UPDATE that PARKS. When
  // the finalization commits, B's locked select re-evaluates committed state,
  // sees `active`, and refuses the deletion — the whole deletion transaction
  // rolls back, invoice included. Pre-fix, B's snapshot was an unlocked read
  // that saw `pending`, and its status-blind void UPDATE parked on the lock
  // and then stomped the just-activated block back to `voided`, deleted the
  // invoice, and wrote a bogus void audit on top of the purchase audit.
  it('race: a finalization committing while draft deletion is in flight parks deletion at the row lock; the block stays active and the invoice survives', async () => {
    const s = await seedPendingPurchase();
    const holderDb = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 1 } });
    try {
      // Transaction A (the finalization side): real activation code on a
      // trx held open mid-flight — row locked, pending → active flip
      // uncommitted.
      const holderTrx = await holderDb.transaction();
      await activateHourBlocksForFinalizedInvoice(s.invoiceId, holderTrx as unknown as Knex.Transaction, tenant, userId);

      // Transaction B: the draft deletion starts and must PARK at its own
      // SELECT ... FOR UPDATE on the block row.
      let deleteSettled = false;
      const deletePromise = (async () => {
        const { hardDeleteInvoice } = await import('../src/actions/invoiceModification');
        const result = await hardDeleteInvoice(s.invoiceId);
        deleteSettled = true;
        return result;
      })();
      await sleep(300);
      expect(deleteSettled, 'hardDeleteInvoice must block on the hour_blocks row lock while finalization holds it').toBe(false);

      // The finalization wins the race and commits.
      await holderTrx.commit();

      // B unparks on the committed state: the block is active, so the
      // deletion is refused wholesale — no clobbered status, no orphaned
      // pending block, no void audit for a block this path did not void.
      const result = await deletePromise;
      expect(isActionError(result)).toBe(true);

      const block = await db('hour_blocks').where({ tenant, block_id: s.blockId }).first();
      expect(block.status).toBe('active');
      expect(block.voided_at).toBeNull();
      expect(block.source_invoice_id).toBe(s.invoiceId);

      const invoice = await db('invoices').where({ tenant, invoice_id: s.invoiceId }).first();
      expect(invoice).toBeTruthy();

      expect(await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'void' }).first()).toBeFalsy();
      const purchaseAudit = await db('hour_block_audit').where({ tenant, block_id: s.blockId, type: 'purchase' }).first();
      expect(purchaseAudit).toBeTruthy();
    } finally {
      await holderDb.destroy();
      await cleanup();
    }
  });
});
