/**
 * Mock-based unit tests for qboOnboardingActions.
 *
 * Tests cover:
 *  - linkClientToQboCustomer re-link / idempotency / conflict handling
 *  - bulkLinkHistoricalInvoices idempotency
 *  - backfillPaymentsForLinkedInvoices skip-paid
 */

// Set EE flag before any module loads
const prevEdition = process.env.EDITION;
process.env.EDITION = 'ee';
afterAll(() => {
  if (prevEdition === undefined) delete process.env.EDITION;
  else process.env.EDITION = prevEdition;
});

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input?: any) => fn({ tenant: 'tenant-test' }, { tenant: 'tenant-test' }, input)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  // Facade passthrough: the fakes below dispatch by table name; tenant
  // scoping is the real facade's concern, not this test's.
  tenantDb: (conn: any, _tenant: string) => ({ table: (name: string) => conn(name) }),
  // bulkLinkHistoricalInvoices serializes the mapping insert on the invoice
  // row lock; the passthrough makes the "transaction" the same fake knex.
  withTransaction: async (_knex: any, cb: any) => cb(_knex),
  // The shared invoice lock helper is re-exported through @alga-psa/db; the
  // fake invoice rows the harness serves are never cancelled, so the guard
  // passes without inspecting the fake further.
  lockInvoiceForExternalSync: vi.fn(async () => ({ status: 'sent' })),
  lockInvoicesForExternalSync: vi.fn(async () => [{ status: 'sent' }]),
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1'),
  QboClientService: {
    create: vi.fn(async () => ({
      // bulkLinkHistoricalInvoices proves the remote document exists before linking.
      read: vi.fn(async (entityType: string, id: string) => {
        if (entityType === 'Invoice') return { Id: id, SyncToken: '0' };
        return null;
      })
    }))
  }
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getQboCustomers: vi.fn(async () => [])
}));

// The shared, audited mapping update is what a re-link must retarget through.
vi.mock('@alga-psa/integrations/actions/externalMappingActions', () => ({
  updateExternalEntityMapping: vi.fn(async (id: string, updates: any) => ({
    id,
    external_entity_id: updates.external_entity_id,
    metadata: updates.metadata
  }))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../services/accountingSync/paymentApplier', () => ({
  applyExternalPaymentChange: vi.fn(async (_deps: any, _change: any) => undefined)
}));

vi.mock('../services/accountingSync/accountingSync.types', () => ({
  emptyCycleStats: vi.fn(() => ({
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
  }))
}));

import { createTenantKnex } from '@alga-psa/db';
import {
  bulkLinkHistoricalInvoices,
  backfillPaymentsForLinkedInvoices,
  linkClientToQboCustomer
} from './qboOnboardingActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- mocks the shared mapping action the onboarding actions retarget through
import { updateExternalEntityMapping } from '@alga-psa/integrations/actions/externalMappingActions';
import { applyExternalPaymentChange } from '../services/accountingSync/paymentApplier';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- mocks the QuickBooks client the onboarding actions bridge to
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLedgerFindByAlgaId(existingMap: Map<string, any>) {
  return vi.fn(async (_entityType: string, algaId: string) => existingMap.get(algaId) ?? undefined);
}

function makeLedgerInsert() {
  return vi.fn(async () => ({}));
}

function makeKnexQuery(rows: any[]) {
  const fakeInsertedRow = { id: 'new-id', ...rows[0] };
  const q: any = {
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    whereNotIn: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    pluck: vi.fn(async () => rows),
    first: vi.fn(async () => rows[0] ?? undefined),
    update: vi.fn(async () => 1),
    insert: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => [fakeInsertedRow]),
    then: undefined
  };
  // Make it thenable so await knex('table').where().select() works
  const promise = Promise.resolve(rows);
  Object.assign(q, { then: promise.then.bind(promise), catch: promise.catch.bind(promise) });
  return q;
}

type MappingRow = {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  deleted_at: string | null;
  metadata: Record<string, unknown> | null;
};

