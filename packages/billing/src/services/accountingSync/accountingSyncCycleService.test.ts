import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
// tenantDb is only used by the vendor-bill drain to read bill rows; everything
// else on @alga-psa/db stays real.
const tenantDbMock = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tenantDb: tenantDbMock
}));

vi.mock('./syncCycleRepository', () => ({
  SyncCycleRepository: vi.fn().mockImplementation(function () { return ({
    getLastSuccessfulCursor: vi.fn(async () => null),
    startCycle: vi.fn(async () => 'cycle-001'),
    finishCycle: vi.fn(async () => undefined)
  }); })
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () { return ({
    listPending: vi.fn(async () => []),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => 'pending'),
    markFailedTerminal: vi.fn(async () => 'failed'),
    satisfyPending: vi.fn(async () => 0),
    enqueue: vi.fn(async () => ({}))
  }); })
}));

vi.mock('./syncMappingLedger', () => ({
  SyncMappingLedger: vi.fn().mockImplementation(function () { return ({
    findByExternalId: vi.fn(async () => undefined),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn().mockReturnThis()
  }); })
}));

vi.mock('./paymentApplier', () => ({
  applyExternalPaymentChange: vi.fn(async () => undefined)
}));

vi.mock('./customerApplier', () => ({
  applyExternalCustomerChange: vi.fn(async () => undefined)
}));

vi.mock('./driftDetector', () => ({
  applyExternalDocumentChange: vi.fn(async () => undefined)
}));

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null,
    depositAccountRef: null,
    defaultClassRef: null,
    defaultDepartmentRef: null,
    defaultRealm: null
  }))
}));

vi.mock('./syncExceptionService', () => ({
  WorkflowTaskSyncExceptionService: vi.fn().mockImplementation(function () { return ({
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  }); })
}));

vi.mock('./syncNotificationService', () => ({
  DefaultSyncNotificationService: vi.fn().mockImplementation(function () { return ({
    notifyConnectionExpired: vi.fn(async () => undefined),
    notifyTokenExpiring: vi.fn(async () => undefined),
    notifyNewExceptions: vi.fn(async () => undefined)
  }); }),
  resolveTokenThresholdToAnnounce: vi.fn(async () => null)
}));

vi.mock('../accountingExportInvoiceSelector', () => ({
  AccountingExportInvoiceSelector: vi.fn().mockImplementation(function () { return ({
    createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-001' } }))
  }); })
}));

vi.mock('../accountingExportService', () => ({
  AccountingExportService: {
    createForTenant: vi.fn(async () => ({
      executeBatch: vi.fn(async () => undefined)
    }))
  }
}));

vi.mock('./creditApplicationApplier', () => ({
  drainApplyCreditOps: vi.fn(async () => undefined)
}));

vi.mock('./invoiceVoidApplier', () => ({
  drainVoidInvoiceOps: vi.fn(async () => undefined)
}));

vi.mock('./paymentPushApplier', () => ({
  drainRecordPaymentOps: vi.fn(async () => undefined)
}));

import { runAccountingSyncCycle, CURSOR_OVERLAP_MS } from './accountingSyncCycleService';
import { SyncCycleRepository } from './syncCycleRepository';
import { SyncOperationsRepository } from './syncOperationsRepository';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { applyExternalPaymentChange } from './paymentApplier';
import { applyExternalCustomerChange } from './customerApplier';
import { applyExternalDocumentChange } from './driftDetector';
import { resolveTokenThresholdToAnnounce } from './syncNotificationService';
import { AccountingExportInvoiceSelector } from '../accountingExportInvoiceSelector';
import { AccountingExportService } from '../accountingExportService';
import { AppError } from '@alga-psa/core';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { drainVoidInvoiceOps } from './invoiceVoidApplier';
import { drainRecordPaymentOps } from './paymentPushApplier';
import { SyncMappingLedger } from './syncMappingLedger';

const TENANT = 'tenant-abc';
const REALM = 'realm-xyz';
const ADAPTER_TYPE = 'quickbooks_online';

