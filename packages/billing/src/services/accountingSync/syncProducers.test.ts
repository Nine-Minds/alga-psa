import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1')
}));

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null
  }))
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 1)
  }))
}));

import { enqueueInvoiceAutoExport, satisfyExportOpsForManualBatch, enqueueCreditApplication } from './syncProducers';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';

const mockGetRealm = vi.mocked(getDefaultQboRealmId);
const mockGetSettings = vi.mocked(getAccountingSyncSettings);

/** Build a fake knex that returns the given invoice_type for any invoice lookup. */
function makeKnex(invoiceType: string | null = 'standard'): any {
  const first = vi.fn(async () => invoiceType !== null ? { invoice_type: invoiceType } : null);
  const select = vi.fn(() => ({ first }));
  const where = vi.fn(() => ({ select }));
  const table = vi.fn(() => ({ where }));
  const fn = Object.assign(table, { fn: { now: vi.fn() } });
  return fn;
}

describe('enqueueInvoiceAutoExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default happy-path mocks
    mockGetRealm.mockResolvedValue('realm-1');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when not enterprise edition', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1');

    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when autoSyncEnabled=false', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null });

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when today is before autoSyncStartDate cutoff', async () => {
    vi.stubEnv('EDITION', 'ee');
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: futureDate });

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when getDefaultQboRealmId returns null', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetRealm.mockResolvedValue(null);

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1');

    const opsInstance = vi.mocked(SyncOperationsRepository).mock.instances[0];
    // If SyncOperationsRepository was constructed, enqueue should not have been called
    // (or the repo was never constructed at all)
    if (opsInstance) {
      expect((opsInstance as any).enqueue).not.toHaveBeenCalled();
    } else {
      // repo was never instantiated — test passes
      expect(true).toBe(true);
    }
  });

  it('enqueues the invoice when all gates pass (EE + autoSync + past cutoff + realm found)', async () => {
    vi.stubEnv('EDITION', 'ee');
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: pastDate });

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-42');

    // mock.results contains the return values of each constructor call.
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityId: 'inv-42',
        operation: 'export_invoice',
        adapterType: 'quickbooks_online'
      })
    );
  });

  it('swallows errors without throwing (fire-and-forget)', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockRejectedValue(new Error('db error'));

    await expect(enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1')).resolves.toBeUndefined();
  });

  it('credit_note invoice_type → enqueues export_credit_memo', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueInvoiceAutoExport(makeKnex('credit_note'), 't1', 'inv-cn-1');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityId: 'inv-cn-1',
        operation: 'export_credit_memo',
        algaEntityType: 'invoice',
        adapterType: 'quickbooks_online'
      })
    );
  });

  it('prepayment invoice_type → skips without enqueuing', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueInvoiceAutoExport(makeKnex('prepayment'), 't1', 'inv-pp-1');

    // SyncOperationsRepository should not have been constructed, or its enqueue never called.
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });
});

describe('enqueueCreditApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRealm.mockResolvedValue('realm-1');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enqueues apply_credit op with correct payload when all gates pass', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueCreditApplication({} as any, 't1', {
      allocationId: 'alloc-1',
      creditNoteInvoiceId: 'inv-cn-99',
      targetInvoiceId: 'inv-target-99',
      amountCents: 5000
    });

    // Capture the most recent SyncOperationsRepository instance and check enqueue.
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'apply_credit',
        algaEntityType: 'credit_allocation',
        algaEntityId: 'alloc-1',
        payload: expect.objectContaining({
          creditNoteInvoiceId: 'inv-cn-99',
          targetInvoiceId: 'inv-target-99',
          amountCents: 5000
        }),
        adapterType: 'quickbooks_online'
      })
    );
  });

  it('does nothing when not enterprise edition', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    await enqueueCreditApplication({} as any, 't1', {
      allocationId: 'alloc-2',
      creditNoteInvoiceId: 'inv-cn-1',
      targetInvoiceId: 'inv-target-1',
      amountCents: 1000
    });

    // No SyncOperationsRepository should have been constructed when gating out early.
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('swallows errors without throwing (fire-and-forget)', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockRejectedValue(new Error('db boom'));

    await expect(
      enqueueCreditApplication({} as any, 't1', {
        allocationId: 'alloc-3',
        creditNoteInvoiceId: 'inv-cn-2',
        targetInvoiceId: 'inv-target-2',
        amountCents: 2000
      })
    ).resolves.toBeUndefined();
  });
});

describe('satisfyExportOpsForManualBatch', () => {
  const knex = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing for non-quickbooks adapterType', async () => {
    await satisfyExportOpsForManualBatch(knex, 't1', 'xero', ['inv-1']);
    const instances = vi.mocked(SyncOperationsRepository).mock.instances;
    // No instances should have been created, or satisfyPending not called
    for (const inst of instances) {
      expect((inst as any).satisfyPending).not.toHaveBeenCalled();
    }
  });

  it('does nothing for empty invoiceIds', async () => {
    await satisfyExportOpsForManualBatch(knex, 't1', 'quickbooks_online', []);
    // SyncOperationsRepository should not be called with satisfyPending
    const instances = vi.mocked(SyncOperationsRepository).mock.instances;
    for (const inst of instances) {
      expect((inst as any).satisfyPending).not.toHaveBeenCalled();
    }
  });
});
