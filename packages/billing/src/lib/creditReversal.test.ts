import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  // Facade passthrough: the fakes below dispatch by table name; tenant
  // scoping is the real facade's concern, not this test's.
  tenantDb: (conn: any, _tenant: string) => ({ table: (name: string) => conn(name) })
}));

import { reverseCreditApplicationsForInvoice } from './creditReversal';

// ── Fake transaction ────────────────────────────────────────────────────────
//
// One builder per trx(tableName) call; chained filters are recorded so the
// dispatch can distinguish e.g. the credit_application read from the
// credit_adjustment read on the same table.

interface FakeTables {
  creditApplications?: any[];
  creditAdjustments?: any[];
  /** credit_id values the FOR UPDATE lock query finds. */
  lockedCreditIds?: string[];
}

function makeTrx(tables: FakeTables) {
  const log: Array<{ table: string; op: string; args: any; filters: any[] }> = [];

  const trx = vi.fn((tableName: string) => {
    const filters: Array<{ method: string; args: any[] }> = [];
    const builder: any = {};
    const chain = (method: string) =>
      vi.fn((...args: any[]) => {
        filters.push({ method, args });
        return builder;
      });
    builder.where = chain('where');
    builder.whereIn = chain('whereIn');
    builder.orderBy = chain('orderBy');
    builder.forUpdate = chain('forUpdate');
    builder.increment = chain('increment');
    builder.select = vi.fn(async (..._args: any[]) => {
      if (tableName === 'transactions') {
        const typeFilter = filters.find(
          (f) => f.method === 'where' && f.args[0]?.type
        )?.args[0]?.type;
        if (typeFilter === 'credit_application') return tables.creditApplications ?? [];
        if (typeFilter === 'credit_adjustment') return tables.creditAdjustments ?? [];
        return [];
      }
      if (tableName === 'credit_tracking') {
        const requested: string[] = filters.find((f) => f.method === 'whereIn')?.args[1] ?? [];
        const available = new Set(tables.lockedCreditIds ?? requested);
        return requested.filter((id) => available.has(id)).map((id) => ({ credit_id: id }));
      }
      return [];
    });
    builder.update = vi.fn(async (args: any) => {
      log.push({ table: tableName, op: 'update', args, filters: [...filters] });
      return 1;
    });
    builder.insert = vi.fn(async (args: any) => {
      log.push({ table: tableName, op: 'insert', args, filters: [...filters] });
    });
    return builder;
  }) as any;
  trx.raw = vi.fn((sql: string) => sql);

  return { trx, log };
}

function application(
  transactionId: string,
  appliedCredits: Array<{ creditId: string; amount: number }> | undefined,
  overrides: Record<string, unknown> = {}
) {
  return {
    transaction_id: transactionId,
    client_id: 'client-1',
    invoice_id: 'inv-1',
    tenant: 'tenant-1',
    metadata: appliedCredits === undefined ? {} : { applied_credits: appliedCredits },
    ...overrides,
  };
}

describe('reverseCreditApplicationsForInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zeroes credit_applied and restores nothing when no applications exist', async () => {
    const { trx, log } = makeTrx({ creditApplications: [] });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided');

    expect(result.totalRestored).toBe(0);
    expect(result.reversedApplications).toEqual([]);
    expect(log.filter((e) => e.table === 'credit_tracking')).toHaveLength(0);
    expect(log.filter((e) => e.table === 'transactions' && e.op === 'insert')).toHaveLength(0);
    // The invariant holds even for a no-op: a reversed invoice carries no credit.
    const invoiceUpdate = log.find((e) => e.table === 'invoices' && e.op === 'update');
    expect(invoiceUpdate?.args.credit_applied).toBe(0);
  });

  it('restores every application (not only the first) and writes one reversal per application', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [
        application('txn-1', [
          { creditId: 'credit-1', amount: 50 },
          { creditId: 'credit-2', amount: 30 },
        ]),
        application('txn-2', [{ creditId: 'credit-2', amount: 20 }]),
      ],
    });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided');

    expect(result.totalRestored).toBe(100);
    expect(result.reversedApplications.map((r) => r.transactionId)).toEqual(['txn-1', 'txn-2']);

    const restores = log.filter((e) => e.table === 'credit_tracking' && e.op === 'update');
    expect(restores).toHaveLength(3);

    const adjustments = log.filter((e) => e.table === 'transactions' && e.op === 'insert');
    expect(adjustments).toHaveLength(2);
    expect(adjustments[0].args.type).toBe('credit_adjustment');
    expect(adjustments[0].args.metadata.reversal_of).toBe('txn-1');
    expect(adjustments[0].args.metadata.reason).toBe('invoice_voided');
    expect(adjustments[0].args.metadata.reversed_by).toBe('user-1');
    expect(adjustments[0].args.amount).toBe(80);
    expect(adjustments[1].args.metadata.reversal_of).toBe('txn-2');
    expect(adjustments[1].args.amount).toBe(20);

    const invoiceUpdate = log.find((e) => e.table === 'invoices' && e.op === 'update');
    expect(invoiceUpdate?.args.credit_applied).toBe(0);
  });

  it('skips applications already reversed by a completed credit_adjustment (repeat-safe)', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [
        application('txn-1', [{ creditId: 'credit-1', amount: 50 }]),
        application('txn-2', [{ creditId: 'credit-1', amount: 25 }]),
      ],
      creditAdjustments: [
        { transaction_id: 'adj-1', metadata: { reversal_of: 'txn-1', reason: 'invoice_unfinalized' } },
      ],
    });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_unfinalized');

    // Only the not-yet-reversed application restores.
    expect(result.totalRestored).toBe(25);
    expect(result.reversedApplications.map((r) => r.transactionId)).toEqual(['txn-2']);
    const adjustments = log.filter((e) => e.table === 'transactions' && e.op === 'insert');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].args.metadata.reversal_of).toBe('txn-2');
  });

  it('is a no-op (besides the credit_applied reset) when every application is already reversed', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [application('txn-1', [{ creditId: 'credit-1', amount: 50 }])],
      creditAdjustments: [{ transaction_id: 'adj-1', metadata: { reversal_of: 'txn-1' } }],
    });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_unfinalized');

    expect(result.totalRestored).toBe(0);
    expect(log.filter((e) => e.table === 'credit_tracking')).toHaveLength(0);
    expect(log.filter((e) => e.table === 'transactions' && e.op === 'insert')).toHaveLength(0);
  });

  it('fails fast on missing applied_credits provenance instead of silently losing credit', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [application('txn-1', undefined)],
    });

    await expect(
      reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided')
    ).rejects.toThrow(/no applied_credits provenance/);
    // Nothing mutated before the failure.
    expect(log).toHaveLength(0);
  });

  it('fails fast on malformed applied_credits entries', async () => {
    const { trx } = makeTrx({
      creditApplications: [application('txn-1', [{ creditId: '', amount: 10 } as any])],
    });

    await expect(
      reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided')
    ).rejects.toThrow(/missing a creditId/);
  });

  it('fails fast when a referenced credit_tracking row no longer exists', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [
        application('txn-1', [
          { creditId: 'credit-1', amount: 50 },
          { creditId: 'credit-gone', amount: 10 },
        ]),
      ],
      lockedCreditIds: ['credit-1'],
    });

    await expect(
      reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_deleted')
    ).rejects.toThrow(/credit_tracking rows missing for credit id\(s\) credit-gone/);
    // Nothing mutated before the failure.
    expect(log).toHaveLength(0);
  });

  it('parses string metadata (driver variance) and still reverses', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [
        application('txn-1', undefined, {
          metadata: JSON.stringify({ applied_credits: [{ creditId: 'credit-1', amount: 40 }] }),
        }),
      ],
    });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided');

    expect(result.totalRestored).toBe(40);
    expect(log.filter((e) => e.table === 'credit_tracking' && e.op === 'update')).toHaveLength(1);
  });

  it('tolerates an empty applied_credits array without writing a reversal row', async () => {
    const { trx, log } = makeTrx({
      creditApplications: [application('txn-1', [])],
    });

    const result = await reverseCreditApplicationsForInvoice(trx, 'tenant-1', 'inv-1', 'user-1', 'invoice_voided');

    expect(result.totalRestored).toBe(0);
    expect(log.filter((e) => e.table === 'transactions' && e.op === 'insert')).toHaveLength(0);
    // credit_applied is still zeroed.
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.credit_applied === 0)).toBe(true);
  });
});
