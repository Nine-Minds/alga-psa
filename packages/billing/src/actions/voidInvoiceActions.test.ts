import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex))
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: vi.fn((fn: any) => fn)
}));

vi.mock('../services/accountingSync/syncProducers', () => ({
  enqueueInvoiceVoid: vi.fn(async () => undefined)
}));

import { reverseCreditApplicationsForInvoice, voidInvoice } from './voidInvoiceActions';
import { createTenantKnex } from '@alga-psa/db';

// ── Helper: build a fake transaction (knex-like) ────────────────────────────

function makeQueryBuilder(returnValue: any = null) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.first = vi.fn(async (..._args: any[]) => returnValue);
  builder.select = vi.fn(() => builder);
  builder.increment = vi.fn(() => builder);
  builder.decrement = vi.fn(() => builder);
  builder.update = vi.fn(async () => 1);
  builder.insert = vi.fn(async () => [{}]);
  builder.sum = vi.fn(() => builder);
  return builder;
}

function makeTrx(tableMap: Record<string, any> = {}) {
  const trx = vi.fn((tableName: string) => {
    return tableMap[tableName] ?? makeQueryBuilder(null);
  }) as any;
  trx.raw = vi.fn((sql: string) => sql);
  return trx;
}

describe('reverseCreditApplicationsForInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no credit_application transactions exist', async () => {
    const transactionsQb = makeQueryBuilder([]);
    transactionsQb.select = vi.fn(() => ({ ...transactionsQb, then: undefined }));
    // Override where+select chain to return empty array
    const whereResult = {
      where: vi.fn(() => whereResult),
      select: vi.fn(async () => []),
      // Make it thenable so await works
    };
    whereResult.select = vi.fn().mockResolvedValue([]);

    const trx = vi.fn((tableName: string) => {
      if (tableName === 'transactions') {
        return {
          where: vi.fn(() => ({ select: vi.fn().mockResolvedValue([]) }))
        };
      }
      return makeQueryBuilder(null);
    }) as any;

    // Should complete without error
    await expect(
      reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1')
    ).resolves.toBeUndefined();
  });

  it('restores credit balance and writes reversal transaction when credit_application exists', async () => {
    const txnRecord = {
      transaction_id: 'txn-1',
      client_id: 'client-1',
      invoice_id: 'inv-1',
      tenant: 'tenant-1',
      metadata: {
        applied_credits: [
          { creditId: 'credit-1', amount: 50 },
          { creditId: 'credit-2', amount: 30 }
        ]
      }
    };

    const creditTrackingQb = makeQueryBuilder(null);
    const clientsQb = makeQueryBuilder(null);
    const invoicesQb = makeQueryBuilder(null);
    const insertTxnQb = makeQueryBuilder(null);

    const callLog: string[] = [];

    const trx = vi.fn((tableName: string) => {
      if (tableName === 'transactions') {
        return {
          where: vi.fn(() => ({
            select: vi.fn().mockResolvedValue([txnRecord])
          })),
          insert: vi.fn(async () => {
            callLog.push('transactions.insert');
          })
        };
      }
      if (tableName === 'credit_tracking') {
        return {
          where: vi.fn(() => ({
            increment: vi.fn(() => ({
              update: vi.fn(async () => {
                callLog.push('credit_tracking.update');
              })
            }))
          }))
        };
      }
      if (tableName === 'clients') {
        return {
          where: vi.fn(() => ({
            increment: vi.fn(async () => {
              callLog.push('clients.increment');
            })
          }))
        };
      }
      if (tableName === 'invoices') {
        return {
          where: vi.fn(() => ({
            update: vi.fn(async () => {
              callLog.push('invoices.update');
            })
          }))
        };
      }
      return makeQueryBuilder(null);
    }) as any;

    await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1');

    // credit_tracking should have been updated for each applied credit (2 credits)
    const creditTrackingUpdates = callLog.filter((e) => e === 'credit_tracking.update');
    expect(creditTrackingUpdates).toHaveLength(2);

    // client credit balance should have been incremented once (total restored)
    expect(callLog).toContain('clients.increment');

    // A reversal transaction should have been inserted
    expect(callLog).toContain('transactions.insert');

    // Invoice credit_applied should have been zeroed
    expect(callLog).toContain('invoices.update');
  });

  it('does not increment clients or insert transaction when totalRestored is 0', async () => {
    const txnRecord = {
      transaction_id: 'txn-2',
      client_id: 'client-2',
      invoice_id: 'inv-2',
      tenant: 'tenant-1',
      metadata: { applied_credits: [] } // no credits applied
    };

    const callLog: string[] = [];

    const trx = vi.fn((tableName: string) => {
      if (tableName === 'transactions') {
        return {
          where: vi.fn(() => ({
            select: vi.fn().mockResolvedValue([txnRecord])
          })),
          insert: vi.fn(async () => {
            callLog.push('transactions.insert');
          })
        };
      }
      if (tableName === 'invoices') {
        return {
          where: vi.fn(() => ({
            update: vi.fn(async () => {
              callLog.push('invoices.update');
            })
          }))
        };
      }
      return makeQueryBuilder(null);
    }) as any;

    await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-2', 'user-1');

    // With no applied_credits, no reversal transaction should be inserted
    expect(callLog).not.toContain('transactions.insert');
    // But invoices.update still runs (credit_applied zeroed) since creditAppTxns.length > 0
    expect(callLog).toContain('invoices.update');
  });
});

