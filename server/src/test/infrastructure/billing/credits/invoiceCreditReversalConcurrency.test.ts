import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Real-concurrency regression tests for the unified credit reversal
 * primitive: committed rows on a plain connection, one dedicated knex client
 * per concurrent actor, REAL transactions (no withTransaction identity mock).
 * These prove the invoice-row-then-credit-rows lock order actually
 * serializes apply against reversal instead of asserting on source strings.
 */

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

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

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: mockedUserId,
      tenant: mockedTenantId,
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { createTestDbConnection } from '../../../../../test-utils/dbConfig';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { currentUserRef } from '../../../../../test-utils/authModuleMock';
import { reverseCreditApplicationsForInvoice } from '@alga-psa/billing/lib/creditReversal';
import { applyCreditToInvoiceInternal } from '@alga-psa/billing/actions/creditActions';
import { unfinalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Knex;
/** One dedicated client per concurrent actor ("one client per test"). */
let actorA: Knex;
let actorB: Knex;
let tenant: string;

interface SeededCredit {
  creditId: string;
  transactionId: string;
  amount: number;
}

async function newTestClient(name: string): Promise<string> {
  return createClient(db, tenant, name, {
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    credit_balance: 0,
  });
}

async function seedCredit(clientId: string, amount: number): Promise<SeededCredit> {
  const transactionId = uuidv4();
  const creditId = uuidv4();
  const now = new Date().toISOString();
  await db('transactions').insert({
    transaction_id: transactionId,
    tenant,
    client_id: clientId,
    invoice_id: null,
    amount,
    type: 'credit_issuance',
    status: 'completed',
    description: 'Concurrency test credit issuance',
    created_at: now,
    balance_after: null,
    currency_code: 'USD',
  });
  await db('credit_tracking').insert({
    credit_id: creditId,
    tenant,
    client_id: clientId,
    transaction_id: transactionId,
    amount,
    remaining_amount: amount,
    created_at: now,
    is_expired: false,
    updated_at: now,
    currency_code: 'USD',
  });
  return { creditId, transactionId, amount };
}

interface SeededInvoice {
  invoiceId: string;
  applicationTransactionIds: string[];
}

/**
 * Seed a committed finalized invoice, optionally with credit applications
 * already drawn (matching what applyCreditToInvoiceInternal writes: the
 * application transaction with applied_credits provenance, the allocation
 * row, drained credit_tracking balances, and invoices.credit_applied).
 */
async function seedFinalizedInvoice(options: {
  clientId: string;
  total: number;
  applications?: Array<Array<{ credit: SeededCredit; amount: number }>>;
}): Promise<SeededInvoice> {
  const invoiceId = uuidv4();
  const now = new Date().toISOString();
  await db('invoices').insert({
    invoice_id: invoiceId,
    tenant,
    client_id: options.clientId,
    invoice_number: `CONC-${invoiceId.slice(0, 8)}`,
    invoice_date: now,
    due_date: now,
    total_amount: options.total,
    subtotal: options.total,
    tax: 0,
    status: 'sent',
    finalized_at: now,
    credit_applied: 0,
    is_manual: false,
    is_prepayment: false,
    currency_code: 'USD',
    invoice_type: 'standard',
  });
  await db('invoice_charges').insert({
    item_id: uuidv4(),
    tenant,
    invoice_id: invoiceId,
    description: 'Concurrency test charge',
    quantity: 1,
    unit_price: options.total,
    net_amount: options.total,
    total_price: options.total,
    tax_amount: 0,
    tax_rate: 0,
    is_manual: false,
  });

  const applicationTransactionIds: string[] = [];
  for (const draws of options.applications ?? []) {
    const transactionId = uuidv4();
    const total = draws.reduce((sum, draw) => sum + draw.amount, 0);
    for (const draw of draws) {
      await db('credit_tracking')
        .where({ credit_id: draw.credit.creditId, tenant })
        .decrement('remaining_amount', draw.amount);
    }
    await db('transactions').insert({
      transaction_id: transactionId,
      tenant,
      client_id: options.clientId,
      invoice_id: invoiceId,
      amount: -total,
      type: 'credit_application',
      status: 'completed',
      description: `Applied credit to invoice ${invoiceId}`,
      created_at: new Date().toISOString(),
      balance_after: null,
      currency_code: 'USD',
      metadata: JSON.stringify({
        applied_credits: draws.map((draw) => ({ creditId: draw.credit.creditId, amount: draw.amount })),
      }),
    });
    await db('credit_allocations').insert({
      allocation_id: uuidv4(),
      tenant,
      transaction_id: transactionId,
      invoice_id: invoiceId,
      amount: total,
      created_at: new Date().toISOString(),
    });
    await db('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .increment('credit_applied', total);
    applicationTransactionIds.push(transactionId);
  }

  return { invoiceId, applicationTransactionIds };
}

async function remainingAmount(creditId: string): Promise<number> {
  const row = await db('credit_tracking').where({ credit_id: creditId, tenant }).first('remaining_amount');
  return Number(row?.remaining_amount ?? 0);
}

async function invoiceCreditApplied(invoiceId: string): Promise<number> {
  const row = await db('invoices').where({ invoice_id: invoiceId, tenant }).first('credit_applied');
  return Number(row?.credit_applied ?? 0);
}

async function adjustmentsFor(invoiceId: string) {
  return db('transactions')
    .where({ invoice_id: invoiceId, type: 'credit_adjustment', tenant })
    .select('*');
}

/** A caller-shaped reversal: invoice row FOR UPDATE first, then the primitive. */
async function runReversal(
  client: Knex,
  invoiceId: string,
  options: { holdMsAfterReversal?: number; beforeCommit?: () => void | Promise<void> } = {}
): Promise<void> {
  await client.transaction(async (trx) => {
    await trx('invoices').where({ invoice_id: invoiceId, tenant }).forUpdate().first();
    await reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, mockedUserId, 'invoice_unfinalized');
    if (options.holdMsAfterReversal) {
      await sleep(options.holdMsAfterReversal);
    }
    if (options.beforeCommit) {
      await options.beforeCommit();
    }
  });
}

describe('invoice credit reversal — real concurrency', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
    const tenantRow = await db('tenants').first('tenant');
    if (!tenantRow) {
      throw new Error('Seeded tenant not found');
    }
    tenant = String(tenantRow.tenant);
    mockedTenantId = tenant;
    currentUserRef.user.tenant = tenant;
    currentUserRef.user.user_id = mockedUserId;

    actorA = await createTestDbConnection({ recreate: false });
    actorB = await createTestDbConnection({ recreate: false });

    // Warm the app-side pool createTenantKnex hands to the real actions so the
    // in-flight timing assertions below don't measure pool spin-up.
    const warmupClientId = await newTestClient('Warmup Client');
    const warmup = await seedFinalizedInvoice({ clientId: warmupClientId, total: 100 });
    await applyCreditToInvoiceInternal(tenant, mockedUserId, warmupClientId, warmup.invoiceId, 0);
  }, 180000);

  afterAll(async () => {
    await actorA?.destroy();
    await actorB?.destroy();
    await db?.destroy();
  }, 30000);

  it('two concurrent reversals restore the application exactly once', async () => {
    const clientId = await newTestClient('Double Reversal Client');
    const credit = await seedCredit(clientId, 10000);
    const { invoiceId, applicationTransactionIds } = await seedFinalizedInvoice({
      clientId,
      total: 8000,
      applications: [[{ credit, amount: 5000 }]],
    });
    expect(await remainingAmount(credit.creditId)).toBe(5000);

    await Promise.all([
      runReversal(actorA, invoiceId),
      runReversal(actorB, invoiceId),
    ]);

    // The second reverser waited on the invoice lock, re-read the ledger, saw
    // the reversal_of link, and restored nothing.
    expect(await remainingAmount(credit.creditId)).toBe(10000);
    expect(await invoiceCreditApplied(invoiceId)).toBe(0);
    const adjustments = await adjustmentsFor(invoiceId);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].metadata.reversal_of).toBe(applicationTransactionIds[0]);
  });

  it('a concurrent apply blocks on the invoice lock until the reversal commits, then draws from restored balances', async () => {
    const clientId = await newTestClient('Apply vs Reversal Client');
    const credit = await seedCredit(clientId, 10000);
    const { invoiceId } = await seedFinalizedInvoice({
      clientId,
      total: 8000,
      applications: [[{ credit, amount: 5000 }]],
    });

    let applyFinished = false;
    let applyPromise: Promise<{ appliedAmount: number }> | undefined;

    await runReversal(actorA, invoiceId, {
      beforeCommit: async () => {
        // Launch the real apply path while the reversal still holds the
        // invoice row lock; its first statement is the invoices FOR UPDATE.
        applyPromise = applyCreditToInvoiceInternal(tenant, mockedUserId, clientId, invoiceId, 2000)
          .then((result) => {
            applyFinished = true;
            return result;
          });
        await sleep(500);
        // Still blocked — apply must not interleave with the uncommitted reversal.
        expect(applyFinished).toBe(false);
      },
    });

    const applyResult = await applyPromise!;
    expect(applyResult.appliedAmount).toBe(2000);

    // Serialized outcome: restore (+5000) fully visible before the draw (−2000).
    expect(await remainingAmount(credit.creditId)).toBe(8000);
    expect(await invoiceCreditApplied(invoiceId)).toBe(2000);

    // Ledger agrees: one reversed application, one new active application.
    const adjustments = await adjustmentsFor(invoiceId);
    expect(adjustments).toHaveLength(1);
    const applications = await db('transactions')
      .where({ invoice_id: invoiceId, type: 'credit_application', tenant })
      .select('transaction_id');
    expect(applications).toHaveLength(2);
  });

  it('reversal and apply on different invoices over the same credit pool complete without deadlock', async () => {
    const clientId = await newTestClient('Cross Invoice Client');
    const credit1 = await seedCredit(clientId, 10000);
    const credit2 = await seedCredit(clientId, 10000);
    const invoiceA = await seedFinalizedInvoice({
      clientId,
      total: 8000,
      applications: [[
        { credit: credit1, amount: 3000 },
        { credit: credit2, amount: 3000 },
      ]],
    });
    const invoiceB = await seedFinalizedInvoice({ clientId, total: 8000 });

    // Overlap: the reversal holds its locks for a while as the apply runs.
    const [, applyResult] = await Promise.all([
      runReversal(actorA, invoiceA.invoiceId, { holdMsAfterReversal: 300 }),
      applyCreditToInvoiceInternal(tenant, mockedUserId, clientId, invoiceB.invoiceId, 6000),
    ]);

    expect(applyResult.appliedAmount).toBe(6000);
    expect(await invoiceCreditApplied(invoiceA.invoiceId)).toBe(0);
    expect(await invoiceCreditApplied(invoiceB.invoiceId)).toBe(6000);

    // Conservation across the pool: 20000 issued, 6000 applied to B, rest in the pool.
    const total = (await remainingAmount(credit1.creditId)) + (await remainingAmount(credit2.creditId));
    expect(total).toBe(14000);
  });

  it('a failed reversal rolls back atomically: lifecycle state and balances unchanged', async () => {
    const clientId = await newTestClient('Atomic Failure Client');
    const credit = await seedCredit(clientId, 10000);
    const { invoiceId, applicationTransactionIds } = await seedFinalizedInvoice({
      clientId,
      total: 8000,
      applications: [[{ credit, amount: 5000 }]],
    });

    // Break the provenance the reversal depends on.
    await db('transactions')
      .where({ transaction_id: applicationTransactionIds[0], tenant })
      .update({ metadata: JSON.stringify({}) });

    // Real action, real transaction, real rollback.
    const result = await unfinalizeInvoice(invoiceId);
    expect(result).toEqual({ actionError: expect.any(String) });

    const invoice = await db('invoices').where({ invoice_id: invoiceId, tenant }).first();
    expect(invoice.status).toBe('sent');
    expect(invoice.finalized_at).not.toBeNull();
    expect(Number(invoice.credit_applied)).toBe(5000);
    expect(await remainingAmount(credit.creditId)).toBe(5000);
    expect(await adjustmentsFor(invoiceId)).toHaveLength(0);
  });
});
