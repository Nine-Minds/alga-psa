import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QboSimulator } from './qboSimulator';

/**
 * Sync-engine scenarios run against the stateful QBO simulator instead of
 * canned mocks: each test drives real applier code through a realistic QBO
 * sequence (documents exist, balances move, CDC replays state) and asserts
 * both sides — what Alga recorded AND what QBO now contains.
 */

// ── Hoisted wiring: the appliers reach QBO through this seam ────────────────
const simRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => simRef.current.client) },
  getDefaultQboRealmId: vi.fn(async () => 'realm-sim')
}));

vi.mock('../recordExternalPayment', () => ({
  recordExternalPayment: vi.fn(async () => ({ success: true, paymentId: 'pay-1', paymentRecorded: true })),
  reverseExternalPayment: vi.fn(async () => ({ success: true, paymentId: 'rev-1', paymentRecorded: true })),
  isNonPayableInvoiceStatus: (status: string | null | undefined) =>
    status === 'cancelled' || status === 'draft' || status === 'void',
  computeBalanceDue: vi.fn(
    ({ totalAmount, creditApplied, totalPaid }: { totalAmount: number; creditApplied: number; totalPaid: number }) =>
      totalAmount - creditApplied - totalPaid
  )
}));

import { drainApplyCreditOps } from '../creditApplicationApplier';
import { applyExternalPaymentChange } from '../paymentApplier';
import { applyExternalDocumentChange } from '../driftDetector';
import { emptyCycleStats, MAPPING_SYNC_STATUS } from '../accountingSync.types';
import { recordExternalPayment } from '../recordExternalPayment';

const TENANT = 'tenant-sim';
const ADAPTER = 'quickbooks_online';
const REALM = 'realm-sim';

/** Stateful in-memory mapping ledger: inserts are visible to later lookups. */
function makeStatefulLedger() {
  const rows: any[] = [];
  const ledger: any = {
    rows,
    findByAlgaId: vi.fn(async (entityType: string, entityId: string) =>
      rows.find((r) => r.alga_entity_type === entityType && r.alga_entity_id === entityId)
    ),
    findByExternalId: vi.fn(async (entityType: string, externalId: string) =>
      rows.find((r) => r.alga_entity_type === entityType && r.external_entity_id === externalId) ?? null
    ),
    insert: vi.fn(async (record: any) => {
      const row = {
        id: `map-${rows.length + 1}`,
        alga_entity_type: record.algaEntityType,
        alga_entity_id: record.algaEntityId,
        external_entity_id: record.externalEntityId,
        sync_status: record.syncStatus ?? 'synced',
        metadata: record.metadata ?? null
      };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        if (patch.syncStatus) row.sync_status = patch.syncStatus;
        if (patch.metadata) row.metadata = patch.metadata;
      }
    }),
    withKnex: vi.fn()
  };
  ledger.withKnex.mockImplementation(() => ledger);
  return ledger;
}

function seedMapping(ledger: any, entityType: string, algaId: string, externalId: string, metadata: any = null) {
  ledger.rows.push({
    id: `map-seed-${ledger.rows.length + 1}`,
    alga_entity_type: entityType,
    alga_entity_id: algaId,
    external_entity_id: externalId,
    sync_status: MAPPING_SYNC_STATUS.synced,
    metadata
  });
}

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

function makeOps(pending: any[]) {
  return {
    listPending: vi.fn(async () => pending),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => 'pending'),
    enqueue: vi.fn(async () => ({}))
  };
}

function makeApplyCreditOp(amountCents: number) {
  return {
    op_id: 'op-apply-sim',
    tenant: TENANT,
    adapter_type: ADAPTER,
    target_realm: REALM,
    operation: 'apply_credit',
    alga_entity_type: 'credit_allocation',
    alga_entity_id: 'alloc-sim-1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: { creditNoteInvoiceId: 'inv-cn-1', targetInvoiceId: 'inv-target-1', amountCents },
    created_at: new Date().toISOString(),
    processed_at: null
  };
}

