import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

/**
 * Concurrency regression for the TOCTOU race in applyCreditToInvoiceInternal:
 * two overlapping applications to the same invoice must not both observe the
 * same remaining eligible headroom and jointly exceed the eligible-subtotal
 * cap. The fix is the FOR UPDATE lock on the invoice row (taken before the
 * credit_applied / eligible-headroom read and held until the application's
 * writes commit).
 *
 * Unlike the sibling credit suites, this file deliberately does NOT use
 * TestContext and does NOT mock withTransaction to a passthrough:
 * - TestContext binds all data to one uncommitted root transaction, which a
 *   second, genuinely concurrent transaction could never see;
 * - the passthrough withTransaction mock would collapse both "transactions"
 *   onto one connection, making row-lock contention unobservable.
 * Instead, data is seeded committed on a plain pool connection and each
 * applyCreditToInvoiceInternal call owns a real database transaction on its
 * own pool connection, so the two applications genuinely overlap and contend
 * on the row lock exactly as production connections do.
 */

const testDbRef: { db: Knex | null } = { db: null };
let tenantId = '';
const userId = uuidv4();

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

// createTenantKnex must hand back the POOL (not a transaction) so each apply
// opens its own real transaction via the REAL withTransaction — which is why,
// unlike the sibling suites, withTransaction is not overridden here.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDbRef.db, tenant: tenantId })),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

// Post-commit workflow events are irrelevant to the race under test.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: 'concurrency-test-user',
      tenant: tenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

// voidInvoice checks permissions via the '@alga-psa/auth/rbac' subpath — a
// distinct module id from '@alga-psa/auth', so it needs its own mock.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

import { createTestDbConnection } from '../../../../../test-utils/dbConfig';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { currentUserRef } from '../../../../../test-utils/authModuleMock';
import { applyCreditToInvoiceInternal } from '@alga-psa/billing/actions/creditActions';
import { voidInvoice } from '@alga-psa/billing/actions/voidInvoiceActions';

let db: Knex;

/**
 * Each test gets its own client: credit draw-down selects credits client-wide
 * (oldest/expiring first), so tests sharing a client would consume each
 * other's seeded credits — and this suite runs under `sequence.shuffle`.
 */
async function seedClient(name: string): Promise<string> {
  return createClient(db, tenantId, name, {
    billing_cycle: 'monthly',
    is_tax_exempt: true,
  });
}

/**
 * Invoice with a fixed eligible-subtotal cap strictly below the invoice
 * total: a single invoice_charges row of `eligibleCap` on an invoice of
 * `invoiceTotal`. Keeping the cap below the invoice total matters — the
 * pre-existing clamp-to-remaining-invoice check must NOT be what stops the
 * second application, or the race would be masked.
 */
