import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QboSimulator } from './testing/qboSimulator';
import { drainVoidInvoiceOps } from './invoiceVoidApplier';
import { drainRecordPaymentOps } from './paymentPushApplier';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { emptyCycleStats, MAPPING_SYNC_STATUS } from './accountingSync.types';

/**
 * Fail-closed consumer behavior for the money-moving appliers, driven against
 * the in-memory QBO simulator so "no remote call" is asserted on simulator
 * state, not on mock plumbing.
 *
 * The mapping ledger is faked with the same realm semantics as the real
 * SyncMappingLedger (exact realm, tombstones excluded, no NULL-realm
 * fallback); the SQL scoping itself is covered DB-backed in
 * syncMappingRealm.db.test.ts.
 */

// ── Hoisted wiring: the appliers reach QBO through this seam ────────────────
const simRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => simRef.current.client) },
  getDefaultQboRealmId: vi.fn(async () => 'realm-sim')
}));

vi.mock('./accountingSyncSettings', () => ({
  getDepositAccountRef: vi.fn(async () => null)
}));

const TENANT = 'tenant-hardening';
const ADAPTER = 'quickbooks_online';
const REALM = 'realm-sim';
const OTHER_REALM = 'realm-other';

type LedgerRow = {
  id: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  deleted_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** In-memory ledger with the same realm/tombstone semantics as SyncMappingLedger. */
function makeRealmLedger(rows: LedgerRow[] = []) {
  const list = rows;
  const ledger: any = {
    rows: list,
    findByAlgaId: vi.fn(async (entityType: string, entityId: string, targetRealm?: string | null) =>
      list.find((r) => {
        if (r.alga_entity_type !== entityType || r.alga_entity_id !== entityId) return false;
        if (r.deleted_at) return false;
        if (targetRealm === undefined) return true;
        if (targetRealm === null) return r.external_realm_id === null;
        return r.external_realm_id === targetRealm;
      })
    ),
    findByExternalId: vi.fn(async (entityType: string, externalId: string, targetRealm?: string | null) =>
      list.find((r) => {
        if (r.alga_entity_type !== entityType || r.external_entity_id !== externalId) return false;
        if (r.deleted_at) return false;
        if (targetRealm === undefined) return true;
        if (targetRealm === null) return r.external_realm_id === null;
        return r.external_realm_id === targetRealm;
      })
    ),
    findNonConsumable: vi.fn(async (entityType: string, entityId: string, targetRealm: string) =>
      list.find(
        (r) =>
          r.alga_entity_type === entityType &&
          r.alga_entity_id === entityId &&
          (r.deleted_at !== undefined && r.deleted_at !== null
            ? true
            : r.external_realm_id !== targetRealm)
      )
    ),
    insert: vi.fn(async (params: any) => {
      const row: LedgerRow = {
        id: `map-${list.length + 1}`,
        alga_entity_type: params.algaEntityType,
        alga_entity_id: params.algaEntityId,
        external_entity_id: params.externalEntityId,
        external_realm_id: params.targetRealm ?? null,
        sync_status: params.syncStatus ?? 'synced',
        metadata: params.metadata ?? null,
      };
      list.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: any) => {
      const row = list.find((r) => r.id === id);
      if (!row) return;
      if (patch.syncStatus) row.sync_status = patch.syncStatus;
      if (patch.metadata) row.metadata = patch.metadata;
    }),
    withKnex: vi.fn().mockReturnThis()
  };
  return ledger;
}

function seedRow(overrides: Partial<LedgerRow> & { alga_entity_type: string; alga_entity_id: string; external_entity_id: string }): LedgerRow {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    external_realm_id: REALM,
    sync_status: MAPPING_SYNC_STATUS.synced,
    metadata: null,
    deleted_at: null,
    ...overrides,
  };
}

function makeOps(pending: any[] = []) {
  return {
    listPending: vi.fn(async () => pending),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    // 'skipped' means the op exhausted its attempts — the point at which the
    // appliers file the actionable internal failure.
    markFailed: vi.fn(async () => 'skipped'),
    enqueue: vi.fn(async () => ({})),
  };
}

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined),
  };
}

function makeVoidOp(invoiceId: string) {
  return {
    op_id: 'op-void-1',
    tenant: TENANT,
    adapter_type: ADAPTER,
    target_realm: REALM,
    operation: 'void_invoice',
    alga_entity_type: 'invoice',
    alga_entity_id: invoiceId,
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: null,
    created_at: new Date().toISOString(),
    processed_at: null,
  };
}

