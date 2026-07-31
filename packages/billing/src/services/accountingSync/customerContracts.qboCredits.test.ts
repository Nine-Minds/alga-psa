import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Customer-communicated contracts for QBO credit behavior.
 *
 * Each test encodes behavior we have described to customers as how the QBO
 * integration handles credits, and that MSPs have built billing processes
 * around:
 *
 *   1. Credits that already live in QBO are never imported into Alga.
 *   2. Applying a QBO-side credit to a synced invoice inside QBO flows into
 *      Alga through the payment sync; the invoice balance drops to match.
 *   3. Credit notes issued in Alga export to QBO as CreditMemos.
 *   4. Applying an Alga credit in Alga reconciles QBO via a zero-dollar
 *      Payment linking CreditMemo → Invoice.
 *   5. That linking Payment echoing back through CDC is never double-counted.
 *   6. Prepayment credits stay Alga-only — they are not exported.
 *   7. If QBO's "Automatically apply credits" consumes a credit first, Alga
 *      files an exception instead of double-applying.
 *
 * A failure here is a change to externally-communicated behavior, not just a
 * regression. Updating a test to match new code is only correct once the
 * customer-facing rollout is decided (release notes at minimum). Contract 6
 * in particular is current behavior we have told customers may change: per
 * docs/plans/2026-06-11-qbo-phase2-closed-loop/design.md ("Credit memo
 * export"), prepayment export must ship opt-in and forward-only from a
 * cutoff — never retroactively exporting existing prepayments.
 *
 * These contracts use canned mocks because each asserts a single interaction.
 * For stateful multi-step versions of these flows, see
 * ./testing/qboSimulator.scenarios.test.ts (simulator wiring in
 * ./testing/README.md).
 */

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
const qboCreateMock = vi.hoisted(() => vi.fn());
const qboReadMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({ create: qboCreateMock, read: qboReadMock }))
  },
  getDefaultQboRealmId: vi.fn(async () => 'realm-1')
}));

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

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    autoSyncEnabled: true,
    autoSyncStartDate: null,
    autoProvisionCustomers: false, depositAccountRef: null,
    defaultClassRef: null,
    defaultDepartmentRef: null,
    defaultRealm: null
  })),
  resolveDefaultRealm: vi.fn(async () => 'realm-1')
}));

vi.mock('./syncOperationsRepository', () => ({
  SyncOperationsRepository: vi.fn().mockImplementation(function () { return ({
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 1)
  }); })
}));

import { applyExternalPaymentChange } from './paymentApplier';
import { applyExternalDocumentChange } from './driftDetector';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { enqueueInvoiceAutoExport } from './syncProducers';
import { emptyCycleStats } from './accountingSync.types';
import { recordExternalPayment } from './recordExternalPayment';
import { SyncOperationsRepository } from './syncOperationsRepository';
import type { AccountingExternalChange } from '@alga-psa/types';

const TENANT = 't1';
const REALM = 'realm-1';
const ADAPTER = 'quickbooks_online';

function makeFakeLedger() {
  const ledger: any = {
    findByExternalId: vi.fn(async () => null),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn()
  };
  ledger.withKnex.mockImplementation(() => ledger);
  return ledger;
}

function makeFakeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

/** knex whose invoice lookups return an open invoice and whose transaction
 *  immediately runs the callback against itself. */
function makeFakeKnex(invoiceRow: any = { status: 'sent', total_amount: 30000, credit_applied: 0 }) {
  // Self-referential builder so any chain length works, including
  // tenantDb(...).table(name).where(...) which injects a tenant clause before
  // the applier's own .where(...).
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () => invoiceRow)
  };
  const trx: any = Object.assign(vi.fn(() => query), {
    transaction: vi.fn(async (cb: any) => cb(trx)),
    fn: { now: vi.fn() }
  });
  return trx;
}

/** knex used by the auto-export producer: answers the invoice_type/date lookup. */
function makeProducerKnex(invoiceType: string, invoiceDate: string | null = null): any {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () => ({ invoice_type: invoiceType, invoice_date: invoiceDate }))
  };
  return Object.assign(vi.fn(() => query), { fn: { now: vi.fn() } });
}