function makeFakeKnex(invoiceRow: any = { status: 'sent', total_amount: 30000, credit_applied: 0 }) {
  // Self-referential builder: where()/select() return the same query so any
  // chain length works, including tenantDb(...).table(name).where(...) which
  // auto-injects a tenant clause before the applier's own .where(...).
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordExternalPayment).mockResolvedValue({
    success: true,
    paymentId: 'pay-1',
    paymentRecorded: true
  } as any);
});

describe('Scenario: Alga applies credit → QBO reconciles', () => {
  it('pushes a real zero-dollar Payment; CreditMemo and Invoice balances drop in QBO; re-run is idempotent', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const qboCm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const ledger = makeStatefulLedger();
    seedMapping(ledger, 'invoice', 'inv-cn-1', qboCm.Id);
    seedMapping(ledger, 'invoice', 'inv-target-1', qboInvoice.Id, { customerId: customer.Id });

    const ops = makeOps([makeApplyCreditOp(10000)]);
    const stats = emptyCycleStats();

    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeExceptions(),
      stats
    });

    // QBO side: one zero-dollar payment linking the two documents, balances moved.
    const payments = sim.entities('Payment');
    expect(payments).toHaveLength(1);
    expect(payments[0].TotalAmt).toBe(0);
    expect((await sim.client.read('CreditMemo', qboCm.Id))!.Balance).toBe(0);
    expect((await sim.client.read('Invoice', qboInvoice.Id))!.Balance).toBe(50);
    expect(ops.markDone).toHaveBeenCalled();

    // Re-run the same op (crash-recovery replay): the mapping written by the
    // first run makes it a no-op — still exactly one payment in QBO.
    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: makeOps([makeApplyCreditOp(10000)]) as any,
      ledger: ledger as any,
      exceptions: makeExceptions(),
      stats: emptyCycleStats()
    });
    expect(sim.entities('Payment')).toHaveLength(1);
  });
});

describe('Scenario: QBO auto-apply wins the race', () => {
  it('QBO consumed the credit before the cycle ran → exception filed, nothing double-applied', async () => {
    const sim = new QboSimulator({ autoApplyCredits: true });
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const qboCm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });
    // Invoice creation triggers QBO's auto-apply: credit is consumed instantly.
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });
    expect((await sim.client.read('CreditMemo', qboCm.Id))!.Balance).toBe(0);
    const paymentsBefore = sim.entities('Payment').length;

    const ledger = makeStatefulLedger();
    seedMapping(ledger, 'invoice', 'inv-cn-1', qboCm.Id);
    seedMapping(ledger, 'invoice', 'inv-target-1', qboInvoice.Id, { customerId: customer.Id });

    const exceptions = makeExceptions();
    await drainApplyCreditOps({
      knex: {} as any,
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: makeOps([makeApplyCreditOp(10000)]) as any,
      ledger: ledger as any,
      exceptions,
      stats: emptyCycleStats()
    });

    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'qbo_credit_already_consumed' })
      })
    );
    expect(sim.entities('Payment')).toHaveLength(paymentsBefore);
  });
});

