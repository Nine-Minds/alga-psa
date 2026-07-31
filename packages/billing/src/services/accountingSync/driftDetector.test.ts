import { describe, expect, it, vi } from 'vitest';
// Hand-built change payloads keep these unit tests small. To verify against
// changes a real QBO would emit (voids, balance movement), generate them with
// the simulator in ./testing/qboSimulator.ts — see ./testing/README.md.
import { applyExternalDocumentChange } from './driftDetector';
import { emptyCycleStats, MAPPING_SYNC_STATUS } from './accountingSync.types';
import type { AccountingExternalChange } from '@alga-psa/types';

function makeFakeLedger(existing: any = null) {
  return {
    findByExternalId: vi.fn(async () => existing),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn().mockReturnThis()
  };
}

function makeFakeExceptions() {
  return {
    createOrUpdate: vi.fn(async (..._args: any[]) => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

function makeChange(overrides: Partial<AccountingExternalChange> = {}): AccountingExternalChange {
  return {
    entityType: 'Invoice',
    externalId: 'inv-ext-001',
    syncToken: '10',
    deleted: false,
    payload: { TotalAmt: 500.0, DocNumber: 'INV-100' },
    ...overrides
  };
}

function makeMapping(overrides: any = {}) {
  return {
    id: 'map-1',
    alga_entity_id: 'alga-inv-001',
    external_entity_id: 'inv-ext-001',
    sync_status: MAPPING_SYNC_STATUS.synced,
    metadata: { exported_total: 500.0, doc_number: 'INV-100', sync_token: '9' },
    ...overrides
  };
}

describe('driftDetector', () => {
  it('unmapped invoice is ignored (unmappedIgnored++)', async () => {
    const ledger = makeFakeLedger(null);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange()
    );

    expect(stats.unmappedIgnored).toBe(1);
    expect(stats.driftFound).toBe(0);
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });

  it('deleted invoice sets external_voided status and creates exception', async () => {
    const mapping = makeMapping();
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ deleted: true })
    );

    expect(ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ syncStatus: MAPPING_SYNC_STATUS.externalVoided })
    );
    expect(stats.driftFound).toBe(1);
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_drift' })
    );
  });

  it('same sync token → no-op (echo suppression)', async () => {
    const mapping = makeMapping({ metadata: { exported_total: 500, doc_number: 'INV-100', sync_token: '10' } });
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ syncToken: '10' })
    );

    expect(ledger.update).not.toHaveBeenCalled();
    expect(stats.driftFound).toBe(0);
  });

  it('token changed but total and doc number equal → token refresh only, no drift', async () => {
    const mapping = makeMapping();
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ syncToken: '11' }) // token changed; total+docnumber same
    );

    expect(ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ sync_token: '11' }),
        touchSyncedAt: true
      })
    );
    expect(stats.driftFound).toBe(0);
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });

  it('total changed → drift status + exception with alga_snapshot/external_observed', async () => {
    const mapping = makeMapping();
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ syncToken: '11', payload: { TotalAmt: 600.0, DocNumber: 'INV-100' } })
    );

    expect(ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ syncStatus: MAPPING_SYNC_STATUS.drift })
    );
    expect(stats.driftFound).toBe(1);
    const exCall = exceptions.createOrUpdate.mock.calls[0][0];
    expect(exCall.context.alga_snapshot).toBeDefined();
    expect(exCall.context.external_observed).toBeDefined();
    expect(exCall.context.drift_kind).toBe('total_changed');
  });

  it('deleted invoice with externalVoided status → no-op (already voided externally)', async () => {
    const mapping = makeMapping({ sync_status: MAPPING_SYNC_STATUS.externalVoided });
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ deleted: true })
    );

    expect(ledger.update).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(stats.driftFound).toBe(0);
  });

  it('deleted invoice with voided status → no-op (already voided locally)', async () => {
    const mapping = makeMapping({ sync_status: MAPPING_SYNC_STATUS.voided });
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ deleted: true })
    );

    expect(ledger.update).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(stats.driftFound).toBe(0);
  });

  it('doc number changed → drift status + exception drift_kind=doc_number_changed', async () => {
    const mapping = makeMapping();
    const ledger = makeFakeLedger(mapping);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalDocumentChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ syncToken: '11', payload: { TotalAmt: 500.0, DocNumber: 'INV-999' } })
    );

    expect(stats.driftFound).toBe(1);
    const exCall = exceptions.createOrUpdate.mock.calls[0][0];
    expect(exCall.context.drift_kind).toBe('doc_number_changed');
  });
});
