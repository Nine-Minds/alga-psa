import { describe, expect, it, vi } from 'vitest';
import { applyExternalCustomerChange } from './customerApplier';
import { emptyCycleStats } from './accountingSync.types';
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
    entityType: 'Customer',
    externalId: 'cust-001',
    syncToken: '5',
    deleted: false,
    payload: { DisplayName: 'Acme Corp', Active: true },
    ...overrides
  };
}

describe('customerApplier', () => {
  it('unmapped customer is silently ignored', async () => {
    const ledger = makeFakeLedger(null);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalCustomerChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange()
    );

    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(stats.customersUpdated).toBe(0);
    expect(stats.exceptionsCreated).toBe(0);
  });

  it('deleted mapped customer creates accounting_sync_customer_unlinked exception', async () => {
    const existing = {
      id: 'map-1',
      alga_entity_id: 'client-abc',
      external_entity_id: 'cust-001',
      metadata: { display_name: 'Acme Corp' }
    };
    const ledger = makeFakeLedger(existing);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalCustomerChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ deleted: true })
    );

    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_customer_unlinked' })
    );
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('Active=false triggers exception as "inactive" reason', async () => {
    const existing = {
      id: 'map-1',
      alga_entity_id: 'client-abc',
      external_entity_id: 'cust-001',
      metadata: { display_name: 'Acme Corp' }
    };
    const ledger = makeFakeLedger(existing);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalCustomerChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ payload: { DisplayName: 'Acme Corp', Active: false } })
    );

    const call = exceptions.createOrUpdate.mock.calls[0][0];
    expect(call.context.reason).toBe('inactive');
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('rename updates display_name in ledger metadata', async () => {
    const existing = {
      id: 'map-1',
      alga_entity_id: 'client-abc',
      external_entity_id: 'cust-001',
      metadata: { display_name: 'Old Name' }
    };
    const ledger = makeFakeLedger(existing);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalCustomerChange(
      { tenantId: 't1', targetRealm: 'r1', ledger: ledger as any, exceptions, stats },
      makeChange({ payload: { DisplayName: 'New Name', Active: true } })
    );

    expect(ledger.update).toHaveBeenCalledWith(
      'map-1',
      expect.objectContaining({ metadata: expect.objectContaining({ display_name: 'New Name' }) })
    );
    expect(stats.customersUpdated).toBe(1);
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });
});
