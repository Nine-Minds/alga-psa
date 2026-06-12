/**
 * Mock-based unit tests for qboOnboardingActions.
 *
 * Tests cover:
 *  - bulkLinkHistoricalInvoices idempotency
 *  - backfillPaymentsForLinkedInvoices skip-paid
 */

// Set EE flag before any module loads
process.env.EDITION = 'ee';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input?: any) => fn({ tenant: 'tenant-test' }, { tenant: 'tenant-test' }, input)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn()
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1'),
  QboClientService: {
    create: vi.fn()
  }
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getQboCustomers: vi.fn(async () => [])
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
import { bulkLinkHistoricalInvoices, backfillPaymentsForLinkedInvoices } from './qboOnboardingActions';
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('bulkLinkHistoricalInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a knex mock whose table('tenant_external_entity_mappings') chain
   * for findByAlgaId returns results based on the alga_entity_id passed via .where().
   * Also supports .insert().returning() for SyncMappingLedger.insert.
   */
  function makeFullKnexMock(
    alreadyMappedIds: string[]
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
      return makeKnexQuery([]);
    });
    knexMock.fn = { now: vi.fn(() => new Date()) };
    return { knexMock, mappingsQuery };
  }

  it('inserts new mappings and returns linked count', async () => {
    const { knexMock, mappingsQuery } = makeFullKnexMock([]); // nothing pre-mapped
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await bulkLinkHistoricalInvoices([
      { invoiceId: 'inv-1', externalId: 'qbo-1', externalTotal: 10000, externalDocNumber: 'INV-001' },
      { invoiceId: 'inv-2', externalId: 'qbo-2', externalTotal: 5000, externalDocNumber: 'INV-002' }
    ]);

    expect(result.linked).toBe(2);
    expect(mappingsQuery.insert).toHaveBeenCalledTimes(2);
  });

  it('idempotent: skips already-mapped invoices', async () => {
    const { knexMock, mappingsQuery } = makeFullKnexMock(['inv-1']); // inv-1 already mapped
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as any);

    const result = await bulkLinkHistoricalInvoices([
      { invoiceId: 'inv-1', externalId: 'qbo-1', externalTotal: 10000, externalDocNumber: 'INV-001' },
      { invoiceId: 'inv-2', externalId: 'qbo-2', externalTotal: 5000, externalDocNumber: 'INV-002' }
    ]);

    // Only inv-2 is new
    expect(result.linked).toBe(1);
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