function lastEnqueueFn(): ReturnType<typeof vi.fn> | undefined {
  const results = vi.mocked(SyncOperationsRepository).mock.results;
  return (results[results.length - 1]?.value as any)?.enqueue;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('EDITION', 'ee');
  vi.mocked(recordExternalPayment).mockResolvedValue({
    success: true,
    paymentId: 'pay-1',
    paymentRecorded: true
  } as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Contract 1 ──────────────────────────────────────────────────────────────
describe('Contract 1 — credits that already live in QBO are not imported', () => {
  it('a CreditMemo created directly in QBO (no mapping) is ignored: no writes, no exception', async () => {
    const ledger = makeFakeLedger();
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    const legacyCredit: AccountingExternalChange = {
      entityType: 'CreditMemo',
      externalId: 'qbo-cm-legacy',
      syncToken: '0',
      deleted: false,
      payload: { TotalAmt: 250.0, DocNumber: 'CM-QBO-1' }
    };

    await applyExternalDocumentChange(
      { tenantId: TENANT, targetRealm: REALM, ledger: ledger as any, exceptions, stats },
      legacyCredit
    );

    expect(stats.unmappedIgnored).toBe(1);
    expect(ledger.insert).not.toHaveBeenCalled();
    expect(ledger.update).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
  });
});

// ── Contract 2 ──────────────────────────────────────────────────────────────
describe('Contract 2 — applying a QBO credit to a synced invoice in QBO lands in Alga', () => {
  // QBO records a credit-memo application as a zero-total Payment whose lines
  // link the CreditMemo and the Invoice. Only the Invoice line is an AR
  // allocation; the CreditMemo line must be ignored, not treated as unmapped.
  it('zero-total Payment with CreditMemo + Invoice lines applies the invoice allocation only', async () => {
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'alga-inv-1',
      external_entity_id: 'qbo-inv-99',
      sync_status: 'synced',
      metadata: {}
    };

    const ledger = makeFakeLedger();
    ledger.findByExternalId
      .mockResolvedValueOnce(null)            // credit_application echo probe: not ours
      .mockResolvedValueOnce(null)            // payment mapping: new
      .mockResolvedValueOnce(invoiceMapping); // invoice line resolves

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    const qboSideApplication: AccountingExternalChange = {
      entityType: 'Payment',
      externalId: 'qbo-pay-credit-app',
      syncToken: '0',
      deleted: false,
      payload: {
        TotalAmt: 0,
        UnappliedAmt: 0,
        Line: [
          { Amount: 150.0, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-inv-99' }] },
          { Amount: 150.0, LinkedTxn: [{ TxnType: 'CreditMemo', TxnId: 'qbo-cm-legacy' }] }
        ]
      }
    };

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: TENANT,
        adapterType: ADAPTER,
        targetRealm: REALM,
        ledger: ledger as any,
        exceptions,
        stats
      },
      qboSideApplication
    );

    // Exactly one allocation — the invoice line; the CreditMemo line is not AR.
    expect(recordExternalPayment).toHaveBeenCalledTimes(1);
    expect(recordExternalPayment).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({ invoiceId: 'alga-inv-1', amount: 15000, provider: 'quickbooks' })
    );

    const inserted = ledger.insert.mock.calls[0][0];
    expect(inserted.algaEntityType).toBe('invoice_payment');
    expect(inserted.metadata.allocations).toHaveLength(1);

    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(stats.paymentsApplied).toBe(1);
  });
});

// ── Contract 3 ──────────────────────────────────────────────────────────────
describe('Contract 3 — credit notes issued in Alga export to QBO', () => {
  it('finalizing a credit note enqueues export_credit_memo', async () => {
    await enqueueInvoiceAutoExport(makeProducerKnex('credit_note'), TENANT, 'inv-cn-1');

    const enqueueFn = lastEnqueueFn();
    expect(enqueueFn).toBeDefined();
    expect(enqueueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityId: 'inv-cn-1',
        operation: 'export_credit_memo',
        adapterType: ADAPTER
      })
    );
  });
});

