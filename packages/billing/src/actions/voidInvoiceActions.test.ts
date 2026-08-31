import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex)),
  // Facade passthrough: the fakes below dispatch by table name; tenant
  // scoping is the real facade's concern, not this test's.
  tenantDb: (conn: any, _tenant: string) => ({ table: (name: string) => conn(name) })
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: vi.fn((fn: any) => fn)
}));

// The action imports hasPermission from the /rbac subpath — a distinct module
// id from '@alga-psa/auth', so it needs its own mock.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('../services/accountingSync/syncProducers', () => ({
  enqueueInvoiceVoid: vi.fn(async () => undefined)
}));

vi.mock('../services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
  registerInvoiceTerminalStatusHandler: vi.fn(),
  listActiveInvoicePaymentLinks: vi.fn(),
  listPendingInvoicePaymentLinks: vi.fn(),
}));

// The void denial predicate consults the tenant's connection state (never the
// per-invoice mapping); default to unconnected so the local-void behavior is
// exercised, and flip to connected in the denial tests.
vi.mock('../services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => false),
}));

import { voidInvoice } from './voidInvoiceActions';
import { createTenantKnex } from '@alga-psa/db';
import { notifyInvoiceTerminalStatus } from '../services/accountingSync/invoiceTerminalStatusHandlers';
import { hasPermission } from '@alga-psa/auth/rbac';
import { hasConnectedQboRealm } from '../services/accountingSync/accountingSyncSettings';

// ── voidInvoice harness ─────────────────────────────────────────────────────

interface VoidHarnessOptions {
  /** Some of the issued credit was already spent (trips the guard). */
  consumed?: boolean;
  /**
   * The unlocked pre-transaction guard sees the credit untouched, but the
   * FOR UPDATE re-check inside the transaction sees it consumed — the TOCTOU
   * window where a concurrent application commits between the two reads.
   */
  consumedUnderLockOnly?: boolean;
  /** Standard-invoice mode: positive invoice with these applied credits. */
  standardInvoice?: {
    creditApplied: number;
    applications: Array<{
      transactionId: string;
      appliedCredits: Array<{ creditId: string; amount: number }>;
    }>;
    /** Pre-existing completed credit_adjustment reversal links. */
    reversedTransactionIds?: string[];
  };
}

/**
 * Fake knex for voidInvoice. Credit-note mode: the issuance transaction is
 * typed 'credit_issuance_from_negative_invoice' — the type real credit notes
 * write — which the pre-fix code missed entirely (it queried only
 * 'credit_issuance'), leaving phantom spendable credit after a void.
 * Standard mode: drives the shared reversal primitive end to end against the
 * fake tables (voidInvoice → reverseCreditApplicationsForInvoice).
 */
