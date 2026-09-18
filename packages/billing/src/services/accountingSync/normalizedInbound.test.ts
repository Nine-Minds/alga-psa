import { describe, expect, it, vi } from 'vitest';
import { applyExternalDocumentChange } from './driftDetector';
import { isNormalizedDocumentPayload, isNormalizedPaymentPayload, providerForAdapterType } from './normalizedChange';

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

function makeDeps(mappingOverrides: Record<string, unknown> = {}) {
  const mapping = {
    id: 'map-1',
    alga_entity_id: 'inv-alga-1',
    external_entity_id: 'ext-1',
    sync_status: 'synced',
    metadata: { exported_total: 100, doc_number: 'INV-1', sync_token: '1' },
    ...mappingOverrides
  };
  const ledger = {
    findByExternalId: vi.fn(async () => mapping),
    update: vi.fn(async () => undefined)
  };
  const exceptions = {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
  return { ledger, exceptions };
}

describe('provider-neutral inbound change contracts', () => {
  it('guards normalized payloads by shape', () => {
    expect(isNormalizedPaymentPayload({ allocations: [], isCreditApplication: false })).toBe(true);
    expect(isNormalizedPaymentPayload({ totalAmount: 1, docNumber: 'x', isVoided: false })).toBe(false);
    expect(isNormalizedDocumentPayload({ totalAmount: 1, docNumber: 'x', isVoided: false })).toBe(true);
    expect(isNormalizedDocumentPayload({ allocations: [] })).toBe(false);
  });

  it('maps adapter types to provider identifiers', () => {
    expect(providerForAdapterType('quickbooks_online')).toBe('quickbooks');
    expect(providerForAdapterType('xero')).toBe('xero');
  });

  it('detects total drift from a normalized document payload (no QBO shape)', async () => {
    const deps = makeDeps();
    await applyExternalDocumentChange(
      { tenantId: 't', targetRealm: 'r', adapterType: 'xero', ledger: deps.ledger as any, exceptions: deps.exceptions as any, stats: makeStats() },
      {
        entityType: 'Invoice',
        externalId: 'ext-1',
        syncToken: '2',
        deleted: false,
        normalized: { totalAmount: 200, docNumber: 'INV-1', isVoided: false, providerMetadata: { xero_status: 'AUTHORISED' } }
      } as any
    );

    expect(deps.ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ syncStatus: 'drift' })
    );
    expect(deps.exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_drift',
        context: expect.objectContaining({ drift_kind: 'total_changed' })
      })
    );
  });

  it('treats a normalized isVoided document as an external void', async () => {
    const deps = makeDeps();
    await applyExternalDocumentChange(
      { tenantId: 't', targetRealm: 'r', adapterType: 'xero', ledger: deps.ledger as any, exceptions: deps.exceptions as any, stats: makeStats() },
      {
        entityType: 'Invoice',
        externalId: 'ext-1',
        syncToken: '2',
        deleted: false,
        normalized: { totalAmount: 0, docNumber: null, isVoided: true }
      } as any
    );

    expect(deps.ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ syncStatus: 'external_voided' })
    );
  });

  it('adopts the first observed document as the baseline for legacy mappings instead of ignoring it', async () => {
    const deps = makeDeps({ metadata: { invoiceNumber: 'XERO-INV-OLD' } });
    await applyExternalDocumentChange(
      { tenantId: 't', targetRealm: 'r', adapterType: 'xero', ledger: deps.ledger as any, exceptions: deps.exceptions as any, stats: makeStats() },
      {
        entityType: 'Invoice',
        externalId: 'ext-1',
        syncToken: '2',
        deleted: false,
        normalized: { totalAmount: 200, docNumber: 'XERO-INV-OLD', isVoided: false }
      } as any
    );

    expect(deps.exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(deps.ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          exported_total: 200,
          doc_number: 'XERO-INV-OLD',
          sync_token: '2'
        })
      })
    );
  });

  it('refreshes the token without drift when only the sync token moved', async () => {    const deps = makeDeps();
    await applyExternalDocumentChange(
      { tenantId: 't', targetRealm: 'r', adapterType: 'xero', ledger: deps.ledger as any, exceptions: deps.exceptions as any, stats: makeStats() },
      {
        entityType: 'Invoice',
        externalId: 'ext-1',
        syncToken: '2',
        deleted: false,
        normalized: { totalAmount: 100, docNumber: 'INV-1', isVoided: false }
      } as any
    );

    expect(deps.exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(deps.ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ metadata: expect.objectContaining({ sync_token: '2' }) })
    );
  });
});
