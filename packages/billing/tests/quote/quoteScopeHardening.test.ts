/**
 * Regression tests for the five quote security findings (card 0222c1b4, review of PR #4383):
 *  F1 template item overrides, F2 item location ownership, F3 reparenting, F4 create authorization,
 *  F5 redaction of nested quote_items fields.
 *
 * They drive the real server actions, the real QuoteItem model, the real authorization kernel and the real quote
 * scope layer over an in-memory fake database. Only the DB handle, the session, the bundle-rule source and the
 * quote number sequence are substituted.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeQuoteDb, type FakeRow, type FakeTables } from './helpers/fakeQuoteDb';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const LOC_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const CONTACT_A = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const CONTACT_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';

// --- shared mutable test state (read by the hoisted mocks) ------------------------------------------------------
const state = vi.hoisted(() => ({
  db: null as any,
  rules: [] as any[],
  numbering: { issued: 0 },
  user: null as any,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: state.db, tenant: '22222222-2222-4222-8222-222222222222' }),
  withTransaction: (_conn: any, handler: (trx: any) => Promise<unknown>) => handler(state.db),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table), unscoped: (table: string) => conn(table) }),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withOptionalAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: '22222222-2222-4222-8222-222222222222' }, ...args),
  withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: '22222222-2222-4222-8222-222222222222' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

// The bundle-rule source and the tenant/subject lookups of the create check: the kernel itself is real.
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => state.rules,
}));
vi.mock('@alga-psa/authorization/subject/tenantScope', () => ({
  probeTenantAuthorizationScope: async () => ({ publishedAssignments: state.rules.length > 0, resolverSubjects: false }),
}));
vi.mock('@alga-psa/authorization/subject/resolver', () => ({
  resolveAuthorizationSubject: async (_conn: any, input: any) => ({
    tenant: input.tenant,
    userId: input.user.user_id,
    userType: 'internal',
    roleIds: [],
    teamIds: [],
    managedUserIds: [],
    clientId: null,
    portfolioClientIds: [],
  }),
}));

vi.mock('@shared/services/numberingService', () => ({
  SharedNumberingService: {
    getNextNumber: async () => {
      state.numbering.issued += 1;
      return `Q-${String(state.numbering.issued).padStart(4, '0')}`;
    },
  },
}));

// The Quote aggregate (lifecycle events, activities, access links) is out of scope; its read/create/update
// contract is replayed over the fake tables so assertions can look at what was actually stored.
vi.mock('../../src/models/quote', () => {
  const withItems = (row: FakeRow | undefined) =>
    row
      ? {
          ...row,
          quote_items: state.db.tables.quote_items
            .filter((item: FakeRow) => item.quote_id === row.quote_id)
            .map((item: FakeRow) => ({ ...item })),
          quote_activities: [],
        }
      : null;
  return {
    default: {
      getById: vi.fn(async (_conn: any, _tenant: string, quoteId: string) =>
        withItems(state.db.tables.quotes.find((quote: FakeRow) => quote.quote_id === quoteId))),
      create: vi.fn(async (_conn: any, _tenant: string, quote: FakeRow) => {
        const row = {
          ...quote,
          quote_id: randomUUID(),
          quote_number: quote.is_template ? null : `Q-${++state.numbering.issued}`,
          status: quote.is_template ? null : 'draft',
          version: 1,
        };
        state.db.tables.quotes.push(row);
        return { ...row };
      }),
      update: vi.fn(async (_conn: any, _tenant: string, quoteId: string, patch: FakeRow) => {
        const row = state.db.tables.quotes.find((quote: FakeRow) => quote.quote_id === quoteId)!;
        Object.assign(row, patch);
        return { ...row };
      }),
    },
  };
});
vi.mock('../../src/models/quoteActivity', () => ({ default: { create: vi.fn(async () => ({})) } }));

vi.mock('../../src/services/quoteCalculationService', () => ({ recalculateQuoteFinancials: vi.fn(async () => undefined) }));
vi.mock('../../src/services/quoteDecisionService', () => ({
  decideQuote: vi.fn(),
  listQuoteDecisions: vi.fn(async () => []),
}));
vi.mock('../../src/services/quoteAccessLinks', () => ({ mint: vi.fn(), revoke: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { getInstance: vi.fn() } }));
vi.mock('../../src/lib/adapters/tenantPartyAdapter', () => ({ fetchTenantParty: vi.fn() }));
vi.mock('@alga-psa/tenancy/server', () => ({ buildTenantPortalUrl: vi.fn() }));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ resolveEmailLocale: vi.fn() }));
vi.mock('../../src/services', () => ({
  buildQuoteConversionPreview: vi.fn(),
  convertQuoteToDraftContract: vi.fn(),
  convertQuoteToDraftContractAndInvoice: vi.fn(),
  convertQuoteToDraftInvoice: vi.fn(),
  convertQuoteToDraftSalesOrder: vi.fn(),
  createPDFGenerationService: vi.fn(),
}));
vi.mock('@alga-psa/documents/models', () => ({ Document: { insert: vi.fn() }, DocumentAssociation: { create: vi.fn() } }));
vi.mock('../../src/lib/documentsHelpers', () => ({
  getStorageProviderFactoryAsync: vi.fn(),
  getFileStoreModelAsync: vi.fn(),
  getDocumentModelAsync: vi.fn(),
  getDocumentAssociationModelAsync: vi.fn(),
}));

import {
  addQuoteItem,
  createQuote,
  createQuoteFromTemplate,
  getQuote,
  updateQuote,
  updateQuoteItem,
} from '../../src/actions/quoteActions';
import QuoteItem from '../../src/models/quoteItem';

// --- fixtures ---------------------------------------------------------------------------------------------------
const scopeRule = (...clientIds: string[]) => ({
  id: `scope-${clientIds.join('-')}`,
  resource: 'billing',
  action: 'read',
  templateKey: 'selected_clients',
  selectedClientIds: clientIds,
});

const quoteRow = (overrides: FakeRow = {}): FakeRow => ({
  tenant: TENANT_ID,
  quote_id: QUOTE_ID,
  quote_number: 'Q-0001',
  status: 'draft',
  version: 1,
  is_template: false,
  title: 'Managed services',
  client_id: CLIENT_A,
  contact_id: null,
  opportunity_id: null,
  created_by: USER_ID,
  currency_code: 'USD',
  ...overrides,
});

const itemRow = (overrides: FakeRow = {}): FakeRow => ({
  tenant: TENANT_ID,
  quote_item_id: ITEM_ID,
  quote_id: QUOTE_ID,
  description: 'Firewall appliance',
  quantity: 1,
  unit_price: 50000,
  total_price: 50000,
  net_amount: 50000,
  tax_amount: 0,
  display_order: 0,
  cost: 30000,
  location_id: null,
  ...overrides,
});

const seed = (extra: FakeTables = {}) => {
  state.db = createFakeQuoteDb({
    quotes: [quoteRow()],
    quote_items: [],
    client_locations: [
      { tenant: TENANT_ID, location_id: LOC_A, client_id: CLIENT_A, is_active: true },
      { tenant: TENANT_ID, location_id: LOC_B, client_id: CLIENT_B, is_active: true },
    ],
    contacts: [
      { tenant: TENANT_ID, contact_name_id: CONTACT_A, client_id: CLIENT_A },
      { tenant: TENANT_ID, contact_name_id: CONTACT_B, client_id: CLIENT_B },
    ],
    opportunities: [],
    ...extra,
  });
};

const isActionFailure = (result: any) =>
  Boolean(result && typeof result === 'object' && ('actionError' in result || 'permissionError' in result));

const createInput = (clientId: string, extra: FakeRow = {}) => ({
  client_id: clientId,
  title: 'New quote',
  quote_date: '2026-03-13T00:00:00.000Z',
  valid_until: '2026-03-20T00:00:00.000Z',
  currency_code: 'USD',
  is_template: false,
  ...extra,
});

const draftItem = (extra: FakeRow = {}) => ({
  local_id: randomUUID(),
  description: 'Endpoint monitoring',
  quantity: 1,
  unit_price: 15000,
  ...extra,
});

beforeEach(() => {
  state.rules = [];
  state.numbering.issued = 0;
  state.user = { user_id: USER_ID, id: USER_ID, tenant: TENANT_ID, user_type: 'internal', roles: [], clientId: null };
  seed();
});

// --- F5 ---------------------------------------------------------------------------------------------------------
describe('F5: a redaction of quote_items.cost reaches nested lines', () => {
  const redactCost = () => [{ id: 'hide-cost', resource: 'billing', action: 'read', redactedFields: ['quote_items.cost'] }];

  beforeEach(() => {
    state.rules = redactCost();
    state.db.tables.quote_items.push(itemRow());
  });

  it('getQuote does not expose quote_items[n].cost but keeps the visible line fields', async () => {
    const quote: any = await getQuote(QUOTE_ID);

    expect(quote.quote_items).toHaveLength(1);
    expect(quote.quote_items[0]).not.toHaveProperty('cost');
    expect(quote.quote_items[0].unit_price).toBe(50000);
    expect(quote.title).toBe('Managed services');
  });

  it('addQuoteItem and updateQuoteItem responses do not expose cost', async () => {
    const added: any = await addQuoteItem({
      quote_id: QUOTE_ID,
      description: 'Switch',
      quantity: 1,
      unit_price: 20000,
      cost: 12000,
    } as any);
    expect(isActionFailure(added)).toBe(false);
    expect(added).not.toHaveProperty('cost');
    expect(added.unit_price).toBe(20000);
    // the cost is still stored: only the response is projected
    expect(state.db.tables.quote_items.find((row: FakeRow) => row.description === 'Switch')?.cost).toBe(12000);

    const updated: any = await updateQuoteItem(ITEM_ID, { description: 'Firewall appliance v2', cost: 31000 } as any);
    expect(isActionFailure(updated)).toBe(false);
    expect(updated).not.toHaveProperty('cost');
    expect(updated.description).toBe('Firewall appliance v2');
  });

  it('updateQuote and createQuote responses do not expose quote_items[n].cost', async () => {
    const updated: any = await updateQuote(QUOTE_ID, { title: 'Renamed' });
    expect(updated.title).toBe('Renamed');
    expect(updated.quote_items[0]).not.toHaveProperty('cost');

    const created: any = await createQuote(createInput(CLIENT_A) as any);
    expect(isActionFailure(created)).toBe(false);
    for (const item of created.quote_items ?? []) expect(item).not.toHaveProperty('cost');
  });
});

// --- F1 ---------------------------------------------------------------------------------------------------------
describe('F1: create-from-template item overrides are validated before anything is written', () => {
  beforeEach(() => {
    state.db.tables.quotes.push(quoteRow({ quote_id: TEMPLATE_ID, is_template: true, status: null, quote_number: null }));
  });

  const quotesBefore = () => state.db.tables.quotes.length;

  const expectRejectedWithoutWrites = async (items: unknown[]) => {
    const before = quotesBefore();
    const result = await createQuoteFromTemplate(TEMPLATE_ID, {
      client_id: CLIENT_A,
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      items,
    } as any);
    expect(isActionFailure(result)).toBe(true);
    expect(state.db.tables.quotes).toHaveLength(before);
    expect(state.db.tables.quote_items).toHaveLength(0);
    expect(state.numbering.issued).toBe(0);
  };

  it('rejects a negative unit_price override', async () => {
    await expectRejectedWithoutWrites([draftItem({ unit_price: -10000 })]);
  });

  it('rejects a zero quantity override', async () => {
    await expectRejectedWithoutWrites([draftItem({ quantity: 0 })]);
  });

  it('rejects 201 override rows', async () => {
    await expectRejectedWithoutWrites(Array.from({ length: 201 }, () => draftItem()));
  });

  it('rejects one bad row among good ones (the whole array is parsed first)', async () => {
    await expectRejectedWithoutWrites([draftItem(), draftItem(), draftItem({ unit_price: -1 })]);
  });

  it('still creates the quote from valid overrides', async () => {
    const result: any = await createQuoteFromTemplate(TEMPLATE_ID, {
      client_id: CLIENT_A,
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      items: [draftItem({ quantity: 2, unit_price: 15000 })],
    } as any);
    expect(isActionFailure(result)).toBe(false);
    expect(state.db.tables.quote_items).toHaveLength(1);
    expect(state.db.tables.quote_items[0].unit_price).toBe(15000);
  });

  it('QuoteItem.create re-checks the resolved values (defence in depth behind the schema)', async () => {
    const base = { quote_id: QUOTE_ID, description: 'Line', quantity: 1, unit_price: 100 } as any;
    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, unit_price: -10000 })).rejects.toThrow('Unit price must not be negative');
    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, quantity: 0 })).rejects.toThrow('Quantity must be greater than zero');
    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, quantity: -3 })).rejects.toThrow('Quantity must be greater than zero');
    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, discount_percentage: 150 })).rejects.toThrow('Discount percentage must be between 0 and 100');
    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, cost: -1 })).rejects.toThrow('Cost must not be negative');
    expect(state.db.tables.quote_items).toHaveLength(0);

    await expect(QuoteItem.create(state.db, TENANT_ID, { ...base, discount_percentage: 100, cost: 0 })).resolves.toBeTruthy();
  });

  it('QuoteItem.update re-checks the values it is given', async () => {
    state.db.tables.quote_items.push(itemRow());
    await expect(QuoteItem.update(state.db, TENANT_ID, ITEM_ID, { unit_price: -5 })).rejects.toThrow('Unit price must not be negative');
    expect(state.db.tables.quote_items[0].unit_price).toBe(50000);
    // a stored legacy row stays editable for fields the guard does not concern
    state.db.tables.quote_items[0].unit_price = -1;
    await expect(QuoteItem.update(state.db, TENANT_ID, ITEM_ID, { description: 'Renamed' })).resolves.toBeTruthy();
  });
});

// --- F2 ---------------------------------------------------------------------------------------------------------
describe('F2: an item location must belong to the quote client', () => {
  const newItem = (locationId: string | null) => ({
    quote_id: QUOTE_ID,
    description: 'On-site install',
    quantity: 1,
    unit_price: 9000,
    location_id: locationId,
  });

  it('addQuoteItem rejects another client\'s location and stores nothing', async () => {
    const result = await addQuoteItem(newItem(LOC_B) as any);
    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("location_id does not belong to this quote's client");
    expect(state.db.tables.quote_items).toHaveLength(0);
  });

  it('addQuoteItem accepts the quote client\'s own location', async () => {
    const result: any = await addQuoteItem(newItem(LOC_A) as any);
    expect(isActionFailure(result)).toBe(false);
    expect(result.location_id).toBe(LOC_A);
    expect(state.db.tables.quote_items).toHaveLength(1);
  });

  it('updateQuoteItem rejects another client\'s location and leaves the row unchanged', async () => {
    state.db.tables.quote_items.push(itemRow({ location_id: LOC_A }));
    const result = await updateQuoteItem(ITEM_ID, { location_id: LOC_B } as any);
    expect(isActionFailure(result)).toBe(true);
    expect(state.db.tables.quote_items[0].location_id).toBe(LOC_A);
  });

  it('updateQuoteItem accepts the quote client\'s own location', async () => {
    state.db.tables.quote_items.push(itemRow());
    const result: any = await updateQuoteItem(ITEM_ID, { location_id: LOC_A } as any);
    expect(isActionFailure(result)).toBe(false);
    expect(state.db.tables.quote_items[0].location_id).toBe(LOC_A);
  });

  it('the model enforces it too, so REST, copy and update paths cannot skip the action', async () => {
    await expect(QuoteItem.create(state.db, TENANT_ID, newItem(LOC_B) as any)).rejects.toThrow(/does not belong to this quote's client/);
    await expect(QuoteItem.create(state.db, TENANT_ID, newItem(LOC_A) as any)).resolves.toBeTruthy();
  });

  it('a client-less quote (template) cannot carry a location', async () => {
    state.db.tables.quotes[0].client_id = null;
    await expect(QuoteItem.create(state.db, TENANT_ID, newItem(LOC_A) as any)).rejects.toThrow('location_id requires the quote to be linked to a client');
  });
});

// --- F3 ---------------------------------------------------------------------------------------------------------
describe('F3: reparenting a quote is judged on the candidate record', () => {
  it('denies a user scoped to client A who sets client_id to B, and the stored quote is unchanged', async () => {
    state.rules = [scopeRule(CLIENT_A)];

    const result = await updateQuote(QUOTE_ID, { client_id: CLIENT_B });

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain('Permission denied');
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
  });

  it('rejects an authorized reparent that leaves a stale contact, and changes nothing', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    state.db.tables.quotes[0].contact_id = CONTACT_A;

    const result = await updateQuote(QUOTE_ID, { client_id: CLIENT_B });

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("contact_id does not belong to this quote's client");
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
    expect(state.db.tables.quotes[0].contact_id).toBe(CONTACT_A);
  });

  it('rejects an authorized reparent that leaves an item pinned to a location of the old client', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    state.db.tables.quote_items.push(itemRow({ location_id: LOC_A }));

    const result = await updateQuote(QUOTE_ID, { client_id: CLIENT_B });

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("location_id does not belong to this quote's client");
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
  });

  it('rejects an authorized reparent that leaves a stale opportunity', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    const OPPORTUNITY_A = 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3';
    state.db.tables.opportunities.push({ tenant: TENANT_ID, opportunity_id: OPPORTUNITY_A, client_id: CLIENT_A });
    state.db.tables.quotes[0].opportunity_id = OPPORTUNITY_A;

    const result = await updateQuote(QUOTE_ID, { client_id: CLIENT_B });

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("opportunity_id does not belong to this quote's client");
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
  });

  it('allows an authorized reparent once the dependent references are valid for the destination client', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    state.db.tables.quotes[0].contact_id = CONTACT_A;

    const result: any = await updateQuote(QUOTE_ID, { client_id: CLIENT_B, contact_id: CONTACT_B });

    expect(isActionFailure(result)).toBe(false);
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_B);
    expect(state.db.tables.quotes[0].contact_id).toBe(CONTACT_B);
  });

  it('does not re-litigate an unchanged client (editing the title of a quote with a stored contact)', async () => {
    state.db.tables.quotes[0].contact_id = CONTACT_A;
    const result: any = await updateQuote(QUOTE_ID, { client_id: CLIENT_A, contact_id: CONTACT_A, title: 'Renamed' });
    expect(isActionFailure(result)).toBe(false);
    expect(state.db.tables.quotes[0].title).toBe('Renamed');
  });
});

// --- F4 ---------------------------------------------------------------------------------------------------------
describe('F4: quote creation is authorized on the candidate record before a number is allocated', () => {
  const templateInput = (clientId: string) => ({
    client_id: clientId,
    quote_date: '2026-03-13T00:00:00.000Z',
    valid_until: '2026-03-20T00:00:00.000Z',
  });

  it('createQuote denies a user scoped to client A who creates a quote for client B', async () => {
    state.rules = [scopeRule(CLIENT_A)];

    const result = await createQuote(createInput(CLIENT_B) as any);

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain('Permission denied: Cannot create quote');
    expect(state.numbering.issued).toBe(0);
    expect(state.db.tables.quotes).toHaveLength(1); // only the seeded one
  });

  it('createQuote still creates for the user\'s own client', async () => {
    state.rules = [scopeRule(CLIENT_A)];
    const result: any = await createQuote(createInput(CLIENT_A) as any);
    expect(isActionFailure(result)).toBe(false);
    expect(state.numbering.issued).toBe(1);
  });

  it('createQuoteFromTemplate denies a user scoped to client A who creates for client B', async () => {
    state.rules = [scopeRule(CLIENT_A)];
    // a template this user may read (it belongs to client A) so the denial comes from the create check
    state.db.tables.quotes.push(quoteRow({ quote_id: TEMPLATE_ID, is_template: true, status: null, quote_number: null }));
    const before = state.db.tables.quotes.length;

    const result = await createQuoteFromTemplate(TEMPLATE_ID, templateInput(CLIENT_B) as any);

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain('Permission denied: Cannot create quote');
    expect(state.numbering.issued).toBe(0);
    expect(state.db.tables.quotes).toHaveLength(before);
  });

  it('rejects another client\'s contact for every caller, with no scope rules at all', async () => {
    const result = await createQuote(createInput(CLIENT_A, { contact_id: CONTACT_B }) as any);

    expect(isActionFailure(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("contact_id does not belong to this quote's client");
    expect(state.numbering.issued).toBe(0);
  });

  it('rejects another client\'s contact on create-from-template too', async () => {
    state.db.tables.quotes.push(quoteRow({ quote_id: TEMPLATE_ID, is_template: true, status: null, quote_number: null }));
    const result = await createQuoteFromTemplate(TEMPLATE_ID, { ...templateInput(CLIENT_A), contact_id: CONTACT_B } as any);
    expect(isActionFailure(result)).toBe(true);
    expect(state.numbering.issued).toBe(0);
  });
});
