/**
 * "Void in AlgaPSA only" (alga-2026-0003364).
 *
 * The onboarding wizard linked a test invoice to a REAL QuickBooks invoice
 * that happened to carry the same number. A normal void would have queued a
 * void of that real document; the customer's only escape was to void it by
 * hand in QuickBooks. This action unlinks instead — and these tests pin the
 * part that makes it safe: enqueueInvoiceVoid is never called, the mappings
 * are tombstoned rather than deleted, queued pushes are retired, and the
 * audit record says the remote document was left untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

function rows(table: string): Row[] {
  store.tables[table] = store.tables[table] ?? [];
  return store.tables[table];
}

/** `metadata->'allocations' @> '[{"invoiceId":...}]'` against an in-memory row. */
function containsAllocation(row: Row, bindings: any[]): boolean {
  let probes: any[];
  try {
    probes = JSON.parse(String(bindings?.[0] ?? '[]'));
  } catch {
    return false;
  }
  const allocations = row.metadata?.allocations;
  if (!Array.isArray(allocations)) return false;
  return probes.every((probe: Row) =>
    allocations.some((allocation: Row) =>
      Object.entries(probe).every(([key, value]) => allocation?.[key] === value)));
}

function makeBuilder(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  let aggregate: { column: string; alias: string } | null = null;
  let pending: (() => any) | null = null;

  const matched = () => rows(table).filter((row) => predicates.every((p) => p(row)));
  const add = (predicate: (row: Row) => boolean) => {
    predicates.push(predicate);
    return builder;
  };

  const execute = () => {
    if (pending) return pending();
    if (aggregate) {
      const total = matched().reduce((sum, row) => sum + Number(row[aggregate!.column] ?? 0), 0);
      return [{ [aggregate.alias]: String(total) }];
    }
    return matched();
  };

  const builder: any = {
    where(a: any, b?: any) {
      if (typeof a === 'function') {
        const group: Array<(row: Row) => boolean> = [];
        const nested: any = new Proxy(builder, {
          get: (target, prop) =>
            prop === 'whereIn'
              ? (column: string, values: any[]) => { group.push((row) => values.includes(row[column])); return nested; }
              : prop === 'orWhereRaw'
                ? (_sql: string, bindings: any[]) => { group.push((row) => containsAllocation(row, bindings)); return nested; }
                : (target as any)[prop],
        });
        a(nested);
        return add((row) => group.some((p) => p(row)));
      }
      if (typeof a === 'object' && a !== null) {
        return add((row) => Object.entries(a).every(([key, value]) => row[key] === value));
      }
      return add((row) => row[a] === b);
    },
    whereIn: (column: string, values: any[]) => add((row) => values.includes(row[column])),
    whereNull: (column: string) => add((row) => row[column] === null || row[column] === undefined),
    whereNotNull: (column: string) => add((row) => row[column] !== null && row[column] !== undefined),
    whereRaw: (_sql: string, bindings: any[]) => add((row) => containsAllocation(row, bindings)),
    select: () => builder,
    orderBy: () => builder,
    forUpdate: () => builder,
    sum(expression: string) {
      const [column, alias] = expression.split(' as ');
      aggregate = { column: column.trim(), alias: (alias ?? column).trim() };
      return builder;
    },
    insert(payload: Row | Row[]) {
      const inserted = Array.isArray(payload) ? payload : [payload];
      rows(table).push(...inserted);
      pending = () => inserted;
      return builder;
    },
    update(patch: Row) {
      const targets = matched();
      for (const row of targets) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          row[key] = value;
        }
      }
      pending = () => targets.length;
      return builder;
    },
    async first() {
      const result = await execute();
      return Array.isArray(result) ? result[0] : result;
    },
    then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(execute()).then(resolve, reject);
    },
  };

  return builder;
}

