import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
const getStoredXeroConnectionsMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1')
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: getStoredXeroConnectionsMock
}));

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null,
    autoProvisionCustomers: false, depositAccountRef: null,
    defaultClassRef: null,
    defaultDepartmentRef: null,
    defaultRealm: null
  })),
  resolveDefaultRealm: vi.fn(async () => 'realm-1')
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () { return ({
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 1)
  }); })
}));

import {
  enqueueInvoiceAutoExport,
  enqueueVendorBillAutoExport,
  enqueueVendorBillExportRetry,
  satisfyExportOpsForManualBatch,
  enqueueCreditApplication,
  enqueueInvoiceVoid,
  enqueueExternalPaymentPush
} from './syncProducers';
import { getAccountingSyncSettings, resolveDefaultRealm } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';

const mockGetRealm = vi.mocked(resolveDefaultRealm);
const mockGetSettings = vi.mocked(getAccountingSyncSettings);

/** Build a fake knex that returns the given invoice_type/invoice_date for any invoice lookup. */
function makeKnex(invoiceType: string | null = 'standard', invoiceDate: string | null = null): any {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () =>
      invoiceType !== null ? { invoice_type: invoiceType, invoice_date: invoiceDate } : null)
  };
  const table = vi.fn(() => query);
  const fn = Object.assign(table, { fn: { now: vi.fn() } });
  return fn;
}

/**
 * Build a fake knex for enqueueInvoiceVoid tests.
 * The void producer queries tenant_external_entity_mappings to check for a mapping.
 */
function makeVoidKnex(hasMapping: boolean = true): any {
  const mappingRow = hasMapping ? { id: 'map-1' } : null;
  const query: any = {
    where: vi.fn(() => query),
    first: vi.fn(async (..._args: any[]) => mappingRow)
  };
  const table = vi.fn(() => query);
  const fn = Object.assign(table, { fn: { now: vi.fn() } });
  return fn;
}

describe('enqueueInvoiceAutoExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default happy-path mocks
    mockGetRealm.mockResolvedValue('realm-1');
    getStoredXeroConnectionsMock.mockResolvedValue({});
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });
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
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await enqueueInvoiceAutoExport(makeKnex(), 't1', 'inv-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
  });

  it('does nothing when today is before autoSyncStartDate cutoff', async () => {
    vi.stubEnv('EDITION', 'ee');
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: futureDate, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

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
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: pastDate, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

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

  it('cutoff fences by the invoice DATE: a pre-cutoff invoice re-finalized after the cutoff never enqueues', async () => {
    vi.stubEnv('EDITION', 'ee');
    // Cutoff already passed on the wall clock, but the invoice is dated before
    // it — the unfinalize → re-finalize scenario. Time passing the cutoff must
    // not export history.
    const pastCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const preGoLiveDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: pastCutoff, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await enqueueInvoiceAutoExport(makeKnex('standard', preGoLiveDate), 't1', 'inv-history-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('cutoff fence: an invoice dated on/after the cutoff enqueues normally', async () => {
    vi.stubEnv('EDITION', 'ee');
    const pastCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: pastCutoff, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await enqueueInvoiceAutoExport(makeKnex('standard', recentDate), 't1', 'inv-recent-1');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({ algaEntityId: 'inv-recent-1', operation: 'export_invoice' })
    );
  });
});

describe('enqueueVendorBillAutoExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRealm.mockResolvedValue('realm-1');
    getStoredXeroConnectionsMock.mockResolvedValue({});
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enqueues export_vendor_bill when EE, auto-sync, and QBO support are present', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueVendorBillAutoExport(makeKnex(), 't1', 'bill-1');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'realm-1',
        operation: 'export_vendor_bill',
        algaEntityType: 'vendor_bill',
        algaEntityId: 'bill-1'
      })
    );
  });

  it('skips auto-export when autoSyncEnabled=false', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await enqueueVendorBillAutoExport(makeKnex(), 't1', 'bill-2');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('retry bypasses autoSyncEnabled=false', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await expect(enqueueVendorBillExportRetry(makeKnex(), 't1', 'bill-3')).resolves.toBe(true);

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'export_vendor_bill',
        algaEntityId: 'bill-3'
      })
    );
  });

  it('skips when only Xero is connected because vendor bills are unsupported there', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetRealm.mockResolvedValue(null);
    getStoredXeroConnectionsMock.mockResolvedValue({ 'xero-connection-1': {} });

    await enqueueVendorBillAutoExport(makeKnex(), 't1', 'bill-4');

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
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });
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

