import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: createTenantKnexMock,
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex))
}));

vi.mock('../services/accountingSync/syncProducers', () => ({
  enqueueVendorBillExportRetry: vi.fn(async () => true)
}));

vi.mock('../services/accountingSync/connectedAccountingIntegration', () => ({
  resolveConnectedAccountingIntegration: vi.fn(async () => ({
    adapterType: 'quickbooks_online',
    targetRealm: 'realm-1'
  }))
}));

import {
  getVendorBillExportStatusesForTenant,
  getVendorBillExportContext,
  retryVendorBillExport,
  exportVendorBillToAccounting
} from './vendorBillExportActions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { enqueueVendorBillExportRetry } from '../services/accountingSync/syncProducers';
import { resolveConnectedAccountingIntegration } from '../services/accountingSync/connectedAccountingIntegration';

const TENANT = 'tenant-1';
const USER = { user_id: 'user-1' };

type ExportRow = {
  bill_id: string;
  line_status: string | null;
  batch_status: string | null;
  external_document_ref?: string | null;
  line_notes?: string | null;
  batch_notes?: string | null;
  delivered_at?: string | null;
  line_created_at?: string | null;
  line_updated_at?: string | null;
  batch_updated_at?: string | null;
};

type OpRow = {
  bill_id: string;
  status: 'pending' | 'in_progress' | 'failed' | 'skipped';
  last_error?: string | null;
  created_at?: string | null;
  processed_at?: string | null;
};

interface FakeTables {
  exportRows?: ExportRow[];
  mappingRows?: Array<{ bill_id: string; external_ref: string | null; last_synced_at: string | null }>;
  operationRows?: OpRow[];
  /** Row returned for the retry action's vendor_bills existence check; null = missing. */
  vendorBillRow?: { bill_id: string } | null;
}

/**
 * Fake knex/trx covering the three status queries (export lines+batches,
 * external mappings, sync operations) and the retry action's bill lookup.
 * operationRows is read live so a test can mutate it when enqueue fires.
 */
function makeTrx(tables: FakeTables) {
  const trx: any = vi.fn((tableName: string) => {
    const builder: any = {};
    builder.join = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.whereIn = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.select = vi.fn(async () => {
      if (tableName.startsWith('accounting_export_lines')) return tables.exportRows ?? [];
      if (tableName === 'tenant_external_entity_mappings') return tables.mappingRows ?? [];
      if (tableName === 'accounting_sync_operations') return tables.operationRows ?? [];
      return [];
    });
    builder.first = vi.fn(async () => {
      if (tableName === 'vendor_bills') {
        return tables.vendorBillRow === undefined ? { bill_id: 'bill-1' } : tables.vendorBillRow;
      }
      return undefined;
    });
    return builder;
  });
  return trx;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasPermission).mockResolvedValue(true);
  vi.mocked(enqueueVendorBillExportRetry).mockResolvedValue(true);
  vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue({
    adapterType: 'quickbooks_online',
    targetRealm: 'realm-1'
  } as any);
});

// ── Status derivation (badge states) ─────────────────────────────────────────