const knexStub = vi.hoisted(() => ({ fn: { now: () => 'now()' } }));
const hasPermission = vi.hoisted(() => vi.fn(async () => true));
const actor = vi.hoisted(() => ({ user: { user_id: 'user-1', user_type: 'internal' } as any }));
const writeAccountingAudit = vi.hoisted(() => vi.fn(async () => undefined));
const enqueueInvoiceVoid = vi.hoisted(() => vi.fn(async () => undefined));
const notifyInvoiceTerminalStatus = vi.hoisted(() => vi.fn(async () => undefined));
const signalAutopayInvoiceSettled = vi.hoisted(() => vi.fn(async () => undefined));
const findInvoiceExportInProgress = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(actor.user, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexStub, tenant: 'tenant-1' }),
  tenantDb: () => ({ table: (name: string) => makeBuilder(name) }),
  withTransaction: async (_knex: unknown, fn: (trx: any) => Promise<unknown>) => fn(knexStub),
  writeAccountingAudit,
}));
vi.mock('../../src/services/accountingSync/syncProducers', () => ({ enqueueInvoiceVoid }));
vi.mock('../../src/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  notifyInvoiceTerminalStatus,
}));
vi.mock('../../src/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => true),
}));
vi.mock('../../src/services/accountingSync/invoiceExportGuards', () => ({ findInvoiceExportInProgress }));
vi.mock('../../src/services/autopayBridge', () => ({ signalAutopayInvoiceSettled }));
// Out of scope for an unpaid standard invoice; the void body's own collaborators.
vi.mock('../../src/services/prepaidBlockLifecycleService', () => ({
  voidHourBlocksForVoidedInvoice: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../src/lib/prepaidAutoReplenishment', () => ({
  suppressPrepaidReplenishmentForVoidedInvoice: vi.fn(async () => undefined),
}));
vi.mock('../../src/lib/creditReversal', () => ({
  reverseCreditApplicationsForInvoice: vi.fn(async () => undefined),
}));

import { voidInvoiceInAlgaOnly } from '../../src/actions/voidInvoiceActions';

const INVOICE = 'inv-3256';
const PAYMENT = 'pay-1';
const invoice = () => store.tables.invoices[0];
const mappings = () => store.tables.tenant_external_entity_mappings ?? [];
const operations = () => store.tables.accounting_sync_operations ?? [];
const transactions = () => store.tables.transactions ?? [];

function seed(options: { invoice?: Row; payments?: Row[] } = {}) {
  store.tables = {
    invoices: [{
      invoice_id: INVOICE,
      tenant: 'tenant-1',
      invoice_number: 'INV-003256',
      client_id: 'client-1',
      status: 'sent',
      invoice_type: 'standard',
      total_amount: 10000,
      credit_applied: 0,
      is_prepayment: false,
      finalized_at: '2026-11-01T00:00:00.000Z',
      ...options.invoice,
    }],
    invoice_payments: options.payments ?? [],
    transactions: [],
    credit_tracking: [],
    tenant_external_entity_mappings: [
      {
        id: 'map-inv-1',
        tenant: 'tenant-1',
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: INVOICE,
        external_entity_id: '1138',
        external_realm_id: 'realm-1',
        sync_status: 'synced',
        metadata: {},
        deleted_at: null,
      },
      {
        id: 'map-pay-1',
        tenant: 'tenant-1',
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice_payment',
        alga_entity_id: PAYMENT,
        external_entity_id: '3547',
        external_realm_id: 'realm-1',
        sync_status: 'synced',
        metadata: { allocations: [{ invoiceId: INVOICE, algaPaymentId: PAYMENT }] },
        deleted_at: null,
      },
    ],
    accounting_sync_operations: [
      {
        id: 'op-export',
        tenant: 'tenant-1',
        operation: 'export_invoice',
        alga_entity_type: 'invoice',
        alga_entity_id: INVOICE,
        status: 'pending',
        last_error: null,
      },
      {
        id: 'op-payment',
        tenant: 'tenant-1',
        operation: 'record_payment',
        alga_entity_type: 'invoice_payment',
        alga_entity_id: PAYMENT,
        status: 'pending',
        last_error: null,
      },
      {
        id: 'op-done',
        tenant: 'tenant-1',
        operation: 'export_invoice',
        alga_entity_type: 'invoice',
        alga_entity_id: INVOICE,
        status: 'done',
        last_error: null,
      },
    ],
  };
}

const opById = (id: string) => operations().find((row) => row.id === id);
const mappingById = (id: string) => mappings().find((row) => row.id === id);