function makeFakeAdapter(overrides: any = {}) {
  return {
    capabilities: vi.fn(function () { return ({ supportsChangePolling: true }); }),
    fetchChanges: vi.fn(async () => ({
      changes: [],
      truncated: false,
      fetchedAt: new Date().toISOString()
    })),
    ...overrides
  };
}

function makeFakeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

function makeFakeNotifications() {
  return {
    notifyConnectionExpired: vi.fn(async () => undefined),
    notifyTokenExpiring: vi.fn(async () => undefined),
    notifyNewExceptions: vi.fn(async () => undefined)
  };
}

/** Fake tenant-scoped db for the vendor-bill drain's bill lookup. */
function makeVendorBillDb(
  bills: Array<{ bill_id: string; bill_number: string; total_amount: number | string | null; currency_code: string | null }>
) {
  const builder: any = {};
  builder.whereIn = vi.fn(() => builder);
  builder.select = vi.fn(async () => bills);
  return { table: vi.fn(() => builder) };
}

function getCyclesInstance() {
  return vi.mocked(SyncCycleRepository).mock.instances[vi.mocked(SyncCycleRepository).mock.instances.length - 1] as any;
}
function getOpsInstance() {
  return vi.mocked(SyncOperationsRepository).mock.instances[vi.mocked(SyncOperationsRepository).mock.instances.length - 1] as any;
}

