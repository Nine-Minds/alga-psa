import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
const qboCreateMock = vi.hoisted(() => vi.fn());
const qboReadMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({
      create: qboCreateMock,
      read: qboReadMock
    }))
  }
}));

import { drainApplyCreditOps } from './creditApplicationApplier';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';

const TENANT = 'tenant-applier';
const ADAPTER = 'quickbooks_online';
const REALM = 'realm-applier';

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

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
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
    op_id: 'op-apply-1',
    tenant: TENANT,
    adapter_type: ADAPTER,
    target_realm: REALM,
    operation: 'apply_credit',
    alga_entity_type: 'credit_allocation',
    alga_entity_id: 'alloc-1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: {
      creditNoteInvoiceId: 'inv-cn-1',
      targetInvoiceId: 'inv-target-1',
      amountCents: 10000
    },
    created_at: new Date().toISOString(),
    processed_at: null,
    ...overrides
  };
}

describe('drainApplyCreditOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no pending ops', async () => {
    const ops = makeOps({ listPending: vi.fn(async () => []) });
    const ledger = makeLedger();
    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(stats.opsProcessed).toBe(0);
  });

  it('both-mapped case: creates QBO Payment and inserts mapping', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });

    const creditMemoMapping = {
      id: 'map-cn',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-cn-1',
      external_entity_id: 'qbo-cm-42',
      metadata: null
    };
    const invoiceMapping = {
      id: 'map-inv',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-target-1',
      external_entity_id: 'qbo-inv-99',
      metadata: null
    };

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        if (entityId === 'inv-cn-1') return creditMemoMapping;
        if (entityId === 'inv-target-1') return invoiceMapping;
        return undefined;
      })
    });

    // First read: CreditMemo balance check (full credit still available)
    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-42', Balance: 100 });
    // Second read: the invoice with CustomerRef
    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-inv-99', CustomerRef: { value: 'customer-77' } });
    // QBO create returns a Payment with Id
    qboCreateMock.mockResolvedValueOnce({ Id: 'qbo-payment-1' });

    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboCreateMock).toHaveBeenCalledWith(
      'Payment',
      expect.objectContaining({
        CustomerRef: { value: 'customer-77' },
        TotalAmt: 0,
        Line: expect.arrayContaining([
          expect.objectContaining({ LinkedTxn: [{ TxnId: 'qbo-inv-99', TxnType: 'Invoice' }] }),
          expect.objectContaining({ LinkedTxn: [{ TxnId: 'qbo-cm-42', TxnType: 'CreditMemo' }] })
        ])
      })
    );

    expect(ledger.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityType: 'credit_application',
        algaEntityId: 'alloc-1',
        externalEntityId: 'qbo-payment-1'
      })
    );

    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-apply-1');
    expect(stats.opsProcessed).toBe(1);
  });

  it('missing CreditMemo mapping → leaves op pending without incrementing attempts', async () => {
    const op = makePendingOp();
    const markFailed = vi.fn(async () => 'pending');
    const ops = makeOps({ listPending: vi.fn(async () => [op]), markFailed });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        // CreditMemo mapping missing, invoice mapping present
        if (entityId === 'inv-target-1') {
          return { id: 'map-inv', external_entity_id: 'qbo-inv-99', metadata: null };
        }
        return undefined;
      })
    });

    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    // Should NOT call markFailed (leaves pending without burning attempts)
    expect(markFailed).not.toHaveBeenCalled();
    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(stats.opsProcessed).toBe(0);
    expect(stats.opsFailed).toBe(0);
  });

  it('missing Invoice mapping → leaves op pending without incrementing attempts', async () => {
    const op = makePendingOp();
    const markFailed = vi.fn(async () => 'pending');
    const ops = makeOps({ listPending: vi.fn(async () => [op]), markFailed });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        // Invoice mapping missing, CreditMemo mapping present
        if (entityId === 'inv-cn-1') {
          return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
        }
        return undefined;
      })
    });

    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(markFailed).not.toHaveBeenCalled();
    expect(qboCreateMock).not.toHaveBeenCalled();
  });

  it('idempotent re-run: existing credit_application mapping → marks done, no QBO call', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });

    // Existing mapping already exists for this allocation
    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string) => {
        if (entityType === 'credit_application') {
          return { id: 'map-ca', external_entity_id: 'qbo-payment-existing' };
        }
        return undefined;
      })
    });

    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-apply-1');
    expect(stats.opsProcessed).toBe(1);
  });

  it('uses CustomerRef from metadata when available, skipping QBO read', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        if (entityId === 'inv-cn-1') {
          return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
        }
        if (entityId === 'inv-target-1') {
          return {
            id: 'map-inv',
            external_entity_id: 'qbo-inv-99',
            // Customer ref stored in metadata
            metadata: { customerId: 'customer-from-meta' }
          };
        }
        return undefined;
      })
    });

    // CreditMemo balance check still runs; the customer read should not.
    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-42', Balance: 100 });
    qboCreateMock.mockResolvedValueOnce({ Id: 'qbo-payment-2' });
    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions: makeExceptions(),
      stats
    });

    // Should NOT have read the Invoice because customerId was in metadata
    expect(qboReadMock).toHaveBeenCalledTimes(1);
    expect(qboReadMock).toHaveBeenCalledWith('CreditMemo', 'qbo-cm-42');
    expect(qboCreateMock).toHaveBeenCalledWith(
      'Payment',
      expect.objectContaining({ CustomerRef: { value: 'customer-from-meta' } })
    );
  });

  it('QBO already consumed the credit (auto-apply race) → exception filed, no payment pushed', async () => {
    const op = makePendingOp(); // applies 10000 cents
    const markFailed = vi.fn(async () => 'pending');
    const ops = makeOps({ listPending: vi.fn(async () => [op]), markFailed });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        if (entityId === 'inv-cn-1') {
          return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
        }
        if (entityId === 'inv-target-1') {
          return { id: 'map-inv', external_entity_id: 'qbo-inv-99', metadata: { customerId: 'customer-77' } };
        }
        return undefined;
      })
    });

    // CM read shows QBO already spent the credit elsewhere (Balance 0 of $100)
    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-42', Balance: 0 });

    const exceptions = makeExceptions();
    const stats = makeStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions,
      stats
    });

    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_export_error',
        entityType: 'credit_allocation',
        entityId: 'alloc-1',
        context: expect.objectContaining({ reason: 'qbo_credit_already_consumed' })
      })
    );
    expect(markFailed).toHaveBeenCalled();
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('CM balance read failure → op retries later without pushing blind', async () => {
    const op = makePendingOp();
    const markFailed = vi.fn(async () => 'pending');
    const ops = makeOps({ listPending: vi.fn(async () => [op]), markFailed });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        if (entityId === 'inv-cn-1') {
          return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
        }
        if (entityId === 'inv-target-1') {
          return { id: 'map-inv', external_entity_id: 'qbo-inv-99', metadata: { customerId: 'customer-77' } };
        }
        return undefined;
      })
    });

    qboReadMock.mockRejectedValueOnce(new Error('rate limited'));

    const exceptions = makeExceptions();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions,
      stats: makeStats()
    });

    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });

  it('successful push resolves a previously filed conflict exception', async () => {
    const op = makePendingOp();
    const ops = makeOps({ listPending: vi.fn(async () => [op]) });

    const ledger = makeLedger({
      findByAlgaId: vi.fn(async (entityType: string, entityId: string) => {
        if (entityType === 'credit_application') return undefined;
        if (entityId === 'inv-cn-1') {
          return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
        }
        if (entityId === 'inv-target-1') {
          return { id: 'map-inv', external_entity_id: 'qbo-inv-99', metadata: { customerId: 'customer-77' } };
        }
        return undefined;
      })
    });

    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-42', Balance: 100 });
    qboCreateMock.mockResolvedValueOnce({ Id: 'qbo-payment-3' });

    const exceptions = makeExceptions();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops,
      ledger,
      exceptions,
      stats: makeStats()
    });

    expect(exceptions.resolve).toHaveBeenCalledWith('accounting_sync_export_error', 'credit_allocation', 'alloc-1');
  });
});