describe('voidInvoiceInAlgaOnly', () => {
  beforeEach(() => {
    seed();
    hasPermission.mockClear();
    hasPermission.mockResolvedValue(true);
    enqueueInvoiceVoid.mockClear();
    notifyInvoiceTerminalStatus.mockClear();
    signalAutopayInvoiceSettled.mockClear();
    writeAccountingAudit.mockClear();
    findInvoiceExportInProgress.mockClear();
    findInvoiceExportInProgress.mockResolvedValue(false);
    actor.user = { user_id: 'user-1', user_type: 'internal' };
  });

  it('voids locally, unlinks, and never asks QuickBooks for anything', async () => {
    const result = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice linked by the wizard');

    expect(result).toEqual({ success: true });
    expect(invoice().status).toBe('cancelled');

    // The whole point: the real QuickBooks document is left alone.
    expect(enqueueInvoiceVoid).not.toHaveBeenCalled();

    // Unlinked, not deleted — the rows stay as evidence of what was linked.
    expect(mappingById('map-inv-1')).toMatchObject({ sync_status: 'unlinked' });
    expect(mappingById('map-inv-1')!.deleted_at).toBeTruthy();
    expect(mappingById('map-inv-1')!.metadata).toMatchObject({
      locally_voided: true,
      locally_voided_by: 'user-1',
      locally_voided_reason: 'Test invoice linked by the wizard',
    });
    // The payment mapping only names this invoice through its allocations.
    expect(mappingById('map-pay-1')!.deleted_at).toBeTruthy();
    expect(mappingById('map-pay-1')!.metadata).toMatchObject({ locally_reversed: true });

    // Queued pushes are retired; terminal work is left as it is.
    expect(opById('op-export')).toMatchObject({ status: 'skipped' });
    expect(opById('op-export')!.last_error).toContain('Test invoice linked by the wizard');
    expect(opById('op-payment')).toMatchObject({ status: 'skipped' });
    expect(opById('op-done')).toMatchObject({ status: 'done' });

    // The canonical local void really ran.
    const cancelled = transactions().find((row) => row.type === 'invoice_cancelled');
    expect(cancelled).toMatchObject({ invoice_id: INVOICE, amount: -10000 });
    expect(cancelled!.metadata).toMatchObject({
      source: 'alga_only_void',
      remote_record_untouched: true,
      unlinked_external_ids: ['1138'],
    });

    // The audit entry exists to record what was NOT done remotely.
    expect(writeAccountingAudit).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'accounting_alga_only_void',
      expect.objectContaining({
        userId: 'user-1',
        recordId: '1138',
        details: expect.objectContaining({
          operation: 'void_invoice_alga_only',
          outcome: 'unlinked',
          remoteRecordUntouched: true,
        }),
      }),
    );

    // Terminal-status side channels still run, as the normal void does.
    expect(signalAutopayInvoiceSettled).toHaveBeenCalledWith('tenant-1', INVOICE);
    expect(notifyInvoiceTerminalStatus).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: INVOICE, newStatus: 'cancelled' }),
    );
  });

  it('refuses an actor without the accounting remote-mutate capability', async () => {
    hasPermission.mockImplementation(async (_user: any, resource: string) => resource === 'invoice');

    const result: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');

    expect(result.success).toBe(false);
    expect(result.error).toContain('remote-mutate permission');
    expect(invoice().status).toBe('sent');
    expect(mappingById('map-inv-1')!.deleted_at).toBeNull();
    expect(opById('op-export')).toMatchObject({ status: 'pending' });
  });

  it('refuses an actor without invoice:void', async () => {
    hasPermission.mockImplementation(async (_user: any, resource: string) => resource !== 'invoice');

    const result: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');

    expect(result.success).toBe(false);
    expect(result.error).toContain('invoice void required');
    expect(invoice().status).toBe('sent');
  });

  it('refuses a client-portal caller', async () => {
    actor.user = { user_id: 'portal-1', user_type: 'client' };

    const result: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');

    expect(result.success).toBe(false);
    expect(invoice().status).toBe('sent');
  });

  it('requires a reason', async () => {
    const result: any = await voidInvoiceInAlgaOnly(INVOICE, '   ');

    expect(result.success).toBe(false);
    expect(result.error).toContain('reason is required');
    expect(invoice().status).toBe('sent');
  });

  // Unlinking must never be the back door around the payment guard: the money
  // has to be reversed first, and the refusal names where it came from.
  it('still refuses while a QuickBooks payment stands, naming it', async () => {
    seed({
      payments: [{
        payment_id: PAYMENT,
        invoice_id: INVOICE,
        amount: 10000,
        payment_method: 'quickbooks',
        reference_number: 'REF-9',
        status: 'completed',
      }],
    });

    const result: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');

    expect(result.success).toBe(false);
    expect(result.messageKey).toBe('msp/invoicing:errors.void.paymentsRecordedIntegration');
    expect(result.error).toContain('QuickBooks payment 3547');
    expect(invoice().status).toBe('sent');
    expect(mappingById('map-inv-1')!.deleted_at).toBeNull();
  });

  it('refuses a draft and an already-voided invoice', async () => {
    seed({ invoice: { status: 'draft', finalized_at: null } });
    const draft: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');
    expect(draft.error).toContain('Drafts must be deleted');

    seed({ invoice: { status: 'cancelled' } });
    const voided: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');
    expect(voided.error).toContain('already voided');
    expect(enqueueInvoiceVoid).not.toHaveBeenCalled();
  });

  it('waits for an accounting export that is already being prepared', async () => {
    findInvoiceExportInProgress.mockResolvedValue(true);

    const result: any = await voidInvoiceInAlgaOnly(INVOICE, 'Test invoice');

    expect(result.success).toBe(false);
    expect(result.error).toContain('accounting export is being prepared');
    expect(invoice().status).toBe('sent');
    expect(mappingById('map-inv-1')!.deleted_at).toBeNull();
  });
});