async function seedInvoice(clientId: string, eligibleCap: number, invoiceTotal: number): Promise<string> {
  const invoiceId = uuidv4();
  const now = new Date().toISOString();
  await db('invoices').insert({
    tenant: tenantId,
    invoice_id: invoiceId,
    client_id: clientId,
    invoice_number: `CONC-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    subtotal: invoiceTotal,
    tax: 0,
    total_amount: invoiceTotal,
    status: 'sent',
    credit_applied: 0,
    currency_code: 'USD',
    is_manual: false,
    is_prepayment: false,
    invoice_type: 'standard',
  });
  await db('invoice_charges').insert({
    tenant: tenantId,
    item_id: uuidv4(),
    invoice_id: invoiceId,
    description: 'Eligible charge',
    quantity: 1,
    unit_price: eligibleCap,
    total_price: eligibleCap,
    net_amount: eligibleCap,
    tax_rate: 0,
    tax_amount: 0,
    is_manual: false,
    is_taxable: false,
  });
  return invoiceId;
}

async function seedCredit(clientId: string, amount: number): Promise<string> {
  const now = new Date().toISOString();
  const transactionId = uuidv4();
  await db('transactions').insert({
    transaction_id: transactionId,
    tenant: tenantId,
    client_id: clientId,
    amount,
    type: 'credit_issuance',
    status: 'completed',
    description: 'Concurrency test credit',
    created_at: now,
    balance_after: amount,
    currency_code: 'USD',
  });
  const creditId = uuidv4();
  await db('credit_tracking').insert({
    credit_id: creditId,
    tenant: tenantId,
    client_id: clientId,
    transaction_id: transactionId,
    amount,
    remaining_amount: amount,
    created_at: now,
    updated_at: now,
    is_expired: false,
    currency_code: 'USD',
  });
  return creditId;
}

async function invoiceState(invoiceId: string) {
  const invoice = await db('invoices')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .first();
  const allocationSum = await db('credit_allocations')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .sum({ total: 'amount' })
    .first();
  return {
    creditApplied: Number(invoice?.credit_applied ?? 0),
    allocationTotal: Number(allocationSum?.total ?? 0),
  };
}

async function creditsSpent(creditIds: string[]): Promise<number> {
  const rows = await db('credit_tracking')
    .whereIn('credit_id', creditIds)
    .where({ tenant: tenantId })
    .select('amount', 'remaining_amount');
  return rows.reduce(
    (sum, row) => sum + (Number(row.amount) - Number(row.remaining_amount)),
    0
  );
}

/**
 * Standard finalized invoice that already has `applied` of credit drawn from a
 * single seeded credit — the state voidInvoice's standard branch reverses:
 * credit_applied set, a credit_application transaction carrying the
 * applied_credits metadata the reversal walks, and the credit_tracking row
 * drawn down by the same amount.
 */
async function seedAppliedCreditInvoice(clientId: string, creditAmount: number, applied: number) {
  const invoiceId = await seedInvoice(clientId, applied, applied);
  const creditId = await seedCredit(clientId, creditAmount);
  const now = new Date().toISOString();
  await db('invoices')
    .where({ invoice_id: invoiceId, tenant: tenantId })
    .update({ finalized_at: now, credit_applied: applied });
  await db('credit_tracking')
    .where({ credit_id: creditId, tenant: tenantId })
    .update({ remaining_amount: creditAmount - applied, updated_at: now });
  await db('transactions').insert({
    transaction_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    invoice_id: invoiceId,
    amount: -applied,
    type: 'credit_application',
    status: 'completed',
    description: 'Concurrency test credit application',
    created_at: now,
    balance_after: creditAmount - applied,
    currency_code: 'USD',
    metadata: { applied_credits: [{ creditId, amount: applied }] },
  });
  return { invoiceId, creditId };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until at least `count` backends sit in a row-lock wait — i.e. the
 * concurrently launched voidInvoice call(s) have run into the held invoice
 * row lock. No query-text filter: WHERE the void blocks is version-dependent
 * (post-fix it is the first-statement invoice FOR UPDATE; pre-fix it was the
 * reversal's transactions INSERT, whose invoice FK check needs KEY SHARE on
 * the FOR UPDATE-locked invoice row). The NOWAIT probe in the test, not this
 * helper, discriminates the two worlds. The suite is the database's only
 * client while this file runs, so any lock waiter is ours.
 */
async function waitForLockWaiters(count: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await db.raw(
      `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'`
    );
    if (Number(result.rows?.[0]?.waiting ?? 0) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} lock waiter(s)`);
    }
    await sleep(100);
  }
}

describe('applyCreditToInvoiceInternal under concurrent applications', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDbRef.db = db;
    const tenantRow = await db('tenants').first();
    if (!tenantRow?.tenant) {
      throw new Error('Seeded test database has no tenant');
    }
    tenantId = tenantRow.tenant as string;
    // The withAuth mock injects currentUserRef.user as the acting user;
    // voidInvoice scopes every query to that user's tenant.
    currentUserRef.user = { ...currentUserRef.user, tenant: tenantId };
  }, 240000);

  afterAll(async () => {
    await db?.destroy();
  }, 30000);

  it('two overlapping full-cap applications never exceed the eligible subtotal', async () => {
    const eligibleCap = 6000;
    const clientId = await seedClient('Concurrent Full Cap Client');
    const invoiceId = await seedInvoice(clientId, eligibleCap, 10000);
    // Each credit alone can cover the full cap, so without serialization both
    // racers can satisfy their entire request (aggregate 12000 > cap 6000,
    // still under the 10000 invoice total, so nothing else clamps it).
    const creditIds = [await seedCredit(clientId, 10000), await seedCredit(clientId, 10000)];

    const results = await Promise.all([
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceId, eligibleCap),
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceId, eligibleCap),
    ]);

    const appliedAmounts = results.map((result) => result.appliedAmount);
    const aggregateApplied = appliedAmounts.reduce((sum, amount) => sum + amount, 0);

    // The serialized loser must re-read the winner's committed credit_applied
    // and clamp to zero remaining headroom.
    expect(aggregateApplied).toBe(eligibleCap);
    expect(appliedAmounts.sort((a, b) => a - b)).toEqual([0, eligibleCap]);

    const state = await invoiceState(invoiceId);
    expect(state.creditApplied).toBe(eligibleCap);
    expect(state.allocationTotal).toBe(eligibleCap);
    expect(state.creditApplied).toBeLessThanOrEqual(eligibleCap);

    // Credit draw-down reconciles with what landed on the invoice.
    expect(await creditsSpent(creditIds)).toBe(eligibleCap);
  }, 60000);

  it('two overlapping partial applications aggregate to exactly the eligible subtotal', async () => {
    const eligibleCap = 6000;
    const clientId = await seedClient('Concurrent Partial Client');
    const invoiceId = await seedInvoice(clientId, eligibleCap, 10000);
    const creditIds = [await seedCredit(clientId, 10000), await seedCredit(clientId, 10000)];

    const results = await Promise.all([
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceId, 4000),
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceId, 4000),
    ]);

    const appliedAmounts = results.map((result) => result.appliedAmount);
    const aggregateApplied = appliedAmounts.reduce((sum, amount) => sum + amount, 0);

    // Winner applies its full 4000; loser re-reads committed headroom and
    // clamps to the remaining 2000. Unserialized, both apply 4000 (8000 > cap).
    expect(aggregateApplied).toBe(eligibleCap);
    expect(appliedAmounts.sort((a, b) => a - b)).toEqual([2000, 4000]);

    const state = await invoiceState(invoiceId);
    expect(state.creditApplied).toBe(eligibleCap);
    expect(state.allocationTotal).toBe(eligibleCap);

    expect(await creditsSpent(creditIds)).toBe(eligibleCap);
  }, 60000);

  it('same-client applications to different invoices persist a consistent balance_after chain', async () => {
    // The invoice row lock cannot serialize this pair — each application
    // locks a different invoice — so they serialize only on the client's
    // credit_tracking FOR UPDATE. The client-currency balance that feeds the
    // credit_application transaction's balance_after must be read after that
    // lock: read pre-lock, the loser persists a balance_after that ignores
    // the winner's committed draw-down.
    const clientId = await seedClient('Concurrent Cross Invoice Client');
    const invoiceA = await seedInvoice(clientId, 3000, 10000);
    const invoiceB = await seedInvoice(clientId, 4000, 10000);
    const creditIds = [await seedCredit(clientId, 10000)];

    const results = await Promise.all([
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceA, 3000),
      applyCreditToInvoiceInternal(tenantId, userId, clientId, invoiceB, 4000),
    ]);

    // The shared credit covers both requests in full — the race under test is
    // balance bookkeeping, not headroom clamping.
    const appliedAmounts = results.map((result) => result.appliedAmount);
    expect(appliedAmounts.sort((a, b) => a - b)).toEqual([3000, 4000]);

    const stateA = await invoiceState(invoiceA);
    const stateB = await invoiceState(invoiceB);
    expect(stateA.creditApplied).toBe(3000);
    expect(stateA.allocationTotal).toBe(3000);
    expect(stateB.creditApplied).toBe(4000);
    expect(stateB.allocationTotal).toBe(4000);
    expect(await creditsSpent(creditIds)).toBe(7000);

    const applications = await db('transactions')
      .where({ client_id: clientId, tenant: tenantId, type: 'credit_application' })
      .select('amount', 'balance_after');
    expect(applications).toHaveLength(2);

    // Whichever commit order won, the two transactions must form one coherent
    // chain from the seeded 10000: the first-committed application's
    // balance_after is 10000 minus its own draw-down, and the second's
    // continues from there — matching the true final balance (3000). A stale
    // pre-lock read instead leaves the loser at 10000 minus only its own
    // amount (6000 or 7000).
    const chain = applications
      .map((tx) => ({ applied: -Number(tx.amount), after: Number(tx.balance_after) }))
      .sort((a, b) => b.after - a.after);
    expect(chain[0].after).toBe(10000 - chain[0].applied);
    expect(chain[1].after).toBe(chain[0].after - chain[1].applied);
    expect(chain[1].after).toBe(3000);
  }, 60000);

  /**
   * Lock-order regression: applyCreditToInvoiceInternal locks the invoice row
   * first, then credit_tracking rows. Pre-fix, voidInvoice's transaction did
   * the opposite — it restored credit_tracking rows first and updated the
   * invoice row last — so a concurrent apply + void could each hold one lock
   * while waiting on the other: a PostgreSQL deadlock (40P01). The fix makes
   * the void transaction's first statement a FOR UPDATE on the invoice row.
   *
   * Deterministic proof, no deadlock roulette: hold the invoice row lock from
   * a bare transaction (standing in for apply's first lock), start a void, and
   * wait until its backend is provably lock-waiting. Post-fix the void has
   * touched nothing yet, so the client's credit_tracking rows are lockable
   * with FOR UPDATE NOWAIT. Pre-fix the void already holds row locks on
   * credit_tracking while it waits — the NOWAIT probe fails with 55P03,
   * exhibiting exactly the inverted hold-and-wait the deadlock needs.
   */
  it('void waits on the invoice row before touching credit_tracking', async () => {
    const clientId = await seedClient('Void Lock Order Client');
    const { invoiceId, creditId } = await seedAppliedCreditInvoice(clientId, 10000, 4000);

    const invoiceHolder = await db.transaction();
    try {
      await invoiceHolder('invoices')
        .where({ invoice_id: invoiceId, tenant: tenantId })
        .forUpdate()
        .first();

      const voidPromise = voidInvoice(invoiceId, 'lock-order regression');
      await waitForLockWaiters(1);

      // The void backend is blocked on the invoice row. It must not yet hold
      // any credit_tracking row lock — NOWAIT throws 55P03 if it does.
      const probe = await db.transaction();
      try {
        await expect(
          probe('credit_tracking')
            .where({ tenant: tenantId, client_id: clientId })
            .forUpdate()
            .noWait()
            .select('credit_id')
        ).resolves.toBeTruthy();
      } finally {
        await probe.rollback();
      }

      await invoiceHolder.rollback();

      const result = await voidPromise;
      expect(result).toEqual({ success: true });
    } catch (error) {
      if (!invoiceHolder.isCompleted()) await invoiceHolder.rollback();
      throw error;
    }

    // Released, the void completes with a full, single reversal.
    const invoice = await db('invoices')
      .where({ invoice_id: invoiceId, tenant: tenantId })
      .first();
    expect(invoice?.status).toBe('cancelled');
    expect(Number(invoice?.credit_applied)).toBe(0);

    const credit = await db('credit_tracking')
      .where({ credit_id: creditId, tenant: tenantId })
      .first();
    expect(Number(credit?.remaining_amount)).toBe(10000);
  }, 60000);

  it('concurrent double-void reverses the applied credit exactly once', async () => {
    // Both voids pass the cheap pre-transaction guards, then queue on the
    // invoice row lock. The loser must re-read status under the lock and see
    // 'cancelled' — pre-fix both proceeded from the stale snapshot and each
    // restored the credit, minting money.
    const clientId = await seedClient('Concurrent Double Void Client');
    const { invoiceId, creditId } = await seedAppliedCreditInvoice(clientId, 10000, 4000);

    const invoiceHolder = await db.transaction();
    let results: Array<{ success: boolean; error?: string }>;
    try {
      await invoiceHolder('invoices')
        .where({ invoice_id: invoiceId, tenant: tenantId })
        .forUpdate()
        .first();

      const voids = [
        voidInvoice(invoiceId, 'double-void race A'),
        voidInvoice(invoiceId, 'double-void race B'),
      ];
      await waitForLockWaiters(2);
      await invoiceHolder.rollback();
      results = await Promise.all(voids);
    } catch (error) {
      if (!invoiceHolder.isCompleted()) await invoiceHolder.rollback();
      throw error;
    }

    const successes = results.filter((r) => r.success);
    expect(successes).toHaveLength(1);
    expect(results.find((r) => !r.success)?.error).toBe('Invoice is already voided.');

    const credit = await db('credit_tracking')
      .where({ credit_id: creditId, tenant: tenantId })
      .first();
    // Restored once: back to the full 10000, not 14000.
    expect(Number(credit?.remaining_amount)).toBe(10000);

    const reversals = await db('transactions')
      .where({ invoice_id: invoiceId, tenant: tenantId, type: 'credit_adjustment' })
      .select('transaction_id');
    expect(reversals).toHaveLength(1);
  }, 60000);
});
