import { describe, expect, it, vi, beforeEach } from 'vitest';

// The legacy (no-adapter) path constructs a QBO client; the gated Xero path
// must never reach it.
const qboCreate = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: qboCreate }
}));

import { drainRecordPaymentOps } from './paymentPushApplier';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { drainVoidInvoiceOps } from './invoiceVoidApplier';

const TENANT = 'tenant-gate';
const REALM = 'conn-1';

const xeroAdapter = {
  type: 'xero',
  capabilities: () => ({
    deliveryMode: 'api',
    supportedExportTypes: ['invoice'],
    supportsPartialRetry: true,
    supportsInvoiceUpdates: true,
    supportsOutboundPayment: false,
    supportsOutboundCredit: false,
    supportsOutboundVoid: false
  })
} as any;

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

function makeOp(operation: string) {
  return {
    op_id: `op-${operation}`,
    tenant: TENANT,
    adapter_type: 'xero',
    target_realm: REALM,
    operation,
    alga_entity_type: operation === 'void_invoice' ? 'invoice' : 'invoice_payment',
    alga_entity_id: `${operation}-entity`,
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: null,
    created_at: new Date().toISOString(),
    processed_at: null
  };
}

function makeHarness(operation: string) {
  const markFailedTerminal = vi.fn(async () => 'failed');
  const exceptions = {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
  return {
    deps: {
      knex: {} as any,
      tenantId: TENANT,
      adapterType: 'xero',
      targetRealm: REALM,
      ops: {
        listPending: vi.fn(async () => [makeOp(operation)]),
        markInProgress: vi.fn(),
        markDone: vi.fn(),
        markFailed: vi.fn(),
        markFailedTerminal
      } as any,
      ledger: {} as any,
      exceptions: exceptions as any,
      stats: makeStats(),
      adapter: xeroAdapter
    },
    markFailedTerminal,
    exceptions
  };
}

describe('outbound capability gating for adapters without write support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gates Xero payment push: terminal op + observable exception, no QBO client', async () => {
    const { deps, markFailedTerminal, exceptions } = makeHarness('record_payment');
    await drainRecordPaymentOps(deps);

    expect(qboCreate).not.toHaveBeenCalled();
    expect(markFailedTerminal).toHaveBeenCalledWith(TENANT, 'op-record_payment', expect.any(String));
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_export_error',
        context: expect.objectContaining({ reason: 'outbound_operation_unsupported', adapter_type: 'xero' })
      })
    );
    expect(deps.stats.exceptionsCreated).toBe(1);
  });

  it('gates Xero credit application: terminal op + observable exception, no QBO client', async () => {
    const { deps, markFailedTerminal, exceptions } = makeHarness('apply_credit');
    await drainApplyCreditOps(deps);

    expect(qboCreate).not.toHaveBeenCalled();
    expect(markFailedTerminal).toHaveBeenCalledWith(TENANT, 'op-apply_credit', expect.any(String));
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'outbound_operation_unsupported' })
      })
    );
  });

  it('gates Xero invoice void: terminal op + observable exception, no QBO client', async () => {
    const { deps, markFailedTerminal, exceptions } = makeHarness('void_invoice');
    await drainVoidInvoiceOps(deps);

    expect(qboCreate).not.toHaveBeenCalled();
    expect(markFailedTerminal).toHaveBeenCalledWith(TENANT, 'op-void_invoice', expect.any(String));
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'outbound_operation_unsupported' })
      })
    );
  });

  it('never falls back to QboClientService for a non-QBO adapter that claims a capability but exposes no providerOperations', async () => {
    const misconfiguredAdapter = {
      type: 'xero',
      capabilities: () => ({
        deliveryMode: 'api',
        supportedExportTypes: ['invoice'],
        supportsPartialRetry: true,
        supportsInvoiceUpdates: true,
        supportsOutboundPayment: true
      })
      // providerOperations intentionally absent
    } as any;
    const { deps, markFailedTerminal, exceptions } = makeHarness('record_payment');
    await drainRecordPaymentOps({ ...deps, adapter: misconfiguredAdapter });

    expect(qboCreate).not.toHaveBeenCalled();
    expect(markFailedTerminal).toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'outbound_operation_unsupported' })
      })
    );
  });
});
