import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../actions/_dbTestUtils';

// Ledger-level suite: normalized Xero payment idempotency, reversal and
// realm-isolation against the real mapping ledger. The end-to-end
// export → poll → apply flow (real invoice_payments/transactions, balances,
// cursor persistence, real allocation query) is covered by
// server/src/test/integration/accounting/xeroInboundReconciliation.integration.test.ts.
const recordExternalPaymentMock = vi.hoisted(() => vi.fn());
const reverseExternalPaymentMock = vi.hoisted(() => vi.fn());

vi.mock('./recordExternalPayment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordExternalPayment')>()),
  recordExternalPayment: recordExternalPaymentMock,
  reverseExternalPayment: reverseExternalPaymentMock
}));

// Stored Xero connections for historical org-keyed mapping compatibility.
const xeroConnectionsState = vi.hoisted(() => ({
  value: {
    'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: 'org-1' }
  } as Record<string, { connectionId: string; xeroTenantId: string }>
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => xeroConnectionsState.value
}));

import { applyExternalPaymentChange } from './paymentApplier';
import { SyncMappingLedger } from './syncMappingLedger';

const tenantId = uuidv4();
const REALM = 'xero-conn-1';
const OTHER_REALM = 'xero-conn-2';
const INVOICE_MAPPING_ID = uuidv4();

let db: Knex;

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

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

function xeroPaymentChange(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'Payment' as const,
    externalId: 'xero-pay-1',
    syncToken: 'updated-1',
    deleted: false,
    normalized: {
      reference: 'STRIPE-1',
      txnDate: '2026-01-10T00:00:00Z',
      totalCents: 5000,
      allocations: [{ externalInvoiceId: 'xero-inv-1', amountCents: 5000 }],
      isCreditApplication: false,
      providerMetadata: { xero_status: 'AUTHORISED' }
    },
    ...overrides
  };
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Xero Reconciliation Test',
    email: `xero-recon-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('tenant_external_entity_mappings').insert({
    id: INVOICE_MAPPING_ID,
    tenant: tenantId,
    integration_type: 'xero',
    alga_entity_type: 'invoice',
    alga_entity_id: uuidv4(),
    external_entity_id: 'xero-inv-1',
    external_realm_id: REALM,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

beforeEach(async () => {
  recordExternalPaymentMock.mockReset();
  recordExternalPaymentMock.mockResolvedValue({ success: true, paymentRecorded: true, paymentId: uuidv4() });
  reverseExternalPaymentMock.mockReset();
  reverseExternalPaymentMock.mockResolvedValue({ success: true });
  await db('tenant_external_entity_mappings')
    .where({ tenant: tenantId, integration_type: 'xero', alga_entity_type: 'invoice_payment' })
    .del();
});

function makeDeps() {
  return {
    knex: db,
    tenantId,
    adapterType: 'xero',
    targetRealm: REALM,
    ledger: new SyncMappingLedger(db, tenantId, 'xero'),
    exceptions: makeExceptions(),
    stats: makeStats()
  };
}

describe('Xero normalized payment reconciliation (DB-backed)', () => {
  it('applies an external payment once and records a Xero-provider mapping', async () => {
    const deps = makeDeps();
    await applyExternalPaymentChange(deps, xeroPaymentChange() as any);

    expect(recordExternalPaymentMock).toHaveBeenCalledTimes(1);
    expect(recordExternalPaymentMock).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      expect.objectContaining({ provider: 'xero', referenceNumber: 'STRIPE-1' })
    );

    const mapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, integration_type: 'xero', alga_entity_type: 'invoice_payment' })
      .first();
    expect(mapping).toBeTruthy();
    expect(mapping.external_realm_id).toBe(REALM);
    expect(mapping.metadata.sync_token).toBe('updated-1');
    expect(mapping.metadata.xero_status).toBe('AUTHORISED');
  });

  it('replaying the same change is a no-op (no duplicate financial effect)', async () => {
    const deps = makeDeps();
    await applyExternalPaymentChange(deps, xeroPaymentChange() as any);
    recordExternalPaymentMock.mockClear();

    await applyExternalPaymentChange(deps, xeroPaymentChange() as any);

    expect(recordExternalPaymentMock).not.toHaveBeenCalled();
    expect(deps.stats.paymentsSkipped).toBe(1);
  });

  it('reverses the recorded allocation when the external payment is deleted', async () => {
    const deps = makeDeps();
    await applyExternalPaymentChange(deps, xeroPaymentChange() as any);

    await applyExternalPaymentChange(deps, xeroPaymentChange({ deleted: true }) as any);

    expect(reverseExternalPaymentMock).toHaveBeenCalledTimes(1);
    const mapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, integration_type: 'xero', alga_entity_type: 'invoice_payment' })
      .first();
    expect(mapping.sync_status).toBe('reversed');
    expect(mapping.metadata.deleted).toBe(true);
    expect(deps.stats.paymentsReversed).toBe(1);
  });

  it('does not apply a payment whose invoice mapping lives in another realm', async () => {
    const deps = { ...makeDeps(), targetRealm: OTHER_REALM };
    await applyExternalPaymentChange(deps, xeroPaymentChange() as any);

    expect(recordExternalPaymentMock).not.toHaveBeenCalled();
    expect(deps.stats.unmappedIgnored).toBe(1);
    expect(deps.exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_unmapped_payment' })
    );
  });

  it('records a synthesized credit allocation as a credit application', async () => {
    const deps = makeDeps();
    await applyExternalPaymentChange(
      deps,
      xeroPaymentChange({
        externalId: 'creditnote:cn-1:xero-inv-1',
        syncToken: 'updated-cn-1:5000',
        normalized: {
          reference: 'Xero credit note CN-0001',
          totalCents: 5000,
          allocations: [{ externalInvoiceId: 'xero-inv-1', amountCents: 5000 }],
          isCreditApplication: true,
          providerMetadata: { xero_credit_note_id: 'cn-1' }
        }
      }) as any
    );

    expect(recordExternalPaymentMock).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      expect.objectContaining({ provider: 'xero', notes: expect.stringContaining('Xero credit applied') })
    );

    const mapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantId, integration_type: 'xero', alga_entity_type: 'invoice_payment' })
      .first();
    expect(mapping.metadata.xero_credit_note_id).toBe('cn-1');
  });

  it('reconciles a payment against a historical organisation-keyed invoice mapping', async () => {
    const historicalInvoiceId = uuidv4();
    await db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: tenantId,
      integration_type: 'xero',
      alga_entity_type: 'invoice',
      alga_entity_id: historicalInvoiceId,
      external_entity_id: 'xero-inv-org-keyed',
      // Persisted before the identity was unified: the organisation id, not
      // the connection id.
      external_realm_id: 'org-1',
      sync_status: 'synced',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const deps = makeDeps();
    await applyExternalPaymentChange(
      deps,
      xeroPaymentChange({
        externalId: 'xero-pay-org-keyed',
        allocations: [{ externalInvoiceId: 'xero-inv-org-keyed', amountCents: 5000 }]
      }) as any
    );

    expect(recordExternalPaymentMock).toHaveBeenCalledTimes(1);
  });
});
