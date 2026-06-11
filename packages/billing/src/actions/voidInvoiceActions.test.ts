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

import { reverseCreditApplicationsForInvoice } from './voidInvoiceActions';

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
