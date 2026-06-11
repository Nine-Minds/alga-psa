import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
vi.mock('./syncCycleRepository', () => ({
  SyncCycleRepository: vi.fn().mockImplementation(() => ({
    getLastSuccessfulCursor: vi.fn(async () => null),
    startCycle: vi.fn(async () => 'cycle-001'),
    finishCycle: vi.fn(async () => undefined)
  }))
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(() => ({
    listPending: vi.fn(async () => []),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => 'pending'),
    satisfyPending: vi.fn(async () => 0),
    enqueue: vi.fn(async () => ({}))
  }))
}));

vi.mock('./syncMappingLedger', () => ({
  SyncMappingLedger: vi.fn().mockImplementation(() => ({
    findByExternalId: vi.fn(async () => undefined),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn().mockReturnThis()
  }))
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
  getAccountingSyncSettings: vi.fn(async () => ({ autoSyncEnabled: true, autoSyncStartDate: null }))
}));

vi.mock('./syncExceptionService', () => ({
  WorkflowTaskSyncExceptionService: vi.fn().mockImplementation(() => ({
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  }))
}));

vi.mock('./syncNotificationService', () => ({
  DefaultSyncNotificationService: vi.fn().mockImplementation(() => ({
    notifyConnectionExpired: vi.fn(async () => undefined),
    notifyTokenExpiring: vi.fn(async () => undefined),
    notifyNewExceptions: vi.fn(async () => undefined)
  })),
  resolveTokenThresholdToAnnounce: vi.fn(async () => null)
}));

vi.mock('../accountingExportInvoiceSelector', () => ({
  AccountingExportInvoiceSelector: vi.fn().mockImplementation(() => ({
    createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-001' } }))
  }))
}));

vi.mock('../accountingExportService', () => ({
  AccountingExportService: {
    createForTenant: vi.fn(async () => ({
      executeBatch: vi.fn(async () => undefined)
    }))
  }
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
import { SyncMappingLedger } from './syncMappingLedger';

const TENANT = 'tenant-abc';
const REALM = 'realm-xyz';
const ADAPTER_TYPE = 'quickbooks_online';

function makeFakeAdapter(overrides: any = {}) {
  return {
    capabilities: vi.fn(() => ({ supportsChangePolling: true })),
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
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: true, autoSyncStartDate: null });
    vi.mocked(resolveTokenThresholdToAnnounce).mockResolvedValue(null);
  });

  it('skips when adapter does not support change polling', async () => {
    const adapter = { capabilities: vi.fn(() => ({ supportsChangePolling: false })), fetchChanges: undefined };
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
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null });

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
    vi.mocked(getAccountingSyncSettings).mockResolvedValue({ autoSyncEnabled: false, autoSyncStartDate: null });

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
    vi.mocked(SyncCycleRepository).mockImplementationOnce(() => ({
      getLastSuccessfulCursor: vi.fn(async () => storedCursor),
      startCycle: vi.fn(async () => 'cycle-002'),
      finishCycle: vi.fn(async () => undefined)
    } as any));

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
    vi.mocked(SyncCycleRepository).mockImplementationOnce(() => ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-003'),
      finishCycle: vi.fn(async (_tenant: string, _cycleId: string, result: any) => {
        finishCycleCall = result;
      })
    } as any));

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
    vi.mocked(SyncCycleRepository).mockImplementationOnce(() => ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-fail'),
      finishCycle: vi.fn(async (_t: string, _c: string, result: any) => {
        finishCall = result;
      })
    } as any));

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
    vi.mocked(SyncCycleRepository).mockImplementationOnce(() => ({
      getLastSuccessfulCursor: vi.fn(async () => null),
      startCycle: vi.fn(async () => 'cycle-auth'),
      finishCycle: vi.fn(async (_t: string, _c: string, result: any) => {
        finishCall = result;
      })
    } as any));

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
    const listPending = vi.fn(async () => pendingOps);
    const markInProgress = vi.fn(async () => undefined);

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(() => ({
      listPending,
      markInProgress,
      markDone,
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any));

    const createBatchFromFilters = vi.fn(async () => ({ batch: { batch_id: 'batch-drain' } }));
    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(() => ({
      createBatchFromFilters
    } as any));

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

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(() => ({
      listPending: vi.fn(async () => pendingOps),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any));

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(() => ({
      createBatchFromFilters: vi.fn(async () => {
        throw new AppError('ACCOUNTING_EXPORT_EMPTY_BATCH', 'nothing to export');
      })
    } as any));

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

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(() => ({
      listPending: vi.fn(async () => pendingOps),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed,
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any));

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(() => ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-fail' } }))
    } as any));

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

    vi.mocked(SyncMappingLedger).mockImplementationOnce(() => ledgerInstance as any);

    vi.mocked(SyncOperationsRepository).mockImplementationOnce(() => ({
      listPending: vi.fn(async () => pendingOps),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      satisfyPending: vi.fn(async () => 0),
      enqueue: vi.fn(async () => ({}))
    } as any));

    vi.mocked(AccountingExportInvoiceSelector).mockImplementationOnce(() => ({
      createBatchFromFilters: vi.fn(async () => ({ batch: { batch_id: 'batch-drift' } }))
    } as any));

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
});
