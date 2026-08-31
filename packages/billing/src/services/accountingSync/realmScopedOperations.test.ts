import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QboSimulator } from './testing/qboSimulator';

/**
 * Realm-scoping scenarios: two simulated QuickBooks companies whose entity ids
 * deliberately collide. Every assertion is about which simulated company's
 * books changed — an operation targeting one realm must never read a mapping
 * from, or write into, the other company.
 */

// ── Hoisted wiring: appliers reach "QBO" through this per-realm seam ────────
const simsRef = vi.hoisted(() => ({ current: {} as Record<string, any> }));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async (_tenant: string, realm: string) => {
      const sim = simsRef.current[realm];
      if (!sim) throw new Error(`No simulated company for realm ${realm}`);
      return sim.client;
    })
  },
  getDefaultQboRealmId: vi.fn(async () => 'realm-a')
}));

vi.mock('./accountingSyncSettings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDepositAccountRef: vi.fn(async () => null)
}));

import { drainVoidInvoiceOps } from './invoiceVoidApplier';
import { drainRecordPaymentOps } from './paymentPushApplier';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { emptyCycleStats } from './accountingSync.types';

const TENANT = 'tenant-realms';
const ADAPTER = 'quickbooks_online';
const REALM_A = 'realm-a';
const REALM_B = 'realm-b';

