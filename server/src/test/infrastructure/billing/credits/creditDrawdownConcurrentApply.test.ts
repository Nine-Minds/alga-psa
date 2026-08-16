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

import { createTestDbConnection } from '../../../../../test-utils/dbConfig';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { applyCreditToInvoiceInternal } from '@alga-psa/billing/actions/creditActions';

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

describe('applyCreditToInvoiceInternal under concurrent applications', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDbRef.db = db;
    const tenantRow = await db('tenants').first();
    if (!tenantRow?.tenant) {
      throw new Error('Seeded test database has no tenant');
    }
    tenantId = tenantRow.tenant as string;
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
});