function makePaymentOp(invoiceId: string) {
  return {
    op_id: 'op-pay-1',
    tenant: TENANT,
    adapter_type: ADAPTER,
    target_realm: REALM,
    operation: 'record_payment',
    alga_entity_type: 'invoice_payment',
    alga_entity_id: 'pay-1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    payload: { invoiceId, amountCents: 5000, referenceNumber: 'ref-1', provider: 'stripe' },
    created_at: new Date().toISOString(),
    processed_at: null,
  };
}

function makeApplyCreditOp() {
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
    payload: { creditNoteInvoiceId: 'inv-cn-1', targetInvoiceId: 'inv-target-1', amountCents: 10000 },
    created_at: new Date().toISOString(),
    processed_at: null,
  };
}

function makeKnex(invoiceRow: { client_id: string } | null = { client_id: 'client-1' }) {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () => invoiceRow),
  };
  const trx: any = Object.assign(vi.fn(() => query), {
    transaction: vi.fn(async (cb: any) => cb(trx)),
    fn: { now: vi.fn() },
  });
  return trx;
}

/** Wrap the simulator's client methods in spies so call counts are assertable. */
function spyQboClient(sim: QboSimulator) {
  return {
    create: vi.spyOn(sim.client, 'create'),
    read: vi.spyOn(sim.client, 'read'),
    voidInvoice: vi.spyOn(sim.client, 'voidInvoice'),
    deleteCreditMemo: vi.spyOn(sim.client, 'deleteCreditMemo'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('drainVoidInvoiceOps — fail-closed mapping consumption', () => {
  it('a mapping in another realm never drives a void: no remote call, actionable failure', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: remoteInvoice.Id,
        external_realm_id: OTHER_REALM,
      }),
    ]);
    const ops = makeOps([makeVoidOp('inv-1')]);
    const exceptions = makeExceptions();
    const stats = emptyCycleStats();

    await drainVoidInvoiceOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: exceptions as any,
      stats,
    });

    expect(client.voidInvoice).not.toHaveBeenCalled();
    expect(client.deleteCreditMemo).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalledWith(TENANT, 'op-void-1', expect.stringContaining('Relink'));
    expect(exceptions.createOrUpdate).toHaveBeenCalled();
    // Remote document untouched.
    const remoteAfter = await sim.client.read('Invoice', remoteInvoice.Id);
    expect(Number(remoteAfter.Balance)).toBe(100);
  });

  it('a tombstoned mapping is never re-engaged: no remote call, actionable failure', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: remoteInvoice.Id,
        external_realm_id: REALM,
        deleted_at: new Date().toISOString(),
        sync_status: 'unlinked',
      }),
    ]);
    const ops = makeOps([makeVoidOp('inv-1')]);
    const exceptions = makeExceptions();
    const stats = emptyCycleStats();

    await drainVoidInvoiceOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: exceptions as any,
      stats,
    });

    expect(client.voidInvoice).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalled();
  });

  it('an invoice that was never exported is marked done with no remote call', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);

    const ledger = makeRealmLedger([]);
    const ops = makeOps([makeVoidOp('inv-never-exported')]);
    const stats = emptyCycleStats();

    await drainVoidInvoiceOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeExceptions() as any,
      stats,
    });

    expect(client.voidInvoice).not.toHaveBeenCalled();
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-void-1');
    expect(stats.opsProcessed).toBe(1);
  });

  it('happy path: a realm-exact mapping voids the real remote document', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 10000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: remoteInvoice.Id,
        external_realm_id: REALM,
        metadata: { external_entity_type: 'Invoice' },
      }),
    ]);
    const ops = makeOps([makeVoidOp('inv-1')]);
    const stats = emptyCycleStats();

    await drainVoidInvoiceOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeExceptions() as any,
      stats,
    });

    expect(client.voidInvoice).toHaveBeenCalledWith(remoteInvoice.Id, expect.any(String));
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-void-1');
    const remoteAfter = await sim.client.read('Invoice', remoteInvoice.Id);
    expect(Number(remoteAfter.TotalAmt)).toBe(0);
  });
});