/** Stateful ledger honoring the realm-exact repository contract. */
function makeRealmLedger() {
  const rows: any[] = [];
  const ledger: any = {
    rows,
    findByAlgaId: vi.fn(async (entityType: string, entityId: string, realm: string) =>
      rows.find(
        (r) =>
          r.alga_entity_type === entityType &&
          r.alga_entity_id === entityId &&
          r.external_realm_id === realm
      )
    ),
    findByAlgaIdAnyRealm: vi.fn(async (entityType: string, entityId: string) =>
      rows.filter((r) => r.alga_entity_type === entityType && r.alga_entity_id === entityId)
    ),
    findByExternalId: vi.fn(async (entityType: string, externalId: string, realm: string) =>
      rows.find(
        (r) =>
          r.alga_entity_type === entityType &&
          r.external_entity_id === externalId &&
          r.external_realm_id === realm
      )
    ),
    insert: vi.fn(async (record: any) => {
      const row = {
        id: `map-${rows.length + 1}`,
        alga_entity_type: record.algaEntityType,
        alga_entity_id: record.algaEntityId,
        external_entity_id: record.externalEntityId,
        external_realm_id: record.targetRealm,
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

function seedMapping(
  ledger: any,
  params: { entityType: string; algaId: string; externalId: string; realm: string | null }
) {
  ledger.rows.push({
    id: `map-seed-${ledger.rows.length + 1}`,
    alga_entity_type: params.entityType,
    alga_entity_id: params.algaId,
    external_entity_id: params.externalId,
    external_realm_id: params.realm,
    sync_status: 'synced',
    metadata: null
  });
}

function makeOps(pendingOps: any[] = []) {
  const failed: string[] = [];
  const done: string[] = [];
  return {
    failed,
    done,
    listPending: vi.fn(async () => pendingOps),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async (_t: string, opId: string) => {
      done.push(opId);
    }),
    markFailed: vi.fn(async (_t: string, opId: string) => {
      failed.push(opId);
      return 'pending' as const;
    })
  };
}

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

/**
 * Fake knex for the credit applier's source-invoice lookups: no prepayment
 * invoice and no project-deposit transaction exist, so every credit reads as
 * an ordinary credit-note application.
 */
function makeCreditKnex() {
  const query: any = {
    where: vi.fn(() => query),
    whereRaw: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () => undefined)
  };
  const table = vi.fn(() => query);
  return Object.assign(table, { fn: { now: vi.fn() } }) as any;
}

/** Fake knex sufficient for the payment applier's invoice → client lookup. */
function makeKnex(clientId = 'client-1') {
  const query: any = {
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn(async () => ({ client_id: clientId }))
  };
  const table = vi.fn(() => query);
  return Object.assign(table, { fn: { now: vi.fn() } }) as any;
}

/** Two companies with deliberately colliding invoice ids. */
function seedCollidingCompanies() {
  const simA = new QboSimulator({ realmId: REALM_A });
  const simB = new QboSimulator({ realmId: REALM_B });

  const customerA = simA.seedCustomer({ name: 'Shared Name Co' });
  const customerB = simB.seedCustomer({ name: 'Shared Name Co' });

  // Force the id collision: both companies hold an Invoice with the same Id.
  const invoiceA = simA.seedInvoice({ customerId: customerA.Id, amountCents: 10_000 });
  const invoiceB = simB.seedInvoice({ customerId: customerB.Id, amountCents: 25_000 });
  expect(invoiceA.Id).toBe(invoiceB.Id);

  simsRef.current = { [REALM_A]: simA, [REALM_B]: simB };
  return { simA, simB, customerA, customerB, invoiceA, invoiceB };
}

function baseDeps(overrides: any) {
  return {
    knex: makeKnex(),
    tenantId: TENANT,
    adapterType: ADAPTER,
    stats: emptyCycleStats(),
    exceptions: makeExceptions() as any,
    ...overrides
  };
}

describe('realm-scoped mapping resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simsRef.current = {};
  });

  it('voids the invoice only in the company the mapping belongs to', async () => {
    const { simA, simB, invoiceA, invoiceB } = seedCollidingCompanies();
    const ledger = makeRealmLedger();
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-1', externalId: invoiceA.Id, realm: REALM_A });

    const ops = makeOps([{ op_id: 'op-void-1', alga_entity_id: 'inv-1', attempts: 0 }]);
    await drainVoidInvoiceOps(baseDeps({ targetRealm: REALM_A, ops, ledger }));

    const voided = await simA.client.read<any>('Invoice', invoiceA.Id);
    expect(voided.Balance).toBe(0);
    expect(String(voided.PrivateNote ?? '')).toContain('Voided');
    // The colliding invoice in company B is untouched.
    const untouched = await simB.client.read<any>('Invoice', invoiceB.Id);
    expect(untouched.Balance).toBeGreaterThan(0);
    expect(String(untouched.PrivateNote ?? '')).not.toContain('Voided');
    expect(ops.done).toEqual(['op-void-1']);
  });

  it('after the default company changes, a void aimed at the new company neither reuses the old mapping nor touches either company', async () => {
    const { simA, simB, invoiceA, invoiceB } = seedCollidingCompanies();
    const ledger = makeRealmLedger();
    // Historically synced while realm-a was the default company.
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-1', externalId: invoiceA.Id, realm: REALM_A });

    // Default switched to realm-b: the op now targets realm-b.
    const ops = makeOps([{ op_id: 'op-void-2', alga_entity_id: 'inv-1', attempts: 0 }]);
    await drainVoidInvoiceOps(baseDeps({ targetRealm: REALM_B, ops, ledger }));

    // Neither company's colliding invoice was voided.
    const a = await simA.client.read<any>('Invoice', invoiceA.Id);
    const b = await simB.client.read<any>('Invoice', invoiceB.Id);
    expect(a.Balance).toBeGreaterThan(0);
    expect(b.Balance).toBeGreaterThan(0);
    expect(ops.done).toEqual([]);
    expect(ops.failed).toEqual(['op-void-2']);
  });

  it('a legacy mapping without a realm is never used for a void', async () => {
    const { simA, simB, invoiceA, invoiceB } = seedCollidingCompanies();
    const ledger = makeRealmLedger();
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-legacy', externalId: invoiceA.Id, realm: null });

    const ops = makeOps([{ op_id: 'op-void-3', alga_entity_id: 'inv-legacy', attempts: 0 }]);
    await drainVoidInvoiceOps(baseDeps({ targetRealm: REALM_A, ops, ledger }));

    const a = await simA.client.read<any>('Invoice', invoiceA.Id);
    const b = await simB.client.read<any>('Invoice', invoiceB.Id);
    expect(a.Balance).toBeGreaterThan(0);
    expect(b.Balance).toBeGreaterThan(0);
    expect(ops.failed).toEqual(['op-void-3']);
  });

  it('pushes a payment only into the company whose realm the operation targets', async () => {
    const { simA, simB, customerA, invoiceA } = seedCollidingCompanies();
    const ledger = makeRealmLedger();
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-1', externalId: invoiceA.Id, realm: REALM_A });
    seedMapping(ledger, { entityType: 'client', algaId: 'client-1', externalId: customerA.Id, realm: REALM_A });

    const op = {
      op_id: 'op-pay-1',
      alga_entity_id: 'pay-1',
      attempts: 0,
      payload: { invoiceId: 'inv-1', amountCents: 10_000, referenceNumber: 'ref-1', provider: 'stripe' }
    };
    const ops = makeOps([op]);
    await drainRecordPaymentOps(baseDeps({ targetRealm: REALM_A, ops, ledger }));

    expect(ops.done).toEqual(['op-pay-1']);
    // Payment landed in company A and reduced the intended invoice's balance.
    const paidInvoiceA = await simA.client.read<any>('Invoice', invoiceA.Id);
    expect(paidInvoiceA.Balance).toBe(0);
    // Company B saw no payment at all.
    expect(simB.entities('Payment')).toHaveLength(0);
  });

  it('refuses to push a payment when the invoice is mapped to a different company', async () => {
    const { simA, simB, invoiceA, invoiceB } = seedCollidingCompanies();
    const ledger = makeRealmLedger();
    // Invoice only ever synced to company A.
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-1', externalId: invoiceA.Id, realm: REALM_A });

    const op = {
      op_id: 'op-pay-2',
      alga_entity_id: 'pay-2',
      attempts: 0,
      payload: { invoiceId: 'inv-1', amountCents: 10_000, referenceNumber: 'ref-2', provider: 'stripe' }
    };
    const ops = makeOps([op]);
    await drainRecordPaymentOps(baseDeps({ targetRealm: REALM_B, ops, ledger }));

    expect(ops.failed).toEqual(['op-pay-2']);
    // Neither company received a payment; both invoices keep their balances.
    const untouchedA = await simA.client.read<any>('Invoice', invoiceA.Id);
    const untouchedB = await simB.client.read<any>('Invoice', invoiceB.Id);
    expect(untouchedA.Balance).toBeGreaterThan(0);
    expect(untouchedB.Balance).toBeGreaterThan(0);
  });

  it('never applies a credit whose documents are mapped to a different company', async () => {
    const { simA, simB, customerA, customerB, invoiceA, invoiceB } = seedCollidingCompanies();
    // Extend the collision to CreditMemos: both companies hold one with the same Id.
    const creditMemoA = simA.seedCreditMemo({ customerId: customerA.Id, amountCents: 5_000 });
    const creditMemoB = simB.seedCreditMemo({ customerId: customerB.Id, amountCents: 5_000 });
    expect(creditMemoA.Id).toBe(creditMemoB.Id);

    const ledger = makeRealmLedger();
    // Both documents only ever synced to company A.
    seedMapping(ledger, { entityType: 'invoice', algaId: 'inv-1', externalId: invoiceA.Id, realm: REALM_A });
    seedMapping(ledger, { entityType: 'invoice', algaId: 'cn-1', externalId: creditMemoA.Id, realm: REALM_A });

    const op = {
      op_id: 'op-credit-1',
      alga_entity_id: 'alloc-1',
      attempts: 0,
      created_at: new Date().toISOString(),
      payload: { creditNoteInvoiceId: 'cn-1', targetInvoiceId: 'inv-1', amountCents: 5_000 }
    };
    const ops = makeOps([op]);
    // Default switched to realm-b: the application now targets company B.
    await drainApplyCreditOps(baseDeps({ knex: makeCreditKnex(), targetRealm: REALM_B, ops, ledger }));

    // The op did not complete, and no linking Payment exists in either company.
    expect(ops.done).toEqual([]);
    expect(ops.failed).toEqual(['op-credit-1']);
    expect(simA.entities('Payment')).toHaveLength(0);
    expect(simB.entities('Payment')).toHaveLength(0);
    // Both companies' colliding invoices keep their balances.
    const a = await simA.client.read<any>('Invoice', invoiceA.Id);
    const b = await simB.client.read<any>('Invoice', invoiceB.Id);
    expect(a.Balance).toBeGreaterThan(0);
    expect(b.Balance).toBeGreaterThan(0);
  });
});