describe('Scenario: bookkeeper applies a legacy QBO credit to a synced invoice', () => {
  it('the CDC payment lands in Alga as the applied amount; balance-only document changes are not drift', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Loyal Customer LLC' });
    const legacyCm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 60000 });
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000, docNumber: 'INV-31501' });

    // Alga knows the invoice (it was exported); the legacy credit is QBO-only.
    const ledger = makeStatefulLedger();
    seedMapping(ledger, 'invoice', 'alga-inv-1', qboInvoice.Id, {
      exported_total: 150,
      doc_number: 'INV-31501',
      sync_token: qboInvoice.SyncToken
    });

    const cursor = sim.now();
    sim.applyCreditInQbo({ creditMemoId: legacyCm.Id, invoiceId: qboInvoice.Id, amountCents: 15000 });

    const changeSet = await sim.client.fetchChanges(cursor);
    const stats = emptyCycleStats();
    const exceptions = makeExceptions();

    // Route changes the way the cycle service does: Payments, then documents.
    for (const change of changeSet.changes.filter((c) => c.entityType === 'Payment')) {
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
        change as any
      );
    }
    for (const change of changeSet.changes.filter((c) => c.entityType === 'Invoice' || c.entityType === 'CreditMemo')) {
      await applyExternalDocumentChange(
        { tenantId: TENANT, targetRealm: REALM, ledger: ledger as any, exceptions, stats },
        change as any
      );
    }

    // The credit application arrived as exactly one invoice allocation,
    // labeled as a credit application and dated with QBO's TxnDate.
    expect(recordExternalPayment).toHaveBeenCalledTimes(1);
    expect(recordExternalPayment).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        invoiceId: 'alga-inv-1',
        amount: 15000,
        provider: 'quickbooks',
        paymentDate: expect.any(Date),
        notes: expect.stringMatching(/^QuickBooks credit applied /)
      })
    );
    // Balance moved in QBO but the total did not: no drift, no exceptions.
    expect(stats.driftFound).toBe(0);
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    // The legacy CreditMemo change was ignored (unmapped by design).
    expect(stats.unmappedIgnored).toBeGreaterThanOrEqual(1);
  });
});

describe('Scenario: auto-provisioning against an established company file', () => {
  it('an inactive customer is invisible to name lookups but blocks the create — the exact 26-year-file failure mode', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;
    sim.seedCustomer({ name: 'Smith & Sons, Inc.', active: false });

    // The background path's exact-name probe finds nothing...
    expect(await sim.client.findCustomerByDisplayName('Smith & Sons, Inc.')).toBeNull();
    // ...so it proceeds to create, and QBO rejects with a duplicate-name error.
    await expect(sim.client.createOrUpdateCustomer({ name: 'Smith & Sons, Inc.' })).rejects.toMatchObject({
      code: '6240'
    });
    // And a near-miss spelling sails through as a brand-new duplicate customer.
    const nearMiss = await sim.client.createOrUpdateCustomer({ name: 'Smith and Sons Inc' });
    expect(nearMiss.externalId).toBeDefined();
    expect(sim.entities('Customer')).toHaveLength(2);
  });
});

describe('Scenario: QBO-side void arrives through CDC', () => {
  it('the void shape from the simulator trips the drift detector into externalVoided + exception', async () => {
    const sim = new QboSimulator();
    simRef.current = sim;

    const customer = sim.seedCustomer({ name: 'Acme Corp' });
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000, docNumber: 'INV-9' });

    const ledger = makeStatefulLedger();
    seedMapping(ledger, 'invoice', 'alga-inv-9', qboInvoice.Id, {
      exported_total: 150,
      doc_number: 'INV-9',
      sync_token: qboInvoice.SyncToken
    });

    const cursor = sim.now();
    await sim.client.voidInvoice(qboInvoice.Id, qboInvoice.SyncToken);

    const changeSet = await sim.client.fetchChanges(cursor);
    const stats = emptyCycleStats();
    const exceptions = makeExceptions();

    for (const change of changeSet.changes.filter((c) => c.entityType === 'Invoice')) {
      await applyExternalDocumentChange(
        { tenantId: TENANT, targetRealm: REALM, ledger: ledger as any, exceptions, stats },
        change as any
      );
    }

    expect(stats.driftFound).toBe(1);
    expect(exceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_drift' })
    );
    const mapping = ledger.rows.find((r: any) => r.external_entity_id === qboInvoice.Id);
    expect(mapping.sync_status).toBe(MAPPING_SYNC_STATUS.externalVoided);
  });
});
