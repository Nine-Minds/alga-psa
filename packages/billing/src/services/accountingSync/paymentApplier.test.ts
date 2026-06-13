import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock recordExternalPayment/reverseExternalPayment before importing the module under test
vi.mock('./recordExternalPayment', () => ({
  recordExternalPayment: vi.fn(async () => ({ success: true, paymentId: 'pay-1', paymentRecorded: true })),
  reverseExternalPayment: vi.fn(async () => ({ success: true, paymentId: 'rev-1', paymentRecorded: true })),
  isNonPayableInvoiceStatus: (status: string | null | undefined) =>
    status === 'cancelled' || status === 'draft' || status === 'void',
  computeBalanceDue: vi.fn(
    ({ totalAmount, creditApplied, totalPaid }: { totalAmount: number; creditApplied: number; totalPaid: number }) =>
      totalAmount - creditApplied - totalPaid
  )
}));

import { applyExternalPaymentChange } from './paymentApplier';
import { emptyCycleStats } from './accountingSync.types';
import type { AccountingExternalChange } from '@alga-psa/types';
import { recordExternalPayment, reverseExternalPayment } from './recordExternalPayment';

function makeFakeLedger(existing: any = null) {
  const ledger: any = {
    findByExternalId: vi.fn(async (entityType?: string) => (entityType === 'credit_application' ? null : existing)),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn()
  };
  // withKnex returns a new ledger-like object that shares insert/update
  ledger.withKnex.mockImplementation(() => ({
    insert: ledger.insert,
    update: ledger.update,
    findByExternalId: ledger.findByExternalId,
    findByAlgaId: ledger.findByAlgaId,
    withKnex: ledger.withKnex
  }));
  return ledger;
}

function makeFakeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

/** knex.transaction that immediately calls the callback with itself.
 *  Also handles table queries — defaults to returning a 'sent' (non-settled) invoice
 *  so the double-entry guard passes through in normal tests.
 */
function makeFakeKnex(invoiceRow: any = { status: 'sent', total_amount: 20000, credit_applied: 0 }) {
  const first = vi.fn(async () => invoiceRow);
  const select = vi.fn(() => ({ first }));
  const where = vi.fn(() => ({ select, first }));
  const trx: any = Object.assign(vi.fn(() => ({ where })), {
    transaction: vi.fn(async (cb: any) => cb(trx)),
    fn: { now: vi.fn() }
  });
  return trx;
}

function makeInvoiceChange(overrides: Partial<AccountingExternalChange> = {}): AccountingExternalChange {
  return {
    entityType: 'Payment',
    externalId: 'pay-ext-001',
    syncToken: '3',
    deleted: false,
    payload: {
      PaymentRefNum: 'REF-001',
      TotalAmt: 200.0,
      UnappliedAmt: 0,
      Line: [
        {
          Amount: 200.0,
          LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'inv-ext-001' }]
        }
      ]
    },
    ...overrides
  };
}