// ── Operation queue: dedup and satisfaction are realm-exact ─────────────────
//
// The queue is exercised through the real SyncOperationsRepository over a
// stateful in-memory operations table, so the assertions are about which
// queued operations exist / complete — not about query text.

import { SyncOperationsRepository } from './syncOperationsRepository';

function makeOpsDb() {
  const rows: any[] = [];
  let idSeq = 0;

  // tenantDb qualifies its tenant predicate ("<table>.tenant"); the row store
  // is flat, so column references are normalized to their bare name.
  const bare = (col: string) => col.split('.').pop() as string;

  function makeQuery() {
    const preds: Array<(r: any) => boolean> = [];
    const q: any = {
      where(arg: any, value?: any) {
        if (typeof arg === 'function') {
          const sub = makeQuery();
          arg.call(sub, sub);
          preds.push((r: any) => sub._match(r));
        } else if (typeof arg === 'object' && arg !== null) {
          preds.push((r: any) => Object.entries(arg).every(([k, v]) => r[bare(k)] === v));
        } else {
          preds.push((r: any) => r[bare(arg)] === value);
        }
        return q;
      },
      whereIn(col: string, values: any[]) {
        preds.push((r: any) => values.includes(r[bare(col)]));
        return q;
      },
      whereNull(col: string) {
        preds.push((r: any) => r[bare(col)] === null || r[bare(col)] === undefined);
        return q;
      },
      orderBy() {
        return q;
      },
      limit() {
        return q;
      },
      first: async () => rows.find((r) => q._match(r)),
      insert(record: any) {
        const row = { op_id: `op-${++idSeq}`, ...record };
        const insertQuery: any = {
          onConflict() {
            return insertQuery;
          },
          ignore() {
            return insertQuery;
          },
          async returning() {
            const conflict = rows.some((existing) =>
              existing.tenant === row.tenant &&
              existing.adapter_type === row.adapter_type &&
              existing.operation === row.operation &&
              existing.alga_entity_type === row.alga_entity_type &&
              existing.alga_entity_id === row.alga_entity_id &&
              (existing.target_realm ?? '') === (row.target_realm ?? '') &&
              existing.status === 'pending'
            );
            if (conflict) return [];
            rows.push(row);
            return [row];
          }
        };
        return insertQuery;
      },
      update: async (patch: any) => {
        const matched = rows.filter((r) => q._match(r));
        for (const row of matched) Object.assign(row, patch);
        return matched.length;
      },
      _match: (r: any) => preds.every((p) => p(r))
    };
    q.andWhere = q.where;
    return q;
  }

  const table = vi.fn(() => makeQuery());
  const knex = Object.assign(table, {
    fn: { now: () => 'now()' },
    raw: (sql: string) => sql
  });
  return { knex: knex as any, rows };
}