describe('getVendorBillExportStatusesForTenant', () => {
  it('no export activity → not_exported', async () => {
    const trx = makeTrx({});

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status).toEqual({
      bill_id: 'bill-1',
      state: 'not_exported',
      exported_at: null,
      external_ref: null,
      error_message: null
    });
  });

  it('pending export_vendor_bill op → pending (the badge right after draft→open)', async () => {
    const trx = makeTrx({
      operationRows: [{ bill_id: 'bill-1', status: 'pending' }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('pending');
    expect(status.error_message).toBeNull();
  });

  it('in_progress op → pending', async () => {
    const trx = makeTrx({
      operationRows: [{ bill_id: 'bill-1', status: 'in_progress' }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('pending');
  });

  it('failed op → error carrying the op failure message (validation failures surface here)', async () => {
    const trx = makeTrx({
      operationRows: [{
        bill_id: 'bill-1',
        status: 'failed',
        last_error: 'QBO_VENDOR_BILL_EXPENSE_ACCOUNT_REQUIRED: Set a default expense account in accounting sync settings'
      }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('error');
    expect(status.error_message).toContain('QBO_VENDOR_BILL_EXPENSE_ACCOUNT_REQUIRED');
  });

  it('skipped op with no last_error → error with fallback message', async () => {
    const trx = makeTrx({
      operationRows: [{ bill_id: 'bill-1', status: 'skipped', last_error: null }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('error');
    expect(status.error_message).toBe('Vendor bill export failed');
  });

  it('retry queued after a failure → pending wins over the older failed op', async () => {
    const trx = makeTrx({
      operationRows: [
        { bill_id: 'bill-1', status: 'pending', created_at: '2026-07-11T02:00:00Z' },
        { bill_id: 'bill-1', status: 'failed', last_error: 'boom', created_at: '2026-07-11T01:00:00Z' }
      ]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('pending');
  });

  it('delivered export line → exported, and beats a failed op for the same bill', async () => {
    const trx = makeTrx({
      exportRows: [{
        bill_id: 'bill-1',
        line_status: 'delivered',
        batch_status: 'delivered',
        external_document_ref: 'qbo-bill-9',
        delivered_at: '2026-07-11T00:00:00.000Z'
      }],
      operationRows: [{ bill_id: 'bill-1', status: 'failed', last_error: 'stale failure' }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('exported');
    expect(status.external_ref).toBe('qbo-bill-9');
    expect(status.error_message).toBeNull();
  });

  it('external entity mapping fallback → exported with the external ref', async () => {
    const trx = makeTrx({
      mappingRows: [{ bill_id: 'bill-1', external_ref: 'qbo-bill-42', last_synced_at: '2026-07-10T12:00:00.000Z' }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('exported');
    expect(status.external_ref).toBe('qbo-bill-42');
  });

  it('no connected integration → mapping fallback is skipped', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue(null);
    const trx = makeTrx({
      mappingRows: [{ bill_id: 'bill-1', external_ref: 'qbo-bill-42', last_synced_at: null }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('not_exported');
  });

  it('line pending inside an active (validating) batch → pending', async () => {
    const trx = makeTrx({
      exportRows: [{ bill_id: 'bill-1', line_status: 'pending', batch_status: 'validating' }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('pending');
  });

  it('failed line / needs_attention batch → error with the line notes', async () => {
    const trx = makeTrx({
      exportRows: [{
        bill_id: 'bill-1',
        line_status: 'failed',
        batch_status: 'needs_attention',
        line_notes: 'missing_item_mapping: No expense account mapped'
      }]
    });

    const [status] = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-1']);

    expect(status.state).toBe('error');
    expect(status.error_message).toContain('missing_item_mapping');
  });

  it('returns one status per requested bill, mixed states', async () => {
    const trx = makeTrx({
      exportRows: [{ bill_id: 'bill-a', line_status: 'delivered', batch_status: 'delivered' }],
      operationRows: [{ bill_id: 'bill-b', status: 'pending' }]
    });

    const statuses = await getVendorBillExportStatusesForTenant(trx, TENANT, ['bill-a', 'bill-b', 'bill-c']);

    expect(statuses.map((s) => s.state)).toEqual(['exported', 'pending', 'not_exported']);
  });
});

// ── Retry action ─────────────────────────────────────────────────────────────

describe('retryVendorBillExport', () => {
  function install(tables: FakeTables) {
    const trx = makeTrx(tables);
    createTenantKnexMock.mockResolvedValue({ knex: trx, tenant: TENANT });
    return trx;
  }

  it('rejects without billing:update permission', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    install({});

    await expect(
      (retryVendorBillExport as any)(USER, { tenant: TENANT }, 'bill-1')
    ).rejects.toThrow(/Permission denied/);
    expect(enqueueVendorBillExportRetry).not.toHaveBeenCalled();
  });

  it('already exported → returns exported status without re-enqueueing (idempotency)', async () => {
    install({
      mappingRows: [{ bill_id: 'bill-1', external_ref: 'qbo-bill-42', last_synced_at: null }]
    });

    const status = await (retryVendorBillExport as any)(USER, { tenant: TENANT }, 'bill-1');

    expect(status.state).toBe('exported');
    expect(enqueueVendorBillExportRetry).not.toHaveBeenCalled();
  });

  it('already pending → returns pending status without re-enqueueing', async () => {
    install({
      operationRows: [{ bill_id: 'bill-1', status: 'pending' }]
    });

    const status = await (retryVendorBillExport as any)(USER, { tenant: TENANT }, 'bill-1');

    expect(status.state).toBe('pending');
    expect(enqueueVendorBillExportRetry).not.toHaveBeenCalled();
  });

  it('failed bill → enqueues the retry op and returns the refreshed (pending) status', async () => {
    const tables: FakeTables = {
      operationRows: [{ bill_id: 'bill-1', status: 'failed', last_error: 'validation failed' }]
    };
    const trx = install(tables);

    // The enqueue flips the newest op to pending, as the real producer does.
    vi.mocked(enqueueVendorBillExportRetry).mockImplementation(async () => {
      tables.operationRows = [{ bill_id: 'bill-1', status: 'pending' }, ...(tables.operationRows ?? [])];
      return true;
    });

    const status = await (retryVendorBillExport as any)(USER, { tenant: TENANT }, 'bill-1');

    expect(enqueueVendorBillExportRetry).toHaveBeenCalledWith(trx, TENANT, 'bill-1');
    expect(status.state).toBe('pending');
  });

  it('missing bill → throws Vendor bill not found', async () => {
    install({ vendorBillRow: null });

    await expect(
      (retryVendorBillExport as any)(USER, { tenant: TENANT }, 'bill-missing')
    ).rejects.toThrow('Vendor bill not found');
    expect(enqueueVendorBillExportRetry).not.toHaveBeenCalled();
  });

  it('exportVendorBillToAccounting stays a compatibility alias for retryVendorBillExport', () => {
    expect(exportVendorBillToAccounting).toBe(retryVendorBillExport);
  });
});

// ── Export context (the 0002086 guard) ───────────────────────────────────────

describe('getVendorBillExportContext', () => {
  beforeEach(() => {
    createTenantKnexMock.mockResolvedValue({ knex: makeTrx({}), tenant: TENANT });
  });

  it('no connected integration → no export affordances at all', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue(null);

    const context = await (getVendorBillExportContext as any)(USER, { tenant: TENANT });

    expect(context).toEqual({ integration: null, vendorBillsSupported: false });
  });

  it('QBO connected → vendor bills supported', async () => {
    const context = await (getVendorBillExportContext as any)(USER, { tenant: TENANT });

    expect(context).toEqual({
      integration: { adapterType: 'quickbooks_online', label: 'QuickBooks Online' },
      vendorBillsSupported: true
    });
  });

  it('Xero connected → integration shown but vendor bills unsupported', async () => {
    vi.mocked(resolveConnectedAccountingIntegration).mockResolvedValue({
      adapterType: 'xero',
      targetRealm: 'xero-conn-1'
    } as any);

    const context = await (getVendorBillExportContext as any)(USER, { tenant: TENANT });

    expect(context).toEqual({
      integration: { adapterType: 'xero', label: 'Xero' },
      vendorBillsSupported: false
    });
  });

  it('rejects without billing:read permission', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      (getVendorBillExportContext as any)(USER, { tenant: TENANT })
    ).rejects.toThrow(/Permission denied/);
  });
});
