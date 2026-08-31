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
});