function makeVoidHarness(options: VoidHarnessOptions = {}) {
  const log: Array<{ table: string; op: string; args: any }> = [];
  const issuanceTxn = { transaction_id: 'txn-iss-1', client_id: 'client-1', amount: 1800 };
  const standard = options.standardInvoice;
  const invoiceRow = standard
    ? {
        invoice_id: 'inv-std-1',
        tenant: 'tenant-1',
        finalized_at: '2026-06-01T00:00:00.000Z',
        status: 'sent',
        invoice_type: 'standard',
        total_amount: 5000,
        client_id: 'client-1',
        is_prepayment: false,
        credit_applied: standard.creditApplied
      }
    : {
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
    const record = (method: string) => vi.fn((...args: any[]) => {
      filters.push([method, args]);
      return builder;
    });
    builder.where = record('where');
    builder.whereIn = record('whereIn');
    builder.orderBy = record('orderBy');
    builder.forUpdate = record('forUpdate');
    builder.sum = record('sum');
    builder.increment = record('increment');
    builder.select = vi.fn(async () => {
      if (tableName === 'transactions') {
        if (standard) {
          const typeFilter = filters
            .filter(([method]) => method === 'where')
            .map(([, args]) => args[0]?.type)
            .find(Boolean);
          if (typeFilter === 'credit_application') {
            return standard.applications.map((app) => ({
              transaction_id: app.transactionId,
              client_id: 'client-1',
              invoice_id: invoiceRow.invoice_id,
              tenant: 'tenant-1',
              metadata: { applied_credits: app.appliedCredits }
            }));
          }
          if (typeFilter === 'credit_adjustment') {
            return (standard.reversedTransactionIds ?? []).map((id, index) => ({
              transaction_id: `adj-${index}`,
              metadata: { reversal_of: id }
            }));
          }
          return [];
        }
        return [issuanceTxn];
      }
      if (tableName === 'credit_tracking') {
        if (standard) {
          // The primitive's FOR UPDATE lock read: echo back the requested ids.
          const requested: string[] = filters.find(([method]) => method === 'whereIn')?.[1]?.[1] ?? [];
          return requested.map((id) => ({ credit_id: id }));
        }
        // In-transaction consumed re-check (post-FOR UPDATE): the note's
        // credit rows as the locks reveal them.
        return options.consumedUnderLockOnly
          ? [{ amount: 1800, remaining_amount: 900 }]
          : [{ amount: 1800, remaining_amount: 1800 }];
      }
      return [];
    });
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
    return builder;
  });
  knex.raw = vi.fn((sql: string) => sql);

  return { knex, log };
}

describe('voidInvoice (credit note)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the module defaults explicitly: vi.clearAllMocks() keeps any
    // implementation a previous test set, and the permission-predicate block
    // below overrides both mocks.
    vi.mocked(hasPermission).mockImplementation(async () => true);
    vi.mocked(hasConnectedQboRealm).mockResolvedValue(false);
  });

  it('claws back unconsumed issued credit: tracking zeroed, adjustment written', async () => {
    const { knex, log } = makeVoidHarness();
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'duplicate credit note'
    );
    expect(result).toEqual({ success: true });

    // Balance derives from the ledger — the claw-back is expressed purely as
    // tracking + transaction writes, never a clients write…
    expect(log.some((e) => e.table === 'clients')).toBe(false);
    // …tracking row zeroed…
    expect(log.some((e) => e.table === 'credit_tracking' && e.op === 'update' && e.args.remaining_amount === 0)).toBe(true);
    // …auditable claw-back transaction written…
    const adjustment = log.find((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'credit_adjustment');
    expect(adjustment?.args.amount).toBe(-1800);
    expect(adjustment?.args.metadata?.reason).toBe('credit_note_voided');
    // …and the document itself voided.
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.status === 'cancelled')).toBe(true);
    expect(log.some((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'invoice_cancelled')).toBe(true);

    // Voiding reconciles still-active Checkout sessions via the terminal-status
    // registry (best-effort; isolated in production).
    expect(notifyInvoiceTerminalStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-cn-1',
        newStatus: 'cancelled',
      })
    );
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

  it('blocks the void when consumption is visible only under the in-transaction locks', async () => {
    // The unlocked fast-fail passes; the authoritative FOR UPDATE re-check
    // inside the transaction must still catch the concurrently-spent credit
    // and refuse — without it the claw-back zeroes out credit a concurrent
    // application just applied.
    const { knex, log } = makeVoidHarness({ consumedUnderLockOnly: true });
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'raced with an application'
    );
    expect(result).toEqual({
      success: false,
      error: 'This credit note has applied credit. Unapply the credit before voiding.',
    });

    // Nothing was mutated.
    expect(log.every((e) => e.op !== 'insert' && e.op !== 'update')).toBe(true);
  });
});

