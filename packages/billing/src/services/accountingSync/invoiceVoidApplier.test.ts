import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
const qboReadMock = vi.hoisted(() => vi.fn());
const qboVoidMock = vi.hoisted(() => vi.fn());
const qboDeleteCreditMemoMock = vi.hoisted(() => vi.fn());
const writeAccountingAuditMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({
      read: qboReadMock,
      voidInvoice: qboVoidMock,
      deleteCreditMemo: qboDeleteCreditMemoMock
    }))
  }
}));

vi.mock('@alga-psa/db', () => ({
  writeAccountingAudit: writeAccountingAuditMock
}));

import { drainVoidInvoiceOps } from './invoiceVoidApplier';
import { MAPPING_SYNC_STATUS } from './accountingSync.types';

const TENANT = 'tenant-void-applier';
const ADAPTER = 'quickbooks_online';
const REALM = 'realm-void-applier';

function makeOps(overrides: any = {}) {
  return {
    listPending: vi.fn(async () => []),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => 'pending'),
    enqueue: vi.fn(async () => ({})),
    ...overrides
  };
}

function makeLedger(overrides: any = {}) {
  return {
    findByAlgaId: vi.fn(async () => undefined),
    findByExternalId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn().mockReturnThis(),
    ...overrides
  };
}

function makeExceptions(overrides: any = {}) {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined),
    ...overrides
  };
}

function makeStats() {
  return {
    paymentsApplied: 0,
    paymentsReversed: 0,
    paymentsSkipped: 0,
    driftFound: 0,
    customersUpdated: 0,
    opsProcessed: 0,
    opsFailed: 0,
    unmappedIgnored: 0,
    exceptionsCreated: 0,
    refundReceiptsSeen: 0,
    truncated: false
  };
}

function makePendingOp(overrides: any = {}) {
  return {
    op_id: 'op-void-1',
    tenant: TENANT,
    adapter_type: ADAPTER,
    target_realm: REALM,
    operation: 'void_invoice',
    alga_entity_type: 'invoice',
    alga_entity_id: 'inv-1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: { requestedByUserId: 'user-voiding-1' },
    created_at: new Date().toISOString(),
    processed_at: null,
    ...overrides
  };
}

const MAPPING = {
  id: 'map-1',
  alga_entity_type: 'invoice',
  alga_entity_id: 'inv-1',
  external_entity_id: 'qbo-inv-9',
  external_realm_id: REALM,
  sync_status: MAPPING_SYNC_STATUS.synced,
  metadata: null
};

interface VoidAuditParams {
  userId?: string;
  provider: string;
  recordId?: string;
  details: Record<string, unknown>;
}

function auditCall(index = 0): { operation: string; params: VoidAuditParams } {
  const call = writeAccountingAuditMock.mock.calls[index];
  return {
    operation: String(call?.[2] ?? ''),
    params: (call?.[3] ?? {}) as VoidAuditParams,
  };
}

describe('drainVoidInvoiceOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no pending ops', async () => {
    const ops = makeOps({ listPending: vi.fn(async () => []) });

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger: makeLedger(),
      exceptions: makeExceptions(),
      stats: makeStats()
    });

    expect(writeAccountingAuditMock).not.toHaveBeenCalled();
    expect(qboVoidMock).not.toHaveBeenCalled();
  });

  it('voids the invoice in QBO and audits with the acting user, outcome voided', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });
    const ledger = makeLedger({ findByAlgaId: vi.fn(async () => MAPPING) });
    const stats = makeStats();

    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-inv-9', SyncToken: '3' });

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboVoidMock).toHaveBeenCalledWith('qbo-inv-9', '3');
    expect(ledger.update).toHaveBeenCalledWith('map-1', expect.objectContaining({ syncStatus: MAPPING_SYNC_STATUS.voided }));
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-void-1');
    expect(stats.opsProcessed).toBe(1);

    expect(writeAccountingAuditMock).toHaveBeenCalledTimes(1);
    const audit = auditCall();
    expect(audit.operation).toBe('accounting_remote_void');
    expect(audit.params.userId).toBe('user-voiding-1');
    expect(audit.params.provider).toBe('quickbooks_online');
    expect(audit.params.recordId).toBe('qbo-inv-9');
    expect(audit.params.details).toMatchObject({
      algaEntityId: 'inv-1',
      operation: 'void_invoice',
      outcome: 'voided',
      source: 'sync_cycle'
    });
    expect(JSON.stringify(audit.params.details)).not.toContain('accessToken');
    expect(JSON.stringify(audit.params.details)).not.toContain('refreshToken');
    expect(JSON.stringify(audit.params.details)).not.toContain('secret');
  });

  it('deletes a CreditMemo mapping and audits with the actor', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });
    const ledger = makeLedger({
      findByAlgaId: vi.fn(async () => ({
        ...MAPPING,
        external_entity_id: 'qbo-cm-9',
        metadata: { external_entity_type: 'CreditMemo' }
      }))
    });
    const stats = makeStats();

    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-9', SyncToken: '1' });

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboDeleteCreditMemoMock).toHaveBeenCalledWith('qbo-cm-9', '1');
    expect(writeAccountingAuditMock).toHaveBeenCalledTimes(1);
    expect(auditCall().params.userId).toBe('user-voiding-1');
  });

  it('legacy op without an actor payload audits with a system actor (no userId)', async () => {
    const op = makePendingOp({ payload: null });
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });
    const ledger = makeLedger({ findByAlgaId: vi.fn(async () => MAPPING) });
    const stats = makeStats();

    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-inv-9', SyncToken: '0' });

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(writeAccountingAuditMock).toHaveBeenCalledTimes(1);
    expect(auditCall().params.userId).toBeUndefined();
  });

  it('records a failed remote-void attempt with the same actor when QBO rejects', async () => {
    const op = makePendingOp();
    const markFailed = vi.fn(async () => 'pending');
    const ops = makeOps({ listPending: vi.fn(async () => [op]), markFailed });
    const ledger = makeLedger({ findByAlgaId: vi.fn(async () => MAPPING) });
    const stats = makeStats();

    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-inv-9', SyncToken: '3' });
    qboVoidMock.mockRejectedValueOnce(new Error('QBO said no'));

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(markFailed).toHaveBeenCalledWith(TENANT, 'op-void-1', 'QBO said no');
    expect(stats.opsFailed).toBe(1);
    expect(writeAccountingAuditMock).toHaveBeenCalledTimes(1);
    const params = auditCall().params;
    expect(params.userId).toBe('user-voiding-1');
    expect(params.details.outcome).toBe('failed');
    expect(params.details.error).toBe('QBO said no');
  });

  it('skips the audit only when the mapping is gone or already voided (no remote work)', async () => {
    const noMappingOp = makePendingOp({ alga_entity_id: 'inv-unmapped' });
    const voidedMappingOp = makePendingOp({ alga_entity_id: 'inv-voided' });
    const ops = makeOps({
      listPending: vi.fn(async () => [noMappingOp, voidedMappingOp])
    });
    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (_type: string, entityId: string) => {
        if (entityId === 'inv-voided') return { ...MAPPING, alga_entity_id: 'inv-voided', sync_status: MAPPING_SYNC_STATUS.voided };
        return undefined;
      })
    });
    const stats = makeStats();

    await drainVoidInvoiceOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboReadMock).not.toHaveBeenCalled();
    expect(writeAccountingAuditMock).not.toHaveBeenCalled();
    expect(stats.opsProcessed).toBe(2);
  });
});