describe('enqueueInvoiceVoid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRealm.mockResolvedValue('realm-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing when not enterprise edition', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    await enqueueInvoiceVoid(makeVoidKnex(), 't1', 'inv-void-1');

    expect(mockGetRealm).not.toHaveBeenCalled();
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      expect((result.value as any)?.enqueue).not.toHaveBeenCalled();
    }
  });

  it('does nothing when realm is null', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetRealm.mockResolvedValue(null);

    await enqueueInvoiceVoid(makeVoidKnex(), 't1', 'inv-void-2');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      expect((result.value as any)?.enqueue).not.toHaveBeenCalled();
    }
  });

  it('does nothing when no mapping exists for the invoice', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueInvoiceVoid(makeVoidKnex(false), 't1', 'inv-void-3');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('enqueues void_invoice when EE + realm + mapping exists', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueInvoiceVoid(makeVoidKnex(true), 't1', 'inv-void-4');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'void_invoice',
        algaEntityType: 'invoice',
        algaEntityId: 'inv-void-4',
        adapterType: 'quickbooks_online'
      })
    );
  });

  it('does NOT check autoSyncEnabled (always enqueues regardless of toggle)', async () => {
    vi.stubEnv('EDITION', 'ee');
    // autoSyncEnabled=false should NOT stop void from enqueuing
    mockGetSettings.mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, autoProvisionCustomers: false, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    await enqueueInvoiceVoid(makeVoidKnex(true), 't1', 'inv-void-5');

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'void_invoice' })
    );
  });

  it('swallows errors without throwing (fire-and-forget)', async () => {
    vi.stubEnv('EDITION', 'ee');
    mockGetRealm.mockRejectedValue(new Error('realm lookup failed'));

    await expect(enqueueInvoiceVoid(makeVoidKnex(), 't1', 'inv-void-6')).resolves.toBeUndefined();
  });
});

describe('enqueueExternalPaymentPush', () => {
  const BASE_PARAMS = {
    invoiceId: 'inv-push-1',
    paymentId: 'pay-push-1',
    amountCents: 10000,
    provider: 'stripe',
    referenceNumber: 'ch_stripe_123'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRealm.mockResolvedValue('realm-1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enqueues record_payment when all gates pass (EE + non-qbo provider + realm + mapped invoice)', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueExternalPaymentPush(makeVoidKnex(true), 't1', BASE_PARAMS);

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const enqueueFn = (results[results.length - 1].value as any)?.enqueue as ReturnType<typeof vi.fn>;
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'record_payment',
        algaEntityType: 'invoice_payment',
        algaEntityId: 'pay-push-1',
        adapterType: 'quickbooks_online',
        payload: expect.objectContaining({
          invoiceId: 'inv-push-1',
          amountCents: 10000,
          referenceNumber: 'ch_stripe_123',
          provider: 'stripe'
        })
      })
    );
  });

  it('skips when provider is "quickbooks" (echo guard)', async () => {
    vi.stubEnv('EDITION', 'ee');

    await enqueueExternalPaymentPush(makeVoidKnex(true), 't1', {
      ...BASE_PARAMS,
      provider: 'quickbooks'
    });

    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('skips when not enterprise edition (CE)', async () => {
    vi.stubEnv('EDITION', 'community');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'community');

    await enqueueExternalPaymentPush(makeVoidKnex(true), 't1', BASE_PARAMS);

    expect(mockGetRealm).not.toHaveBeenCalled();
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    for (const result of results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });

  it('skips quietly when invoice has no QBO mapping (pre-go-live)', async () => {
    vi.stubEnv('EDITION', 'ee');

    // No mapping found for the invoice
    await enqueueExternalPaymentPush(makeVoidKnex(false), 't1', BASE_PARAMS);

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
    mockGetRealm.mockRejectedValue(new Error('realm lookup boom'));

    await expect(
      enqueueExternalPaymentPush(makeVoidKnex(true), 't1', BASE_PARAMS)
    ).resolves.toBeUndefined();
  });
});

describe('satisfyExportOpsForManualBatch', () => {
  const knex = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('satisfies pending export ops for any adapterType', async () => {
    await satisfyExportOpsForManualBatch(knex, 't1', 'xero', ['inv-1']);
    const results = vi.mocked(SyncOperationsRepository).mock.results;
    expect(results.length).toBeGreaterThan(0);
    const satisfyPending = (results[results.length - 1].value as any)?.satisfyPending as ReturnType<typeof vi.fn>;
    expect(satisfyPending).toHaveBeenCalledWith('t1', 'xero', 'export_invoice', ['inv-1']);
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