describe('paymentApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordExternalPayment).mockResolvedValue({
      success: true,
      paymentId: 'pay-1',
      paymentRecorded: true
    });
    vi.mocked(reverseExternalPayment).mockResolvedValue({
      success: true,
      paymentId: 'rev-1',
      paymentRecorded: true
    });
  });

  it('new payment with single allocation inserts mapping and increments paymentsApplied', async () => {
    const invoiceMapping = { id: 'imap-1', alga_entity_id: 'alga-inv-1', external_entity_id: 'inv-ext-001', sync_status: 'synced', metadata: {} };
    const ledger = makeFakeLedger(null);
    // findByExternalId: first call (payment lookup) → null; subsequent call (invoice lookup) → invoiceMapping
    ledger.findByExternalId
      .mockResolvedValueOnce(null)         // credit_application echo probe
      .mockResolvedValueOnce(null)         // payment mapping not found
      .mockResolvedValueOnce(invoiceMapping); // invoice mapping found

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange()
    );

    expect(ledger.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityType: 'invoice_payment',
        externalEntityId: 'pay-ext-001'
      })
    );
    expect(stats.paymentsApplied).toBe(1);
    expect(stats.paymentsReversed).toBe(0);
  });

  it('idempotent: same sync token on existing mapping → skip', async () => {
    const existing = {
      id: 'pmap-1',
      alga_entity_id: 'pay-1',
      sync_status: 'synced',
      metadata: { sync_token: '3', allocations: [], deleted: false }
    };
    const ledger = makeFakeLedger(existing);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ syncToken: '3' })
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(stats.paymentsSkipped).toBe(1);
  });

  it('edit (changed sync_token) reverses old allocations and reapplies', async () => {
    const previousAlgaPaymentId = 'old-pay-id';
    const existing = {
      id: 'pmap-1',
      alga_entity_id: 'old-pay-id',
      sync_status: 'synced',
      metadata: {
        sync_token: '2',
        deleted: false,
        allocations: [
          { invoiceId: 'alga-inv-1', externalInvoiceId: 'inv-ext-001', amountCents: 15000, algaPaymentId: previousAlgaPaymentId }
        ]
      }
    };
    const invoiceMapping = { id: 'imap-1', alga_entity_id: 'alga-inv-1', external_entity_id: 'inv-ext-001', sync_status: 'synced', metadata: {} };
    const ledger = makeFakeLedger(existing);
    // first call returns existing payment mapping, second call (invoice lookup) returns invoice mapping
    ledger.findByExternalId
      .mockResolvedValueOnce(null)         // credit_application echo probe
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(invoiceMapping);

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ syncToken: '4' }) // changed token
    );

    expect(reverseExternalPayment).toHaveBeenCalled();
    expect(recordExternalPayment).toHaveBeenCalled();
    expect(stats.paymentsApplied).toBe(1);
    expect(stats.paymentsReversed).toBe(1);
  });

  it('delete reverses all recorded allocations', async () => {
    const existing = {
      id: 'pmap-1',
      alga_entity_id: 'old-pay-id',
      sync_status: 'synced',
      metadata: {
        sync_token: '3',
        deleted: false,
        allocations: [
          { invoiceId: 'alga-inv-1', externalInvoiceId: 'inv-ext-001', amountCents: 20000, algaPaymentId: 'pay-old' }
        ]
      }
    };
    const ledger = makeFakeLedger(existing);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ deleted: true })
    );

    expect(reverseExternalPayment).toHaveBeenCalled();
    expect(stats.paymentsReversed).toBe(1);
  });

  it('unmapped linked invoice → exception created, nothing applied', async () => {
    const ledger = makeFakeLedger(null); // payment not in ledger
    ledger.findByExternalId
      .mockResolvedValueOnce(null)  // credit_application echo probe
      .mockResolvedValueOnce(null)  // payment mapping
      .mockResolvedValueOnce(null); // invoice mapping — unmapped!

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange()
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_unmapped_payment' })
    );
    expect(stats.unmappedIgnored).toBe(1);
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('no Line entries → skip (paymentsSkipped)', async () => {
    const ledger = makeFakeLedger(null);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ payload: { PaymentRefNum: 'REF-001', Line: [] } })
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(stats.paymentsSkipped).toBe(1);
  });

  it('multi-allocation payment inserts mapping with all allocations in metadata', async () => {
    const invMap1 = { id: 'imap-1', alga_entity_id: 'alga-inv-1', external_entity_id: 'inv-ext-001', sync_status: 'synced', metadata: {} };
    const invMap2 = { id: 'imap-2', alga_entity_id: 'alga-inv-2', external_entity_id: 'inv-ext-002', sync_status: 'synced', metadata: {} };

    let recordCallCount = 0;
    vi.mocked(recordExternalPayment).mockImplementation(async () => {
      recordCallCount++;
      return { success: true, paymentId: `pay-${recordCallCount}`, paymentRecorded: true };
    });

    const ledger = makeFakeLedger(null);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)    // credit_application echo probe
      .mockResolvedValueOnce(null)    // payment mapping
      .mockResolvedValueOnce(invMap1) // invoice 1 mapping
      .mockResolvedValueOnce(invMap2); // invoice 2 mapping

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    const multiLineChange = makeInvoiceChange({
      payload: {
        PaymentRefNum: 'REF-MULTI',
        TotalAmt: 300.0,
        UnappliedAmt: 0,
        Line: [
          { Amount: 100.0, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'inv-ext-001' }] },
          { Amount: 200.0, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'inv-ext-002' }] }
        ]
      }
    });

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      multiLineChange
    );

    expect(recordExternalPayment).toHaveBeenCalledTimes(2);
    const insertCall = ledger.insert.mock.calls[0][0];
    // metadata should contain both allocations
    expect(insertCall.metadata.allocations).toHaveLength(2);
    expect(insertCall.metadata.sync_token).toBe('3');
    expect(stats.paymentsApplied).toBe(1);
  });

  it('inserted mapping metadata includes sync_token and allocations', async () => {
    const invMap = { id: 'imap-1', alga_entity_id: 'alga-inv-1', external_entity_id: 'inv-ext-001', sync_status: 'synced', metadata: {} };
    const ledger = makeFakeLedger(null);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)         // credit_application echo probe
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(invMap);

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ syncToken: '7' })
    );

    const insertCall = ledger.insert.mock.calls[0][0];
    expect(insertCall.metadata.sync_token).toBe('7');
    expect(Array.isArray(insertCall.metadata.allocations)).toBe(true);
    expect(insertCall.metadata.allocations[0].amountCents).toBe(20000); // 200.0 * 100
  });
});

// ── Double-entry / over-application guard (§7) ──────────────────────────────

/**
 * Build a fake knex that answers the invoices query (for the over-application guard)
 * AND supports knex.transaction (used by the happy path).
 */
function makeKnexWithInvoice(invoiceRow: any): any {
  const first = vi.fn(async () => invoiceRow);
  const select = vi.fn(() => ({ first }));
  const where = vi.fn(() => ({ select, first }));
  const table = vi.fn(() => ({ where }));
  const trx: any = Object.assign(table, {
    transaction: vi.fn(async (cb: any) => cb(trx)),
    fn: { now: vi.fn() }
  });
  return trx;
}