// ── Contracts 4 & 7 ─────────────────────────────────────────────────────────
describe('Contract 4 — applying Alga credit in Alga reconciles QBO', () => {
  function makeApplyDeps(cmBalance: number) {
    const op = {
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
      payload: { creditNoteInvoiceId: 'inv-cn-1', targetInvoiceId: 'inv-target-1', amountCents: 10000 },
      created_at: new Date().toISOString(),
      processed_at: null
    };
    const ops = {
      listPending: vi.fn(async () => [op]),
      markInProgress: vi.fn(async () => undefined),
      markDone: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => 'pending'),
      enqueue: vi.fn(async () => ({}))
    };
    const ledger = makeFakeLedger();
    ledger.findByAlgaId.mockImplementation(async (entityType: string, entityId: string) => {
      if (entityType === 'credit_application') return undefined;
      if (entityId === 'inv-cn-1') return { id: 'map-cn', external_entity_id: 'qbo-cm-42', metadata: null };
      if (entityId === 'inv-target-1') {
        return { id: 'map-inv', external_entity_id: 'qbo-inv-99', metadata: { customerId: 'customer-77' } };
      }
      return undefined;
    });
    qboReadMock.mockResolvedValueOnce({ Id: 'qbo-cm-42', Balance: cmBalance });
    return { ops, ledger };
  }

  it('pushes a zero-dollar QBO Payment linking CreditMemo → Invoice, keyed to the allocation', async () => {
    const { ops, ledger } = makeApplyDeps(100);
    qboCreateMock.mockResolvedValueOnce({ Id: 'qbo-payment-1' });
    const stats = emptyCycleStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions(),
      stats
    });

    expect(qboCreateMock).toHaveBeenCalledWith(
      'Payment',
      expect.objectContaining({
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
  });

  // Contract 7: customers are advised to turn off QBO's "Automatically apply
  // credits"; when QBO wins the race anyway, we must surface it, never
  // double-apply the credit.
  it('QBO already consumed the credit → exception filed, no Payment pushed', async () => {
    const { ops, ledger } = makeApplyDeps(0);
    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions,
      stats
    });

    expect(qboCreateMock).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'credit_allocation',
        entityId: 'alloc-1',
        context: expect.objectContaining({ reason: 'qbo_credit_already_consumed' })
      })
    );
  });
});

// ── Contract 5 ──────────────────────────────────────────────────────────────
describe('Contract 5 — our own credit-application Payment echoing back is not double-counted', () => {
  it('a Payment mapped as a credit_application is skipped by the payment applier', async () => {
    const ledger = makeFakeLedger();
    // The echo probe finds the mapping drainApplyCreditOps wrote for this Payment.
    ledger.findByExternalId.mockResolvedValueOnce({
      id: 'map-ca',
      alga_entity_id: 'alloc-1',
      external_entity_id: 'qbo-payment-1'
    });

    const exceptions = makeFakeExceptions();
    const stats = emptyCycleStats();

    const echo: AccountingExternalChange = {
      entityType: 'Payment',
      externalId: 'qbo-payment-1',
      syncToken: '0',
      deleted: false,
      payload: {
        TotalAmt: 0,
        Line: [
          { Amount: 100.0, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-inv-99' }] },
          { Amount: 100.0, LinkedTxn: [{ TxnType: 'CreditMemo', TxnId: 'qbo-cm-42' }] }
        ]
      }
    };

    await applyExternalPaymentChange(
      {
        knex: makeFakeKnex(),
        tenantId: TENANT,
        adapterType: ADAPTER,
        targetRealm: REALM,
        ledger: ledger as any,
        exceptions,
        stats
      },
      echo
    );

    expect(recordExternalPayment).not.toHaveBeenCalled();
    expect(ledger.insert).not.toHaveBeenCalled();
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    expect(stats.paymentsSkipped).toBe(1);
    expect(stats.paymentsApplied).toBe(0);
  });
});

// ── Contract 6 ──────────────────────────────────────────────────────────────
describe('Contract 6 — prepayment credits stay Alga-only', () => {
  // Communicated to customers as current behavior. Shipping prepayment export
  // later is expected — but it must be opt-in and forward-only from a cutoff,
  // and this test must only change together with that rollout.
  it('finalizing a prepayment invoice enqueues nothing', async () => {
    await enqueueInvoiceAutoExport(makeProducerKnex('prepayment'), TENANT, 'inv-pp-1');

    for (const result of vi.mocked(SyncOperationsRepository).mock.results) {
      const enqueueFn = (result.value as any)?.enqueue;
      if (enqueueFn) {
        expect(enqueueFn).not.toHaveBeenCalled();
      }
    }
  });
});