describe('drainRecordPaymentOps — revalidation before money moves', () => {
  it('stale remote id: the mapped invoice no longer exists → no Payment created, actionable failure', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });
    // The mapping points at an id QBO does not have (deleted out-of-band).
    const staleId = 'invoice-999999';

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: staleId,
        external_realm_id: REALM,
      }),
      seedRow({
        alga_entity_type: 'client',
        alga_entity_id: 'client-1',
        external_entity_id: customer.Id,
        external_realm_id: REALM,
      }),
    ]);
    const ops = makeOps([makePaymentOp('inv-1')]);
    const exceptions = makeExceptions();
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex({ client_id: 'client-1' }),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: exceptions as any,
      stats,
    });

    expect(client.create).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalledWith(TENANT, 'op-pay-1', expect.stringContaining('no longer exists'));
    expect(exceptions.createOrUpdate).toHaveBeenCalled();
    expect(sim.entities('Payment')).toHaveLength(0);
  });

  it('a wrong-realm invoice mapping blocks the push with no remote call', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: remoteInvoice.Id,
        external_realm_id: OTHER_REALM,
      }),
      seedRow({
        alga_entity_type: 'client',
        alga_entity_id: 'client-1',
        external_entity_id: customer.Id,
        external_realm_id: REALM,
      }),
    ]);
    const ops = makeOps([makePaymentOp('inv-1')]);
    const exceptions = makeExceptions();
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex({ client_id: 'client-1' }),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: exceptions as any,
      stats,
    });

    expect(client.create).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalledWith(TENANT, 'op-pay-1', expect.stringContaining('Relink'));
    expect(sim.entities('Payment')).toHaveLength(0);
  });

  it('happy path: payment pushes only after the remote invoice is revalidated', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const remoteInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-1',
        external_entity_id: remoteInvoice.Id,
        external_realm_id: REALM,
      }),
      seedRow({
        alga_entity_type: 'client',
        alga_entity_id: 'client-1',
        external_entity_id: customer.Id,
        external_realm_id: REALM,
      }),
    ]);
    const ops = makeOps([makePaymentOp('inv-1')]);
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex({ client_id: 'client-1' }),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeExceptions() as any,
      stats,
    });

    expect(client.create).toHaveBeenCalled();
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-pay-1');
    expect(sim.entities('Payment')).toHaveLength(1);
    // The invoice balance dropped: money moved against the correct document.
    const remoteAfter = await sim.client.read('Invoice', remoteInvoice.Id);
    expect(Number(remoteAfter.Balance)).toBe(100);
  });
});

describe('drainApplyCreditOps — fail-closed credit application', () => {
  it('a tombstoned credit-note mapping blocks the application with no remote call', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const qboCm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-cn-1',
        external_entity_id: qboCm.Id,
        external_realm_id: REALM,
        deleted_at: new Date().toISOString(),
        sync_status: 'unlinked',
      }),
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-target-1',
        external_entity_id: qboInvoice.Id,
        external_realm_id: REALM,
        metadata: { customerId: customer.Id },
      }),
    ]);
    const ops = makeOps([makeApplyCreditOp()]);
    const exceptions = makeExceptions();
    const stats = emptyCycleStats();

    await drainApplyCreditOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: exceptions as any,
      stats,
    });

    expect(client.create).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalled();
    expect(exceptions.createOrUpdate).toHaveBeenCalled();
    // Remote balances unchanged — no linking payment was created.
    expect(sim.entities('Payment')).toHaveLength(0);
    const cmAfter = await sim.client.read('CreditMemo', qboCm.Id);
    const invAfter = await sim.client.read('Invoice', qboInvoice.Id);
    expect(Number(cmAfter.Balance)).toBe(100);
    expect(Number(invAfter.Balance)).toBe(150);
  });

  it('happy path: realm-exact mappings apply the credit against real balances', async () => {
    const sim = new QboSimulator({ realmId: REALM });
    simRef.current = sim;
    const client = spyQboClient(sim);
    const customer = sim.seedCustomer({ name: 'Acme' });
    const qboCm = sim.seedCreditMemo({ customerId: customer.Id, amountCents: 10000 });
    const qboInvoice = sim.seedInvoice({ customerId: customer.Id, amountCents: 15000 });

    const ledger = makeRealmLedger([
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-cn-1',
        external_entity_id: qboCm.Id,
        external_realm_id: REALM,
      }),
      seedRow({
        alga_entity_type: 'invoice',
        alga_entity_id: 'inv-target-1',
        external_entity_id: qboInvoice.Id,
        external_realm_id: REALM,
        metadata: { customerId: customer.Id },
      }),
    ]);
    const ops = makeOps([makeApplyCreditOp()]);
    const stats = emptyCycleStats();

    await drainApplyCreditOps({
      knex: makeKnex(),
      tenantId: TENANT,
      adapterType: ADAPTER,
      targetRealm: REALM,
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeExceptions() as any,
      stats,
    });

    expect(client.create).toHaveBeenCalledWith('Payment', expect.objectContaining({ TotalAmt: 0 }));
    expect(ops.markDone).toHaveBeenCalledWith(TENANT, 'op-apply-1');
    const invAfter = await sim.client.read('Invoice', qboInvoice.Id);
    expect(Number(invAfter.Balance)).toBe(50);
    const cmAfter = await sim.client.read('CreditMemo', qboCm.Id);
    expect(Number(cmAfter.Balance)).toBe(0);
  });
});
