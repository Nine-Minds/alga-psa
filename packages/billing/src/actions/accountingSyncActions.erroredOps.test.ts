import { describe, expect, it, vi, beforeEach } from 'vitest';

const resolveSyncTargetMock = vi.hoisted(() => vi.fn());
const resolveGuardedMock = vi.hoisted(() => vi.fn());
const tenantDbMock = vi.hoisted(() => vi.fn());
const listErroredMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn());
const getByIdMock = vi.hoisted(() => vi.fn());
const batchSelectMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: (name: string) => builder(currentTables[name] ?? []) })),
  tenantDb: tenantDbMock,
  writeAccountingAudit: vi.fn(async () => undefined)
}));
vi.mock('../services/accountingSync/syncTarget', () => ({
  resolveSyncTarget: resolveSyncTargetMock,
  resolveGuardedSyncTarget: resolveGuardedMock
}));
vi.mock('../services/accountingSync/syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () {
    return { listErrored: listErroredMock, enqueue: enqueueMock, getById: getByIdMock };
  })
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: vi.fn(async () => ({})),
  QboClientService: { create: vi.fn() },
  resolveTenantQboEnvironment: vi.fn()
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({ getStoredXeroConnections: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/integrations/lib/providerDisconnect', () => ({ PROVIDER_XERO: 'xero', PROVIDER_QBO: 'qbo' }));

import { getErroredSyncOperations, getInvoiceSyncOutcome, queueInvoiceSync } from './accountingSyncActions';

const TENANT = 'tenant-1';
const USER = { user_id: 'u1', roles: [] } as any;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function builder(rows: unknown[]): any {
  const b: any = {};
  for (const m of ['where', 'whereIn', 'orderBy', 'join', 'orWhere']) b[m] = () => b;
  b.select = (...cols: string[]) => { batchSelectMock(cols); return b; };
  b.first = async () => rows[0];
  b.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return b;
}

let currentTables: Record<string, unknown[]> = {};
function mockTables(tables: Record<string, unknown[]>) {
  currentTables = tables;
  tenantDbMock.mockImplementation(() => ({
    table: (name: string) => builder(tables[name.split(' ')[0]] ?? []),
    tenantJoin: (b: unknown) => b
  }));
}

const target = { integration: { adapterType: 'quickbooks_online', targetRealm: 'realm-1' }, adapter: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  resolveSyncTargetMock.mockResolvedValue(target);
  resolveGuardedMock.mockResolvedValue({ status: 'ready', target });
  enqueueMock.mockResolvedValue({ op_id: 'op-1' });
});

describe('queueInvoiceSync status guard', () => {
  it.each(['cancelled', 'paid'])('refuses a %s invoice and enqueues nothing', async (status) => {
    mockTables({ invoices: [{ status }] });
    const result = await (queueInvoiceSync as any)(USER, { tenant: TENANT }, 'inv-1');
    expect(result.queued).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.reason).toBe(status);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('queues a sent invoice and returns the op id', async () => {
    mockTables({ invoices: [{ status: 'sent' }] });
    const result = await (queueInvoiceSync as any)(USER, { tenant: TENANT }, 'inv-1');
    expect(result).toEqual({ queued: true, opId: 'op-1' });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing invoice', async () => {
    mockTables({ invoices: [] });
    const result = await (queueInvoiceSync as any)(USER, { tenant: TENANT }, 'inv-x');
    expect(result.queued).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('getErroredSyncOperations', () => {
  const op = (over: Record<string, unknown>) => ({
    op_id: 'aaaaaaaa-0000-0000-0000-000000000001', alga_entity_type: 'invoice',
    alga_entity_id: 'bbbbbbbb-0000-0000-0000-000000000001', operation: 'export_invoice', status: 'failed',
    attempts: 1, last_error: 'boom', created_at: '2026-01-01T00:00:00Z', processed_at: null, ...over
  });

  it('scopes to the resolved adapter and realm and returns names, never UUIDs; deleted entities get null', async () => {
    listErroredMock.mockResolvedValue([
      op({}),
      op({ op_id: 'op2', alga_entity_id: 'gone-id', status: 'skipped' }),
      op({ op_id: 'op3', alga_entity_type: 'vendor_bill', alga_entity_id: 'bill-1', operation: 'export_vendor_bill' }),
      op({ op_id: 'op4', alga_entity_type: 'client', alga_entity_id: 'client-1', operation: 'export_invoice' }),
      op({ op_id: 'op5', alga_entity_type: 'invoice_payment', alga_entity_id: 'pay-1', operation: 'record_payment' }),
      op({ op_id: 'op6', alga_entity_type: 'credit_allocation', alga_entity_id: 'alloc-1', operation: 'apply_credit' }),
      op({ op_id: 'op7', alga_entity_type: 'invoice_payment', alga_entity_id: 'pay-gone', operation: 'record_payment' })
    ]);
    mockTables({
      invoices: [{ invoice_id: 'bbbbbbbb-0000-0000-0000-000000000001', invoice_number: 'INV-26-10-000002', invoice_type: 'standard' }],
      vendor_bills: [{ bill_id: 'bill-1', bill_number: 'BILL-9' }],
      accounting_export_lines: [{ document_id: 'bbbbbbbb-0000-0000-0000-000000000001', export_type: 'invoice', batch_id: 'batch-1', queued_at: '2026-01-02' },
        { document_id: 'bill-1', export_type: 'vendor_bill', batch_id: 'batch-2', queued_at: '2026-01-03' }],
      invoice_payments: [{ payment_id: 'pay-1', invoice_number: 'INV-26-10-000007' }],
      credit_allocations: [{ allocation_id: 'alloc-1', invoice_number: 'INV-26-10-000008' }]
    });
    const rows = await (getErroredSyncOperations as any)(USER, { tenant: TENANT }, { preferredAdapterType: 'quickbooks_online' });

    expect(listErroredMock).toHaveBeenCalledWith(TENANT, 'quickbooks_online', 'realm-1', expect.anything());
    expect(rows.map((r: any) => r.displayName)).toEqual([
      'INV-26-10-000002', null, 'BILL-9', null, 'INV-26-10-000007', 'INV-26-10-000008', null
    ]);
    expect(rows.map((r: any) => r.entityKind)).toEqual([
      'invoice', 'invoice', 'vendor_bill', 'other', 'payment', 'credit_application', 'payment'
    ]);
    expect(batchSelectMock).toHaveBeenCalledWith(['payment.payment_id', 'inv.invoice_number']);
    expect(batchSelectMock).toHaveBeenCalledWith(['allocation.allocation_id', 'inv.invoice_number']);
    expect(batchSelectMock).toHaveBeenCalledWith(expect.arrayContaining(['line.document_id']));
    expect(batchSelectMock.mock.calls.flat(2)).not.toContain('line.invoice_id');
    expect(rows[0].batchId).toBe('batch-1');
    expect(rows[1].batchId).toBeNull();
    expect(rows[2].batchId).toBe('batch-2');
    for (const r of rows) {
      expect(r.displayName ?? '').not.toMatch(UUID_RE);
    }
  });

  it('returns nothing when no target resolves (badge is 0 too)', async () => {
    resolveSyncTargetMock.mockResolvedValue(null);
    expect(await (getErroredSyncOperations as any)(USER, { tenant: TENANT }, {})).toEqual([]);
    expect(listErroredMock).not.toHaveBeenCalled();
  });
});

describe('getInvoiceSyncOutcome', () => {
  const run = (op: Record<string, unknown> | undefined) => {
    getByIdMock.mockResolvedValue(op);
    return (getInvoiceSyncOutcome as any)(USER, { tenant: TENANT }, 'inv-1', 'op-1');
  };
  const base = { alga_entity_type: 'invoice', alga_entity_id: 'inv-1', attempts: 0, last_error: null };

  it('maps op status to outcome', async () => {
    expect(await run({ ...base, status: 'done' })).toEqual({ outcome: 'synced' });
    expect(await run({ ...base, status: 'failed', last_error: 'nope' })).toEqual({ outcome: 'failed', reason: 'nope' });
    expect(await run({ ...base, status: 'skipped', last_error: 'cap' })).toEqual({ outcome: 'skipped', reason: 'cap' });
    expect(await run({ ...base, status: 'pending' })).toEqual({ outcome: 'pending' });
    expect(await run({ ...base, status: 'pending', attempts: 1, last_error: 'retry' })).toEqual({ outcome: 'failed', reason: 'retry' });
    expect(await run({ ...base, status: 'in_progress' })).toEqual({ outcome: 'pending' });
  });

  it('is unknown for a missing or foreign op', async () => {
    expect(await run(undefined)).toEqual({ outcome: 'unknown' });
    expect(await run({ ...base, alga_entity_id: 'other', status: 'done' })).toEqual({ outcome: 'unknown' });
  });
});