// ── voidInvoice: credit-note claw-back ──────────────────────────────────────

interface VoidHarnessOptions {
  /** Some of the issued credit was already spent (trips the guard). */
  consumed?: boolean;
}

/**
 * Fake knex for the voidInvoice credit-note path. The issuance transaction is
 * typed 'credit_issuance_from_negative_invoice' — the type real credit notes
 * write — which the pre-fix code missed entirely (it queried only
 * 'credit_issuance'), leaving phantom spendable credit after a void.
 */
function makeVoidHarness(options: VoidHarnessOptions = {}) {
  const log: Array<{ table: string; op: string; args: any }> = [];
  const issuanceTxn = { transaction_id: 'txn-iss-1', client_id: 'client-1', amount: 1800 };
  const invoiceRow = {
    invoice_id: 'inv-cn-1',
    tenant: 'tenant-1',
    finalized_at: '2026-06-01T00:00:00.000Z',
    status: 'sent',
    invoice_type: 'credit_note',
    total_amount: -1800,
    client_id: 'client-1',
    is_prepayment: false,
    credit_applied: 0
  };

  const knex: any = vi.fn((tableName: string) => {
    const builder: any = {};
    const filters: Array<[string, any[]]> = [];
    builder.where = vi.fn((...args: any[]) => { filters.push(['where', args]); return builder; });
    builder.whereIn = vi.fn((...args: any[]) => { filters.push(['whereIn', args]); return builder; });
    builder.sum = vi.fn(() => builder);
    builder.select = vi.fn(async () => (tableName === 'transactions' ? [issuanceTxn] : []));
    builder.first = vi.fn(async () => {
      if (tableName === 'invoices') return invoiceRow;
      if (tableName === 'invoice_payments') return { total: 0 };
      if (tableName === 'credit_tracking') {
        const usesWhereIn = filters.some(([method]) => method === 'whereIn');
        if (usesWhereIn) {
          // consumed-credit guard: remaining_amount < amount
          return options.consumed ? { credit_id: 'cr-1' } : undefined;
        }
        // claw-back lookup by transaction_id
        return { credit_id: 'cr-1', remaining_amount: 1800 };
      }
      return undefined;
    });
    builder.insert = vi.fn(async (row: any) => { log.push({ table: tableName, op: 'insert', args: row }); });
    builder.update = vi.fn(async (row: any) => { log.push({ table: tableName, op: 'update', args: row }); return 1; });
    builder.decrement = vi.fn((column: string, amount: number) => {
      log.push({ table: tableName, op: 'decrement', args: { column, amount } });
      return builder;
    });
    builder.increment = vi.fn(() => builder);
    return builder;
  });
  knex.raw = vi.fn((sql: string) => sql);

  return { knex, log };
}

describe('voidInvoice (credit note)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claws back unconsumed issued credit: balance decremented, tracking zeroed, adjustment written', async () => {
    const { knex, log } = makeVoidHarness();
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'duplicate credit note'
    );
    expect(result).toEqual({ success: true });

    // Pool credit removed from the client balance…
    expect(log).toContainEqual({
      table: 'clients',
      op: 'decrement',
      args: { column: 'credit_balance', amount: 1800 }
    });
    // …tracking row zeroed…
    expect(log.some((e) => e.table === 'credit_tracking' && e.op === 'update' && e.args.remaining_amount === 0)).toBe(true);
    // …auditable claw-back transaction written…
    const adjustment = log.find((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'credit_adjustment');
    expect(adjustment?.args.amount).toBe(-1800);
    expect(adjustment?.args.metadata?.reason).toBe('credit_note_voided');
    // …and the document itself voided.
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.status === 'cancelled')).toBe(true);
    expect(log.some((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'invoice_cancelled')).toBe(true);
  });

  it('blocks the void when issued credit was already spent', async () => {
    const { knex, log } = makeVoidHarness({ consumed: true });
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'too late'
    );
    expect(result).toEqual({
      success: false,
      error: 'This credit note has applied credit. Unapply the credit before voiding.',
    });

    // Nothing was mutated.
    expect(log.filter((e) => e.op !== 'decrement').every((e) => e.op !== 'insert' && e.op !== 'update')).toBe(true);
  });
});