describe('runAccountingSyncCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all module-level mocks to defaults
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });
    vi.mocked(resolveTokenThresholdToAnnounce).mockResolvedValue(null);
    tenantDbMock.mockImplementation(() => makeVendorBillDb([]));
  });

  it('skips when adapter does not support change polling', async () => {
    const adapter = { capabilities: vi.fn(function () { return ({ supportsChangePolling: false }); }), fetchChanges: undefined };
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: adapter as any
    });

    expect(result.ran).toBe(false);
    expect(result.status).toBe('skipped');
  });

  it('skips when autoSyncEnabled=false and force not set', async () => {
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter()
    });

    expect(result.ran).toBe(false);
    expect(result.status).toBe('skipped');
  });

  it('runs when autoSyncEnabled=false but force=true', async () => {
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null, depositAccountRef: null, defaultClassRef: null, defaultDepartmentRef: null, defaultRealm: null });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      force: true,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(result.ran).toBe(true);
    expect(result.status).toBe('succeeded');
  });

  it('first run: cursor passed to fetchChanges is now − CURSOR_OVERLAP_MS', async () => {
    const fixedNow = new Date('2026-01-15T12:00:00.000Z');
    const adapter = makeFakeAdapter();

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications(),
      now: () => fixedNow
    });

    const expectedSince = new Date(fixedNow.getTime() - CURSOR_OVERLAP_MS).toISOString();
    expect(adapter.fetchChanges).toHaveBeenCalledWith(TENANT, expectedSince, REALM);
  });

  it('subsequent run: cursor is storedCursor − CURSOR_OVERLAP_MS', async () => {
    const storedCursor = '2026-01-14T10:00:00.000Z';
    // Override SyncCycleRepository for this test
    vi.mocked(SyncCycleRepository).mockImplementationOnce(function () { return ({
      getLastSuccessfulCursor: vi.fn(async () => storedCursor),
      startCycle: vi.fn(async () => 'cycle-002'),
      finishCycle: vi.fn(async () => undefined)
    } as any); });

    const adapter = makeFakeAdapter();
    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    const expectedSince = new Date(new Date(storedCursor).getTime() - CURSOR_OVERLAP_MS).toISOString();
    expect(adapter.fetchChanges).toHaveBeenCalledWith(TENANT, expectedSince, REALM);
  });

  it('succeeded cycle records cursorAfter = changeSet.fetchedAt', async () => {
    const fetchedAt = '2026-01-15T13:00:00.000Z';
    const adapter = makeFakeAdapter({
      fetchChanges: vi.fn(async () => ({ changes: [], truncated: false, fetchedAt }))
    });

    let finishCycleCall: any = null;
    vi.mocked(SyncCycleRepository).mockImplementationOnce(function () { return ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-003'),
      finishCycle: vi.fn(async (_tenant: string, _cycleId: string, result: any) => {
        finishCycleCall = result;
      })
    } as any); });

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(finishCycleCall).not.toBeNull();
    expect(finishCycleCall.status).toBe('succeeded');
    expect(finishCycleCall.cursorAfter).toBe(fetchedAt);
  });

  it('inbound failure → status failed, no cursorAfter', async () => {
    const adapter = makeFakeAdapter({
      fetchChanges: vi.fn(async () => {
        throw new Error('network error');
      })
    });

    let finishCall: any = null;
    vi.mocked(SyncCycleRepository).mockImplementationOnce(function () { return ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-fail'),
      finishCycle: vi.fn(async (_t: string, _c: string, result: any) => {
        finishCall = result;
      })
    } as any); });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(result.ran).toBe(true);
    expect(result.status).toBe('failed');
    expect(finishCall.status).toBe('failed');
    expect(finishCall.cursorAfter).toBeUndefined();
  });

  it('auth error → aborted status + exception created + notifyConnectionExpired + no cursor advance', async () => {
    const adapter = makeFakeAdapter({
      fetchChanges: vi.fn(async () => {
        throw new AppError('QBO_AUTH_ERROR', 'auth failed');
      })
    });

    const exceptions = makeFakeExceptions();
    const notifications = makeFakeNotifications();

    let finishCall: any = null;
    vi.mocked(SyncCycleRepository).mockImplementationOnce(function () { return ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-auth'),
      finishCycle: vi.fn(async (_t: string, _c: string, result: any) => {
        finishCall = result;
      })
    } as any); });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions,
      notifications
    });

    expect(result.ran).toBe(true);
    expect(result.status).toBe('aborted');
    expect(finishCall.status).toBe('aborted');
    expect(finishCall.cursorAfter).toBeUndefined();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_connection_expired' })
    );
    expect(notifications.notifyConnectionExpired).toHaveBeenCalled();
  });

  it('applies changes in order: Customer → Payment → Invoice/CreditMemo, counts RefundReceipt', async () => {
    const applyCustomer = vi.mocked(applyExternalCustomerChange);
    const applyPayment = vi.mocked(applyExternalPaymentChange);
    const applyDocument = vi.mocked(applyExternalDocumentChange);

    const calls: string[] = [];
    applyCustomer.mockImplementation(async () => { calls.push('Customer'); });
    applyPayment.mockImplementation(async () => { calls.push('Payment'); });
    applyDocument.mockImplementation(async () => { calls.push('Document'); });

    const adapter = makeFakeAdapter({
      fetchChanges: vi.fn(async () => ({
        changes: [
          { entityType: 'Invoice', externalId: 'i1', syncToken: '1', deleted: false, payload: {} },
          { entityType: 'Customer', externalId: 'c1', syncToken: '1', deleted: false, payload: {} },
          { entityType: 'Payment', externalId: 'p1', syncToken: '1', deleted: false, payload: {} },
          { entityType: 'RefundReceipt', externalId: 'rr1', syncToken: '1', deleted: false, payload: {} },
          { entityType: 'CreditMemo', externalId: 'cm1', syncToken: '1', deleted: false, payload: {} }
        ],
        truncated: false,
        fetchedAt: new Date().toISOString()
      }))
    });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter,
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    // Customer must come before Payment, Payment before Document
    const customerIdx = calls.indexOf('Customer');
    const paymentIdx = calls.indexOf('Payment');
    const docIdx = calls.indexOf('Document');
    expect(customerIdx).toBeLessThan(paymentIdx);
    expect(paymentIdx).toBeLessThan(docIdx);

    // RefundReceipts are just counted
    expect(result.stats?.refundReceiptsSeen).toBe(1);
  });

  it('drain: pending ops grouped → batch created with origin=scheduled → executeBatch → ops marked done', async () => {
    const pendingOps = [
      { op_id: 'op-1', alga_entity_id: 'inv-1', attempts: 0 },
      { op_id: 'op-2', alga_entity_id: 'inv-2', attempts: 0 }
    ];

    const markDone = vi.fn(async () => undefined);
    // Return ops only for export_invoice; export_credit_memo yields empty (none queued in this test).
    const listPending = vi.fn(async (_t: string, _a: string, opts: any) =>
      opts?.operation === 'export_invoice' ? pendingOps : []);
    const markInProgress = vi.fn(async () => undefined);

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending,
      markInProgress,
      markDone,
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    const createBatchFromFilters = vi.fn(async () => ({ batch: { batch_id: 'batch-drain' } }));
    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters
    } as any); });

    const executeBatch = vi.fn(async () => undefined);
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValueOnce({ executeBatch } as any);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(createBatchFromFilters).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'scheduled' })
    );
    expect(executeBatch).toHaveBeenCalledWith('batch-drain');
    expect(markDone).toHaveBeenCalledTimes(2);
    expect(result.stats?.opsProcessed).toBe(2);
  });

  it('drain: ACCOUNTING_EXPORT_EMPTY_BATCH → ops marked done (already exported)', async () => {
    const pendingOps = [{ op_id: 'op-3', alga_entity_id: 'inv-3', attempts: 0 }];

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => {
        throw new AppError('ACCOUNTING_EXPORT_EMPTY_BATCH', 'nothing to export');
      })
    } as any); });

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    // Empty batch → ops done, cycle still succeeded
    expect(result.status).toBe('succeeded');
    expect(result.stats?.opsProcessed).toBe(1);
  });

  it('drain failure → ops marked failed, cycle still succeeds (outbound never blocks cursor)', async () => {
    const pendingOps = [{ op_id: 'op-4', alga_entity_id: 'inv-4', attempts: 0 }];
    const markFailed = vi.fn(async () => 'pending');

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed,
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-fail' } }))
    } as any); });

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValueOnce({
      executeBatch: vi.fn(async () => { throw new Error('export pipeline error'); })
    } as any);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(markFailed).toHaveBeenCalled();
    // Outbound failure does NOT block the cursor — cycle still succeeds
    expect(result.status).toBe('succeeded');
    expect(result.stats?.opsFailed).toBe(1);
  });

  it('drain validation failure → exception filed immediately (before attempts cap) and scheduled batch auto-cancelled', async () => {
    const pendingOps = [{ op_id: 'op-val', alga_entity_id: 'inv-val', attempts: 0 }];
    const markFailed = vi.fn(async () => 'pending'); // NOT at the cap

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed,
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-val' } }))
    } as any); });

    const cancelBatch = vi.fn(async () => ({ batch_id: 'batch-val', status: 'cancelled' }));
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => {
        throw new AppError('ACCOUNTING_EXPORT_VALIDATION_FAILED', 'batch not ready', {
          batchId: 'batch-val',
          status: 'needs_attention',
          validationErrors: [{ code: 'missing_item_mapping', message: 'No item mapping for service X' }]
        });
      }),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-val', status: 'needs_attention', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch
    } as any);

    const exceptions = makeFakeExceptions();

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    // Exception filed on the FIRST failure — no 75-minute silent retry window.
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_export_error',
        entityId: 'inv-val',
        title: 'Scheduled accounting export failed validation',
        context: expect.objectContaining({
          details: expect.stringContaining('missing_item_mapping')
        })
      })
    );
    // The wedge-maker is gone: scheduled batch cancelled so the next drain can recreate it.
    expect(cancelBatch).toHaveBeenCalledWith('batch-val', expect.anything());
    // Op still retries (admin may fix the mapping before the cap).
    expect(markFailed).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');

    vi.mocked(AccountingExportService.createForTenant).mockReset();
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined)
    } as any);
  });

  it('drain transient failure → exception NOT filed before the attempts cap', async () => {
    const pendingOps = [{ op_id: 'op-net', alga_entity_id: 'inv-net', attempts: 0 }];

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-net' } }))
    } as any); });

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => { throw new Error('socket hang up'); }),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-net', status: 'failed', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch: vi.fn(async () => ({}))
    } as any);

    const exceptions = makeFakeExceptions();

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    // Transient failures keep the retry-then-alert shape.
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();

    vi.mocked(AccountingExportService.createForTenant).mockReset();
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined)
    } as any);
  });

  it('drain recovers from a stale scheduled batch wedging the duplicate guard: cancels it and retries', async () => {
    const pendingOps = [{ op_id: 'op-wedge', alga_entity_id: 'inv-wedge', attempts: 2 }];
    const markDone = vi.fn(async () => undefined);

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone,
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    // First create hits the duplicate guard (stale batch from a failed prior drain);
    // after the stale batch is cancelled, the retry succeeds.
    const createBatchFromFilters = vi.fn()
      .mockRejectedValueOnce(new AppError('ACCOUNTING_EXPORT_DUPLICATE', 'An export batch already exists for this filter selection', {
        batchId: 'batch-stale',
        status: 'needs_attention'
      }))
      .mockResolvedValueOnce({ batch: { batch_id: 'batch-fresh' } });
    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters
    } as any); });

    const cancelBatch = vi.fn(async () => ({}));
    const executeBatch = vi.fn(async () => undefined);
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch,
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-stale', status: 'needs_attention', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch
    } as any);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(cancelBatch).toHaveBeenCalledWith('batch-stale', expect.anything());
    expect(createBatchFromFilters).toHaveBeenCalledTimes(2);
    expect(executeBatch).toHaveBeenCalledWith('batch-fresh');
    expect(markDone).toHaveBeenCalled();
    expect(result.stats?.opsProcessed).toBe(1);

    vi.mocked(AccountingExportService.createForTenant).mockReset();
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined)
    } as any);
  });

  it('drain does NOT auto-cancel a manual batch blocking the duplicate guard', async () => {
    const pendingOps = [{ op_id: 'op-manual-block', alga_entity_id: 'inv-mb', attempts: 0 }];
    const markFailed = vi.fn(async () => 'pending');

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed,
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    const createBatchFromFilters = vi.fn()
      .mockRejectedValue(new AppError('ACCOUNTING_EXPORT_DUPLICATE', 'An export batch already exists for this filter selection', {
        batchId: 'batch-manual',
        status: 'ready'
      }));
    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters
    } as any); });

    const cancelBatch = vi.fn(async () => ({}));
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-manual', status: 'ready', origin: 'manual' },
        lines: [],
        errors: []
      })),
      cancelBatch
    } as any);

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    // Operator-owned batches are never auto-cancelled; the op fails normally.
    expect(cancelBatch).not.toHaveBeenCalled();
    expect(createBatchFromFilters).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalled();

    vi.mocked(AccountingExportService.createForTenant).mockReset();
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined)
    } as any);
  });

  it('drain success resolves a previously filed export-error exception', async () => {
    const pendingOps = [{ op_id: 'op-heal', alga_entity_id: 'inv-heal', attempts: 1 }];

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-heal' } }))
    } as any); });

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValueOnce({
      executeBatch: vi.fn(async () => undefined)
    } as any);

    const exceptions = makeFakeExceptions();

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    expect(exceptions.resolve).toHaveBeenCalledWith('accounting_sync_export_error', 'invoice', 'inv-heal');
  });

  it('drain: drift mapping reset and exception resolved after successful re-export', async () => {
    const pendingOps = [{ op_id: 'op-5', alga_entity_id: 'inv-drift', attempts: 0 }];

    const driftMapping = {
      id: 'map-drift',
      sync_status: 'drift',
      alga_entity_id: 'inv-drift'
    };

    const ledgerInstance = {
      findByExternalId: vi.fn(async () => undefined),
      findByAlgaId: vi.fn(async () => driftMapping),
      insert: vi.fn(async () => ({})),
      update: vi.fn(async () => undefined),
      withKnex: vi.fn().mockReturnThis()
    };

    vi.mocked(SyncMappingLedger).mockImplementationOnce(function () { return ledgerInstance as any; });

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_invoice' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-drift' } }))
    } as any); });

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValueOnce({
      executeBatch: vi.fn(async () => undefined)
    } as any);

    const exceptions = makeFakeExceptions();

    await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    expect(ledgerInstance.update).toHaveBeenCalledWith(
      'map-drift',
      expect.objectContaining({ syncStatus: 'synced' })
    );
    expect(exceptions.resolve).toHaveBeenCalledWith('accounting_sync_drift', 'invoice', 'inv-drift');
  });

  it('drain includes export_credit_memo ops in the same batch as export_invoice ops', async () => {
    // Mix of invoice and credit_memo ops
    const invoiceOp = { op_id: 'op-inv-10', alga_entity_id: 'inv-10', attempts: 0 };
    const creditMemoOp = { op_id: 'op-cm-10', alga_entity_id: 'inv-cm-10', attempts: 0 };

    // listPending is called once per outbound operation type; only invoice/credit-memo have ops here.
    const listPending = vi.fn(async () => [] as any[])
      .mockResolvedValueOnce([invoiceOp])      // export_invoice call
      .mockResolvedValueOnce([creditMemoOp]);  // export_credit_memo call

    const markDone = vi.fn(async () => undefined);

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return ({
      listPending,
      markInProgress: vi.fn(async () => undefined),
      markDone,
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any); });

    const createBatchFromFilters = vi.fn(async () => ({ batch: { batch_id: 'batch-mixed' } }));
    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(function () { return ({
      createBatchFromFilters
    } as any); });

    const executeBatch = vi.fn(async () => undefined);
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValueOnce({ executeBatch } as any);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    // Both op types should be in the same createBatchFromFilters call
    expect(createBatchFromFilters).toHaveBeenCalledTimes(1);
    expect(createBatchFromFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          invoiceIds: expect.arrayContaining(['inv-10', 'inv-cm-10'])
        })
      })
    );

    // Both ops marked done
    expect(markDone).toHaveBeenCalledTimes(2);
    expect(result.stats?.opsProcessed).toBe(2);

    // drainApplyCreditOps should also have been called (credit application drain)
    expect(vi.mocked(drainApplyCreditOps)).toHaveBeenCalled();
  });

  it('void-invoice drain: drainVoidInvoiceOps is called each cycle', async () => {
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(vi.mocked(drainVoidInvoiceOps)).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  it('void-invoice drain error is swallowed and cycle still succeeds', async () => {
    vi.mocked(drainVoidInvoiceOps).mockRejectedValueOnce(new Error('void drain exploded'));

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(result.status).toBe('succeeded');
  });

  it('record_payment drain: drainRecordPaymentOps is called each cycle', async () => {
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(vi.mocked(drainRecordPaymentOps)).toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  it('record_payment drain error is swallowed and cycle still succeeds', async () => {
    vi.mocked(drainRecordPaymentOps).mockRejectedValueOnce(new Error('payment push drain exploded'));

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(result.status).toBe('succeeded');
  });

  // ── Vendor bill drain (draft→open auto-queue is drained here) ─────────────

  function makeVendorBillOpsRepo(pendingOps: any[], overrides: Record<string, any> = {}) {
    const repo = {
      listPending: vi.fn(async (_t: string, _a: string, opts: any) =>
        opts?.operation === 'export_vendor_bill' ? pendingOps : []),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      markFailedTerminal: vi.fn(async () => 'failed'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({})),
      ...overrides
    };
    vi.mocked(SyncOperationsRepository).mockImplementationOnce(function () { return repo as any; });
    return repo;
  }

  function restoreExportServiceDefault() {
    vi.mocked(AccountingExportService.createForTenant).mockReset();
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      executeBatch: vi.fn(async () => undefined)
    } as any);
  }

  it('vendor-bill drain: queued export_vendor_bill ops → scheduled vendor_bill batch with document lines → executeBatch → ops done', async () => {
    const repo = makeVendorBillOpsRepo([
      { op_id: 'op-vb-1', alga_entity_id: 'bill-1', attempts: 0 },
      { op_id: 'op-vb-2', alga_entity_id: 'bill-2', attempts: 0 }
    ]);

    tenantDbMock.mockImplementation(() => makeVendorBillDb([
      { bill_id: 'bill-1', bill_number: 'VB-001', total_amount: 12345, currency_code: 'USD' },
      { bill_id: 'bill-2', bill_number: 'VB-002', total_amount: '6789', currency_code: null }
    ]));

    const createBatch = vi.fn(async () => ({ batch_id: 'batch-vb' }));
    const appendLines = vi.fn(async () => undefined);
    const executeBatch = vi.fn(async () => undefined);
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      createBatch,
      appendLines,
      executeBatch
    } as any);

    const exceptions = makeFakeExceptions();
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      adapter_type: 'quickbooks_online',
      target_realm: REALM,
      export_type: 'vendor_bill',
      origin: 'scheduled',
      filters: { billIds: ['bill-1', 'bill-2'] }
    }));
    expect(appendLines).toHaveBeenCalledWith('batch-vb', {
      lines: [
        expect.objectContaining({
          document_id: 'bill-1',
          document_line_id: null,
          amount_cents: 12345,
          currency_code: 'USD',
          payload: { document_number: 'VB-001', document_kind: 'vendor_bill' }
        }),
        expect.objectContaining({
          document_id: 'bill-2',
          amount_cents: 6789,
          // null currency falls back to USD
          currency_code: 'USD',
          payload: { document_number: 'VB-002', document_kind: 'vendor_bill' }
        })
      ]
    });
    expect(executeBatch).toHaveBeenCalledWith('batch-vb');
    expect(repo.markDone).toHaveBeenCalledTimes(2);
    expect(result.stats?.opsProcessed).toBe(2);
    // A successful export clears any earlier vendor-bill export-error exception.
    expect(exceptions.resolve).toHaveBeenCalledWith('accounting_sync_export_error', 'vendor_bill', 'bill-1');
    expect(result.status).toBe('succeeded');

    restoreExportServiceDefault();
  });

  it('vendor-bill drain: already-mapped bill → op done without creating a batch (idempotency)', async () => {
    const repo = makeVendorBillOpsRepo([{ op_id: 'op-vb-mapped', alga_entity_id: 'bill-mapped', attempts: 0 }]);

    vi.mocked(SyncMappingLedger).mockImplementationOnce(function () { return ({
      findByExternalId: vi.fn(async () => undefined),
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) =>
        entityType === 'vendor_bill' && entityId === 'bill-mapped'
          ? { id: 'map-1', sync_status: 'synced' }
          : undefined),
      insert: vi.fn(async () => ({})),
      update: vi.fn(async () => undefined),
      withKnex: vi.fn().mockReturnThis()
    } as any); });

    const createBatch = vi.fn(async () => ({ batch_id: 'batch-should-not-exist' }));
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      createBatch,
      appendLines: vi.fn(async () => undefined),
      executeBatch: vi.fn(async () => undefined)
    } as any);

    const exceptions = makeFakeExceptions();
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    expect(createBatch).not.toHaveBeenCalled();
    expect(repo.markDone).toHaveBeenCalledWith(TENANT, 'op-vb-mapped');
    expect(exceptions.resolve).toHaveBeenCalledWith('accounting_sync_export_error', 'vendor_bill', 'bill-mapped');
    expect(result.stats?.opsProcessed).toBe(1);

    restoreExportServiceDefault();
  });

  it('vendor-bill drain: validation failure → op terminally failed with actionable message + vendor_bill exception + batch auto-cancelled', async () => {
    const repo = makeVendorBillOpsRepo([{ op_id: 'op-vb-val', alga_entity_id: 'bill-val', attempts: 0 }]);

    tenantDbMock.mockImplementation(() => makeVendorBillDb([
      { bill_id: 'bill-val', bill_number: 'VB-VAL', total_amount: 5000, currency_code: 'USD' }
    ]));

    const cancelBatch = vi.fn(async () => ({ batch_id: 'batch-vb-val', status: 'cancelled' }));
    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      createBatch: vi.fn(async () => ({ batch_id: 'batch-vb-val' })),
      appendLines: vi.fn(async () => undefined),
      executeBatch: vi.fn(async () => {
        throw new AppError('ACCOUNTING_EXPORT_VALIDATION_FAILED', 'batch not ready', {
          batchId: 'batch-vb-val',
          status: 'needs_attention',
          validationErrors: [{
            code: 'QBO_VENDOR_BILL_EXPENSE_ACCOUNT_REQUIRED',
            message: 'Set a default expense account in accounting sync settings'
          }]
        });
      }),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-vb-val', status: 'needs_attention', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch
    } as any);

    const exceptions = makeFakeExceptions();
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    // Validation failures are deterministic → terminal failure, not the retry cap.
    expect(repo.markFailedTerminal).toHaveBeenCalledWith(TENANT, 'op-vb-val', expect.stringContaining('batch not ready'));
    expect(repo.markFailed).not.toHaveBeenCalled();
    // The failed op's message is the actionable surface the UI badge shows.
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_export_error',
        entityType: 'vendor_bill',
        entityId: 'bill-val',
        title: 'Scheduled vendor bill export failed validation',
        context: expect.objectContaining({
          details: expect.stringContaining('QBO_VENDOR_BILL_EXPENSE_ACCOUNT_REQUIRED')
        })
      })
    );
    // The wedged scheduled batch is cancelled so a later retry can recreate it.
    expect(cancelBatch).toHaveBeenCalledWith('batch-vb-val', expect.anything());
    expect(result.stats?.opsFailed).toBe(1);
    expect(result.status).toBe('succeeded');

    restoreExportServiceDefault();
  });

  it('vendor-bill drain: transient failure → op marked failed (retryable), no exception before the attempts cap', async () => {
    const repo = makeVendorBillOpsRepo([{ op_id: 'op-vb-net', alga_entity_id: 'bill-net', attempts: 0 }]);

    tenantDbMock.mockImplementation(() => makeVendorBillDb([
      { bill_id: 'bill-net', bill_number: 'VB-NET', total_amount: 100, currency_code: 'USD' }
    ]));

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      createBatch: vi.fn(async () => ({ batch_id: 'batch-vb-net' })),
      appendLines: vi.fn(async () => undefined),
      executeBatch: vi.fn(async () => { throw new Error('socket hang up'); }),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-vb-net', status: 'failed', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch: vi.fn(async () => ({}))
    } as any);

    const exceptions = makeFakeExceptions();
    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions,
      notifications: makeFakeNotifications()
    });

    expect(repo.markFailed).toHaveBeenCalledWith(TENANT, 'op-vb-net', expect.stringContaining('socket hang up'));
    expect(repo.markFailedTerminal).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(result.stats?.opsFailed).toBe(1);
    expect(result.status).toBe('succeeded');

    restoreExportServiceDefault();
  });

  it('vendor-bill drain: ACCOUNTING_EXPORT_EMPTY_BATCH → ops marked done (already exported elsewhere)', async () => {
    const repo = makeVendorBillOpsRepo([{ op_id: 'op-vb-empty', alga_entity_id: 'bill-empty', attempts: 0 }]);

    tenantDbMock.mockImplementation(() => makeVendorBillDb([
      { bill_id: 'bill-empty', bill_number: 'VB-EMPTY', total_amount: 100, currency_code: 'USD' }
    ]));

    vi.mocked(AccountingExportService.createForTenant).mockResolvedValue({
      createBatch: vi.fn(async () => ({ batch_id: 'batch-vb-empty' })),
      appendLines: vi.fn(async () => undefined),
      executeBatch: vi.fn(async () => {
        throw new AppError('ACCOUNTING_EXPORT_EMPTY_BATCH', 'nothing to export');
      }),
      getBatchWithDetails: vi.fn(async () => ({
        batch: { batch_id: 'batch-vb-empty', status: 'pending', origin: 'scheduled' },
        lines: [],
        errors: []
      })),
      cancelBatch: vi.fn(async () => ({}))
    } as any);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER_TYPE,
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    expect(repo.markDone).toHaveBeenCalledWith(TENANT, 'op-vb-empty');
    expect(result.stats?.opsProcessed).toBe(1);
    expect(result.status).toBe('succeeded');

    restoreExportServiceDefault();
  });

  it('vendor-bill drain: adapter without vendor_bill capability (xero) never drains export_vendor_bill ops', async () => {
    const repo = makeVendorBillOpsRepo([{ op_id: 'op-vb-xero', alga_entity_id: 'bill-xero', attempts: 0 }]);

    const result = await runAccountingSyncCycle({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter: makeFakeAdapter(),
      exceptions: makeFakeExceptions(),
      notifications: makeFakeNotifications()
    });

    // The invoice drains still list their operations; the vendor-bill drain never runs.
    const vendorBillCalls = repo.listPending.mock.calls.filter(
      (call: any[]) => call[2]?.operation === 'export_vendor_bill'
    );
    expect(vendorBillCalls).toHaveLength(0);
    expect(repo.markInProgress).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });
});