function mappingRow(overrides: Partial<MappingRow> = {}): MappingRow {
  return {
    id: 'map-1',
    tenant: 'tenant-test',
    integration_type: 'quickbooks_online',
    alga_entity_type: 'client',
    alga_entity_id: 'client-1',
    external_entity_id: 'qbo-A',
    external_realm_id: 'realm-1',
    sync_status: 'synced',
    deleted_at: null,
    metadata: { display_name: 'Alpha Corp', linked_via: 'onboarding' },
    ...overrides
  };
}

/**
 * Mapping table whose predicates are really evaluated, so the deleted_at and
 * entity scoping the link path depends on is what these assertions exercise —
 * not a fixture that answers every query the same way.
 */
function makeMappingStore(initial: MappingRow[]) {
  const rows: MappingRow[] = initial.map((row) => ({ ...row }));
  const updates: Array<Record<string, any>> = [];
  const inserts: Array<Record<string, any>> = [];

  const makeQuery = () => {
    const eq: Record<string, unknown> = {};
    const ne: Record<string, unknown> = {};
    const isNull: string[] = [];
    const notNull: string[] = [];
    let pendingInsert: Record<string, any> | null = null;

    const matches = (row: Record<string, any>) =>
      Object.entries(eq).every(([column, value]) => row[column] === value) &&
      Object.entries(ne).every(([column, value]) => row[column] !== value) &&
      isNull.every((column) => row[column] === null || row[column] === undefined) &&
      notNull.every((column) => row[column] !== null && row[column] !== undefined);

    const q: any = {
      where: vi.fn((arg: any) => {
        if (arg && typeof arg === 'object') Object.assign(eq, arg);
        return q;
      }),
      whereNot: vi.fn((arg: any) => {
        Object.assign(ne, arg);
        return q;
      }),
      whereNull: vi.fn((column: string) => {
        isNull.push(column);
        return q;
      }),
      whereNotNull: vi.fn((column: string) => {
        notNull.push(column);
        return q;
      }),
      // Realm scoping arrives as a grouped callback / whereIn; every fixture row
      // names the single connected realm, so the group adds nothing here.
      andWhere: vi.fn(() => q),
      whereIn: vi.fn(() => q),
      orderByRaw: vi.fn(() => q),
      select: vi.fn(() => q),
      first: vi.fn(async () => rows.find(matches)),
      update: vi.fn(async (patch: Record<string, any>) => {
        const affected = rows.filter(matches);
        updates.push(patch);
        for (const row of affected) Object.assign(row, patch);
        return affected.length;
      }),
      insert: vi.fn((row: Record<string, any>) => {
        pendingInsert = row;
        return q;
      }),
      returning: vi.fn(async () => {
        const inserted = {
          id: `map-${rows.length + 1}`,
          deleted_at: null,
          ...(pendingInsert ?? {})
        } as MappingRow;
        inserts.push(inserted);
        rows.push(inserted);
        return [inserted];
      })
    };
    return q;
  };

  const knexMock: any = vi.fn((table: string) => {
    if (table === 'tenant_external_entity_mappings') return makeQuery();
    return makeKnexQuery([]);
  });
  knexMock.fn = { now: () => new Date().toISOString() };

  return { knexMock, rows, updates, inserts };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('linkClientToQboCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateExternalEntityMapping).mockImplementation(async (id: any, updates: any) => ({
      id,
      external_entity_id: updates.external_entity_id,
      metadata: updates.metadata
    }) as any);
  });

  it('re-links to another customer by retargeting external_entity_id', async () => {
    const store = makeMappingStore([mappingRow()]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-B',
      externalName: 'Beta Industries'
    });

    expect(result).toEqual({ linked: true });
    expect(updateExternalEntityMapping).toHaveBeenCalledWith('map-1', {
      external_entity_id: 'qbo-B',
      metadata: { display_name: 'Beta Industries', linked_via: 'onboarding' }
    });
    // The ledger's status-only relink is exactly what used to rename the row
    // while leaving the old QBO id in place; a re-link must not take it.
    expect(store.updates).toHaveLength(0);
  });

  it('rejects a customer another client is live-mapped to', async () => {
    const store = makeMappingStore([
      mappingRow(),
      mappingRow({
        id: 'map-2',
        alga_entity_id: 'client-2',
        external_entity_id: 'qbo-B',
        metadata: { display_name: 'Beta Industries' }
      })
    ]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-B',
      externalName: 'Beta Industries'
    });

    expect(result).toEqual({
      linked: false,
      error: 'QBO customer qbo-B is already linked to another client.'
    });
    expect(updateExternalEntityMapping).not.toHaveBeenCalled();
    expect(store.rows[0].external_entity_id).toBe('qbo-A');
  });

  it('allows the re-link when only a tombstoned row still names the customer', async () => {
    const store = makeMappingStore([
      mappingRow(),
      mappingRow({
        id: 'map-2',
        alga_entity_id: 'client-2',
        external_entity_id: 'qbo-B',
        deleted_at: '2026-10-01T00:00:00.000Z',
        sync_status: 'unlinked'
      })
    ]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-B',
      externalName: 'Beta Industries'
    });

    expect(result).toEqual({ linked: true });
    expect(updateExternalEntityMapping).toHaveBeenCalledWith('map-1', expect.objectContaining({
      external_entity_id: 'qbo-B'
    }));
  });

  it('re-selecting the same customer refreshes status and name only', async () => {
    const store = makeMappingStore([mappingRow()]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-A',
      externalName: 'Alpha Corporation'
    });

    expect(result).toEqual({ linked: true });
    expect(updateExternalEntityMapping).not.toHaveBeenCalled();
    expect(store.updates).toHaveLength(1);
    expect(store.updates[0]).not.toHaveProperty('external_entity_id');
    expect(store.updates[0].metadata).toEqual({
      display_name: 'Alpha Corporation',
      linked_via: 'onboarding'
    });
    expect(store.rows[0].external_entity_id).toBe('qbo-A');
  });

  it('first-time link still inserts a ledger row', async () => {
    const store = makeMappingStore([]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-9',
      externalId: 'qbo-C',
      externalName: 'Gamma Services'
    });

    expect(result).toEqual({ linked: true });
    expect(updateExternalEntityMapping).not.toHaveBeenCalled();
    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0]).toMatchObject({
      alga_entity_type: 'client',
      alga_entity_id: 'client-9',
      external_entity_id: 'qbo-C',
      external_realm_id: 'realm-1'
    });
  });

  it('surfaces a refused retarget as a link failure', async () => {
    const store = makeMappingStore([mappingRow()]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);
    vi.mocked(updateExternalEntityMapping).mockResolvedValueOnce({
      actionError: 'QuickBooks Customer qbo-B does not exist in the connected company.'
    } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-B',
      externalName: 'Beta Industries'
    });

    expect(result).toEqual({
      linked: false,
      error: 'QuickBooks Customer qbo-B does not exist in the connected company.'
    });
    expect(store.rows[0].external_entity_id).toBe('qbo-A');
  });

  it('keys a sub-customer re-link on the billing profile, not the client', async () => {
    const store = makeMappingStore([
      mappingRow({
        id: 'map-profile',
        alga_entity_type: 'billing_profile',
        alga_entity_id: 'profile-1',
        external_entity_id: 'qbo-A:Site',
        metadata: { display_name: 'Alpha Corp:Site A', linked_via: 'onboarding' }
      })
    ]);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: store.knexMock } as any);

    const result = await linkClientToQboCustomer({
      clientId: 'client-1',
      externalId: 'qbo-B:Site',
      externalName: 'Alpha Corp:Site B',
      billingProfileId: 'profile-1'
    });

    expect(result).toEqual({ linked: true });
    expect(updateExternalEntityMapping).toHaveBeenCalledWith('map-profile', {
      external_entity_id: 'qbo-B:Site',
      metadata: { display_name: 'Alpha Corp:Site B', linked_via: 'onboarding' }
    });
  });
});