describe('voidInvoice (standard invoice)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockImplementation(async () => true);
    vi.mocked(hasConnectedQboRealm).mockResolvedValue(false);
  });

  it('reverses every credit application through the shared primitive before cancelling', async () => {
    const { knex, log } = makeVoidHarness({
      standardInvoice: {
        creditApplied: 80,
        applications: [
          { transactionId: 'txn-app-1', appliedCredits: [{ creditId: 'credit-1', amount: 50 }] },
          { transactionId: 'txn-app-2', appliedCredits: [{ creditId: 'credit-2', amount: 30 }] },
        ],
      },
    });
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-std-1',
      'billing error'
    );
    expect(result).toEqual({ success: true });

    // Both applications restored…
    expect(log.filter((e) => e.table === 'credit_tracking' && e.op === 'update')).toHaveLength(2);
    // …with one linked reversal record each…
    const adjustments = log.filter((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'credit_adjustment');
    expect(adjustments.map((e) => e.args.metadata.reversal_of).sort()).toEqual(['txn-app-1', 'txn-app-2']);
    expect(adjustments.every((e) => e.args.metadata.reason === 'invoice_voided')).toBe(true);
    // …credit_applied zeroed, then the document cancelled.
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.credit_applied === 0)).toBe(true);
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.status === 'cancelled')).toBe(true);
  });

  it('does not restore applications already reversed (repeat-safe)', async () => {
    const { knex, log } = makeVoidHarness({
      standardInvoice: {
        creditApplied: 0,
        applications: [
          { transactionId: 'txn-app-1', appliedCredits: [{ creditId: 'credit-1', amount: 50 }] },
        ],
        reversedTransactionIds: ['txn-app-1'],
      },
    });
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-std-1',
      'second void attempt'
    );
    expect(result).toEqual({ success: true });

    // No restore, no new adjustment — only the cancel writes.
    expect(log.filter((e) => e.table === 'credit_tracking')).toHaveLength(0);
    expect(log.filter((e) => e.table === 'transactions' && e.op === 'insert' && e.args.type === 'credit_adjustment')).toHaveLength(0);
  });
});

describe('voidInvoice (remote-affecting permission predicate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Unconnected tenant by default; the denial test flips it to connected.
    vi.mocked(hasConnectedQboRealm).mockResolvedValue(false);
    // The fast-fail calls hasPermission(user, 'accounting_integrations',
    // 'remote_mutate', knex); everything else stays granted.
    vi.mocked(hasPermission).mockImplementation(async (_user, resource, action) =>
      resource === 'accounting_integrations' && action === 'remote_mutate' ? false : true
    );
  });

  const remoteMutateDenial =
    'Permission denied: voiding invoices while the accounting integration is connected requires the accounting remote-mutate permission.';

  it('refuses an actor without remote_mutate on a connected tenant — identically whether or not the invoice is mapped', async () => {
    // Connected tenant: the denial must fire for this unmapped invoice exactly
    // as it would for a mapped one (the predicate reads connection state, never
    // the per-invoice mapping row), so the denial event leaks nothing.
    vi.mocked(hasConnectedQboRealm).mockResolvedValue(true);

    const { knex, log } = makeVoidHarness();
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'connected denial'
    );
    expect(result).toEqual({ success: false, error: remoteMutateDenial });

    // Refused before any state change — the denial fires at the fast-fail, so
    // no table write is ever recorded.
    expect(log).toHaveLength(0);
    expect(vi.mocked(hasPermission)).toHaveBeenCalledWith(
      { user_id: 'user-1' },
      'accounting_integrations',
      'remote_mutate',
      knex
    );
  });

  it('lets an actor without remote_mutate void when the tenant is unconnected', async () => {
    // Default mock state: unconnected tenant + no remote_mutate. invoice:update
    // alone must suffice — this is the "most tenants" case that must not break.
    const { knex, log } = makeVoidHarness();
    vi.mocked(createTenantKnex).mockResolvedValue({ knex, tenant: 'tenant-1' } as any);

    const result = await (voidInvoice as any)(
      { user_id: 'user-1' },
      { tenant: 'tenant-1' },
      'inv-cn-1',
      'local void'
    );
    expect(result).toEqual({ success: true });
    expect(log.some((e) => e.table === 'invoices' && e.op === 'update' && e.args.status === 'cancelled')).toBe(true);
  });
});