describe('paymentApplier — non-payable invoice guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordExternalPayment).mockResolvedValue({
      success: true,
      paymentId: 'pay-1',
      paymentRecorded: true
    });
    vi.mocked(reverseExternalPayment).mockResolvedValue({
      success: true,
      paymentId: 'rev-1',
      paymentRecorded: true
    });
  });

  it('NEW payment targeting a cancelled mapped invoice creates an exception and does not apply', async () => {
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'alga-inv-1',
      external_entity_id: 'inv-ext-001',
      sync_status: 'synced',
      metadata: {}
    };
    const cancelledInvoice = { status: 'cancelled', total_amount: 20000, credit_applied: 0 };

    const ledger = makeFakeLedger(null);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)           // credit_application echo probe
      .mockResolvedValueOnce(null)           // payment not in ledger (NEW)
      .mockResolvedValueOnce(invoiceMapping); // invoice mapping found

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeKnexWithInvoice(cancelledInvoice),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange()
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(reverseExternalPayment).not.toHaveBeenCalled();
    expect(ledger.insert).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_unmapped_payment',
        entityType: 'external_payment',
        entityId: 'pay-ext-001',
        context: expect.objectContaining({
          reason: 'targets_non_payable_invoice',
          targets: [
            expect.objectContaining({
              alga_invoice_id: 'alga-inv-1',
              external_invoice_id: 'inv-ext-001',
              invoice_status: 'cancelled'
            })
          ]
        })
      })
    );
    expect(stats.paymentsSkipped).toBe(1);
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('edited mapped payment targeting a draft invoice creates an exception before reversing old allocations', async () => {
    const existing = {
      id: 'pmap-1',
      alga_entity_id: 'old-pay-id',
      sync_status: 'synced',
      metadata: {
        sync_token: '2',
        deleted: false,
        allocations: [
          { invoiceId: 'alga-inv-1', externalInvoiceId: 'inv-ext-001', amountCents: 15000, algaPaymentId: 'pay-old' }
        ]
      }
    };
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'alga-inv-1',
      external_entity_id: 'inv-ext-001',
      sync_status: 'synced',
      metadata: {}
    };

    const ledger = makeFakeLedger(existing);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)          // credit_application echo probe
      .mockResolvedValueOnce(existing)      // existing payment mapping
      .mockResolvedValueOnce(invoiceMapping); // invoice mapping found

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeKnexWithInvoice({ status: 'draft', total_amount: 20000, credit_applied: 0 }),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange({ syncToken: '4' })
    );

    expect(reverseExternalPayment).not.toHaveBeenCalled();
    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(ledger.update).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_unmapped_payment',
        context: expect.objectContaining({
          reason: 'targets_non_payable_invoice',
          targets: [
            expect.objectContaining({
              invoice_status: 'draft'
            })
          ]
        })
      })
    );
    expect(stats.paymentsSkipped).toBe(1);
    expect(stats.paymentsReversed).toBe(0);
    expect(stats.exceptionsCreated).toBe(1);
  });
});

describe('paymentApplier — over-application guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordExternalPayment).mockResolvedValue({
      success: true,
      paymentId: 'pay-1',
      paymentRecorded: true
    });
  });

  it('NEW payment targeting a fully-settled (status=paid) invoice → exception + nothing applied', async () => {
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'alga-inv-1',
      external_entity_id: 'inv-ext-001',
      sync_status: 'synced',
      metadata: {}
    };
    const settledInvoice = { status: 'paid', total_amount: 20000, credit_applied: 0 };

    const ledger = makeFakeLedger(null);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)          // credit_application echo probe
      .mockResolvedValueOnce(null)          // payment not in ledger (NEW)
      .mockResolvedValueOnce(invoiceMapping); // invoice mapping found

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeKnexWithInvoice(settledInvoice),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange()
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'accounting_sync_unmapped_payment',
        context: expect.objectContaining({ reason: 'over_application' })
      })
    );
    expect(stats.paymentsSkipped).toBe(1);
    expect(stats.exceptionsCreated).toBe(1);
  });

  it('NEW payment targeting a partially-paid invoice → applies normally', async () => {
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'alga-inv-1',
      external_entity_id: 'inv-ext-001',
      sync_status: 'synced',
      metadata: {}
    };
    const partialInvoice = { status: 'partially_applied', total_amount: 50000, credit_applied: 0 };

    const ledger = makeFakeLedger(null);
    ledger.findByExternalId
      .mockResolvedValueOnce(null)          // credit_application echo probe
      .mockResolvedValueOnce(null)          // payment not in ledger (NEW)
      .mockResolvedValueOnce(invoiceMapping); // invoice mapping found

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: makeKnexWithInvoice(partialInvoice),
        tenantId: 't1',
        adapterType: 'quickbooks_online',
        targetRealm: 'r1',
        ledger: ledger as any,
        exceptions,
        stats
      },
      makeInvoiceChange()
    );

    expect(recordExternalPayment).toHaveBeenCalled();
    expect(stats.paymentsApplied).toBe(1);
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });
});