describe('bulkLinkHistoricalInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The QBO client mock factory is shared with other suites in this worker
    // (singleFork); pin the create() return here so bulk-link's remote
    // existence check gets a read-capable client regardless of file order.
    vi.mocked(QboClientService.create).mockResolvedValue({
      read: vi.fn(async (entityType: string, id: string) => {
        if (entityType === 'Invoice') return { Id: id, SyncToken: '0' };
        return null;
      })
    } as any);
  });

  /**
   * Build a knex mock whose table('tenant_external_entity_mappings') chain
   * for findByAlgaId returns results based on the alga_entity_id passed via .where().
   * Also supports .insert().returning() for SyncMappingLedger.insert.
   */
  function makeFullKnexMock(
    alreadyMappedIds: string[],
    localInvoiceIds: string[] = alreadyMappedIds
  ) {
    const fakeRow = {
      id: 'new-id',
      tenant: 'tenant-test',
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-new',
      external_entity_id: 'qbo-new',
      external_realm_id: 'realm-1',
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // We capture the last `where` call so we can decide what findByAlgaId returns
    let lastWhereArgs: any = {};

    const mappingsQuery: any = {
      where: vi.fn((args: any) => { lastWhereArgs = args; return mappingsQuery; }),
      andWhere: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      whereNotIn: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn(async () => {
        const id = lastWhereArgs?.alga_entity_id;
        return alreadyMappedIds.includes(id)
          ? { id: 'existing', alga_entity_id: id }
          : undefined;
      }),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn(async () => [fakeRow]),
      update: vi.fn(async () => 1),
      then: undefined
    };
    const p = Promise.resolve([]);
    Object.assign(mappingsQuery, { then: p.then.bind(p), catch: p.catch.bind(p) });

    const settingsQuery = makeKnexQuery([{ settings: {} }]);

    const knexMock: any = vi.fn((table: string) => {
      if (table === 'tenant_external_entity_mappings') return mappingsQuery;
      if (table === 'tenant_settings') return settingsQuery;
      // bulkLinkHistoricalInvoices proves the local side by loading each
      // invoice's id + prepayment flag; the shared invoice lock itself is
      // stubbed at the module boundary, so the rows only need those two fields.
      if (table === 'invoices') {
        return makeKnexQuery(
          localInvoiceIds.map((invoiceId) => ({
            invoice_id: invoiceId,
            is_prepayment: false
          }))
        );
      }
      return makeKnexQuery([]);
    });
    knexMock.fn = { now: vi.fn(() => new Date()) };
    return { knexMock, mappingsQuery };
  }

  it('inserts new mappings and returns linked count', async () => {
    const { knexMock, mappingsQuery } = makeFullKnexMock([], ['inv-1', 'inv-2']); // nothing pre-mapped
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await bulkLinkHistoricalInvoices([
      { invoiceId: 'inv-1', externalId: 'qbo-1', externalTotal: 10000, externalDocNumber: 'INV-001' },
      { invoiceId: 'inv-2', externalId: 'qbo-2', externalTotal: 5000, externalDocNumber: 'INV-002' }
    ]);

    expect(result.linked).toBe(2);
    expect(mappingsQuery.insert).toHaveBeenCalledTimes(2);
  });

  it('idempotent: skips already-mapped invoices', async () => {
    const { knexMock, mappingsQuery } = makeFullKnexMock(['inv-1'], ['inv-1', 'inv-2']); // inv-1 already mapped
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await bulkLinkHistoricalInvoices([
      { invoiceId: 'inv-1', externalId: 'qbo-1', externalTotal: 10000, externalDocNumber: 'INV-001' },
      { invoiceId: 'inv-2', externalId: 'qbo-2', externalTotal: 5000, externalDocNumber: 'INV-002' }
    ]);

    // Only inv-2 is new
    expect(result.linked).toBe(1);
    expect(mappingsQuery.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects a match for an invoice that is not local to this tenant', async () => {
    const { knexMock, mappingsQuery } = makeFullKnexMock([], ['inv-1']);
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await bulkLinkHistoricalInvoices([
      { invoiceId: 'inv-1', externalId: 'qbo-1', externalTotal: 10000, externalDocNumber: 'INV-001' },
      { invoiceId: 'inv-foreign', externalId: 'qbo-2', externalTotal: 5000, externalDocNumber: 'INV-002' }
    ]);

    expect(result.linked).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mappingsQuery.insert).toHaveBeenCalledTimes(1);
  });
});

describe('backfillPaymentsForLinkedInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips invoices with status paid and increments skippedPaid', async () => {
    const knexMock: any = vi.fn((table: string) => {
      if (table === 'invoices') {
        return makeKnexQuery([
          { invoice_id: 'inv-paid', status: 'paid', client_id: 'c1' }
        ]);
      }
      if (table === 'tenant_settings') {
        return makeKnexQuery([{ settings: {} }]);
      }
      return makeKnexQuery([]);
    });
    knexMock.fn = { now: () => new Date() };
    knexMock.transaction = vi.fn(async (cb: any) => cb(knexMock));

    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await backfillPaymentsForLinkedInvoices(['inv-paid']);

    expect(result.skippedPaid).toBe(1);
    expect(result.processed).toBe(0);
    expect(applyExternalPaymentChange).not.toHaveBeenCalled();
  });

  it('returns empty counts when no invoice ids provided', async () => {
    const knexMock: any = vi.fn(() => makeKnexQuery([]));
    knexMock.fn = { now: () => new Date() };
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await backfillPaymentsForLinkedInvoices([]);
    expect(result.processed).toBe(0);
    expect(result.paymentsApplied).toBe(0);
    expect(result.skippedPaid).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('processes non-paid invoice and calls applyExternalPaymentChange for matching payment lines', async () => {
    const mockPayment = {
      Id: 'pay-1',
      SyncToken: '1',
      Line: [
        {
          Amount: 100,
          LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-inv-1' }]
        }
      ]
    };

    const knexCallResults = {
      invoices: [{ invoice_id: 'inv-1', status: 'sent', client_id: 'c1' }],
      invoice_mappings: [{ alga_entity_id: 'inv-1', external_entity_id: 'qbo-inv-1' }],
      client_mappings: [{ alga_entity_id: 'c1', external_entity_id: 'qcust-1' }],
      tenant_settings: [{ settings: {} }]
    };

    const knexMock: any = vi.fn((table: string) => {
      if (table === 'invoices') return makeKnexQuery(knexCallResults.invoices);
      if (table === 'tenant_settings') return makeKnexQuery(knexCallResults.tenant_settings);
      if (table === 'tenant_external_entity_mappings') {
        // The query is called multiple times (invoice mappings, client mappings)
        // We return both; the caller filters by alga_entity_type
        return makeKnexQuery([
          ...knexCallResults.invoice_mappings,
          ...knexCallResults.client_mappings
        ]);
      }
      return makeKnexQuery([]);
    });
    knexMock.fn = { now: () => new Date() };
    knexMock.transaction = vi.fn(async (cb: any) => cb(knexMock));

    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    // QboClientService.create returns a client that returns one payment
    vi.mocked(QboClientService.create).mockResolvedValue({
      query: vi.fn(async () => [mockPayment])
    } as any);

    // Make applyExternalPaymentChange increment paymentsApplied via stats mutation
    vi.mocked(applyExternalPaymentChange).mockImplementation(async (deps: any) => {
      deps.stats.paymentsApplied += 1;
    });

    const result = await backfillPaymentsForLinkedInvoices(['inv-1']);

    expect(result.processed).toBe(1);
    expect(applyExternalPaymentChange).toHaveBeenCalledTimes(1);
    expect(result.errors).toBe(0);
  });
});