describe('realm-scoped operation queue', () => {
  const enqueueInput = (realm: string) => ({
    tenant: TENANT,
    adapterType: ADAPTER,
    targetRealm: realm,
    operation: 'export_invoice' as const,
    algaEntityType: 'invoice',
    algaEntityId: 'inv-1'
  });

  it('queues the same local entity separately per realm — no cross-realm dedup', async () => {
    const { knex, rows } = makeOpsDb();
    const repo = new SyncOperationsRepository(knex);

    const opA = await repo.enqueue(enqueueInput(REALM_A));
    const opB = await repo.enqueue(enqueueInput(REALM_B));

    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2);
    expect(opA.op_id).not.toBe(opB.op_id);
  });

  it('returns the existing pending op for a duplicate enqueue in the same realm', async () => {
    const { knex, rows } = makeOpsDb();
    const repo = new SyncOperationsRepository(knex);

    const first = await repo.enqueue(enqueueInput(REALM_A));
    const second = await repo.enqueue(enqueueInput(REALM_A));

    expect(second.op_id).toBe(first.op_id);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('satisfying work delivered into one realm leaves the other realm queued', async () => {
    const { knex, rows } = makeOpsDb();
    const repo = new SyncOperationsRepository(knex);

    await repo.enqueue(enqueueInput(REALM_A));
    await repo.enqueue(enqueueInput(REALM_B));

    const satisfied = await repo.satisfyPending(TENANT, ADAPTER, 'export_invoice', ['inv-1'], REALM_A);

    expect(satisfied).toBe(1);
    const byRealm = Object.fromEntries(rows.map((r) => [r.target_realm, r.status]));
    expect(byRealm[REALM_A]).toBe('done');
    expect(byRealm[REALM_B]).toBe('pending');
  });

  it('a null-realm satisfy touches only legacy realm-less ops', async () => {
    const { knex, rows } = makeOpsDb();
    const repo = new SyncOperationsRepository(knex);

    await repo.enqueue(enqueueInput(REALM_A));
    rows.push({
      op_id: 'op-legacy',
      tenant: TENANT,
      adapter_type: ADAPTER,
      target_realm: null,
      operation: 'export_invoice',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-1',
      status: 'pending'
    });

    const satisfied = await repo.satisfyPending(TENANT, ADAPTER, 'export_invoice', ['inv-1'], null);

    expect(satisfied).toBe(1);
    expect(rows.find((r) => r.op_id === 'op-legacy')?.status).toBe('done');
    expect(rows.find((r) => r.target_realm === REALM_A)?.status).toBe('pending');
  });
});
