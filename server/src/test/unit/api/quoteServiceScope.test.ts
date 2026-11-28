/**
 * REST parity for the quote scope hardening (F3, F4): the REST service create/update hit the SAME guards as the
 * server actions — `assertQuoteCreateAllowed`, `assertQuotePatchReferencesInScope` and `authorizeQuoteWrite` from
 * `@alga-psa/billing/lib/quoteScope` — and a denial surfaces as the REST layer's existing 403.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeQuoteDb, type FakeRow } from '../../../../../packages/billing/tests/quote/helpers/fakeQuoteDb';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_A = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const CONTACT_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({ db: null as any, rules: [] as any[], numbering: { issued: 0 } }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withTransaction: (_conn: any, handler: (trx: any) => Promise<unknown>) => handler(state.db),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table), unscoped: (table: string) => conn(table) }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => state.rules,
}));
vi.mock('@alga-psa/authorization/subject/tenantScope', () => ({
  probeTenantAuthorizationScope: async () => ({ publishedAssignments: state.rules.length > 0, resolverSubjects: false }),
}));
vi.mock('@alga-psa/authorization/subject/resolver', () => ({
  resolveAuthorizationSubject: async (_conn: any, input: any) => ({
    tenant: input.tenant,
    userId: input.user?.user_id ?? 'api-user',
    userType: 'internal',
    roleIds: [],
    teamIds: [],
    managedUserIds: [],
    clientId: null,
    portfolioClientIds: [],
  }),
}));

// Spy on the shared guards while still running the real implementations.
const scopeSpies = vi.hoisted(() => ({
  assertQuoteCreateAllowed: vi.fn(),
  assertQuotePatchReferencesInScope: vi.fn(),
  authorizeQuoteWrite: vi.fn(),
}));
vi.mock('@alga-psa/billing/lib/quoteScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/billing/lib/quoteScope')>();
  scopeSpies.assertQuoteCreateAllowed.mockImplementation(actual.assertQuoteCreateAllowed);
  scopeSpies.assertQuotePatchReferencesInScope.mockImplementation(actual.assertQuotePatchReferencesInScope);
  scopeSpies.authorizeQuoteWrite.mockImplementation(actual.authorizeQuoteWrite);
  return { ...actual, ...scopeSpies };
});

const quoteModel = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  getById: vi.fn(),
}));
vi.mock('@alga-psa/billing/models', () => ({
  Quote: quoteModel,
  QuoteItem: { create: vi.fn(), update: vi.fn(), listByQuoteId: vi.fn(async () => []) },
  QuoteActivity: { create: vi.fn() },
}));

import { QuoteService } from '../../../lib/api/services/QuoteService';
import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';
import { isRecordCreateDeniedError } from '@alga-psa/authorization/recordCreateAuthorization';

const scopeRule = (...clientIds: string[]) => ({
  id: 'scope',
  resource: 'billing',
  action: 'read',
  templateKey: 'selected_clients',
  selectedClientIds: clientIds,
});

const context: any = {
  userId: USER_ID,
  tenant: TENANT_ID,
  user: { user_id: USER_ID, user_type: 'internal', roles: [] },
};

const createBody = (clientId: string, extra: FakeRow = {}) => ({
  client_id: clientId,
  title: 'REST quote',
  quote_date: '2026-03-13',
  valid_until: '2026-03-20',
  currency_code: 'USD',
  is_template: false,
  ...extra,
}) as any;

let service: QuoteService;

beforeEach(() => {
  vi.clearAllMocks();
  state.rules = [];
  state.numbering.issued = 0;
  state.db = createFakeQuoteDb({
    quotes: [{ tenant: TENANT_ID, quote_id: QUOTE_ID, client_id: CLIENT_A, contact_id: null, opportunity_id: null, title: 'Stored' }],
    quote_items: [],
    client_locations: [],
    contacts: [
      { tenant: TENANT_ID, contact_name_id: CONTACT_A, client_id: CLIENT_A },
      { tenant: TENANT_ID, contact_name_id: CONTACT_B, client_id: CLIENT_B },
    ],
    opportunities: [],
    clients: [{ tenant: TENANT_ID, client_id: CLIENT_A, default_currency_code: 'USD' }, { tenant: TENANT_ID, client_id: CLIENT_B, default_currency_code: 'USD' }],
    default_billing_settings: [],
  });
  quoteModel.create.mockImplementation(async (_trx: any, _tenant: string, quote: FakeRow) => {
    state.numbering.issued += 1; // Quote.create is where the quote number is allocated
    const row = { ...quote, quote_id: 'created-quote' };
    state.db.tables.quotes.push(row);
    return { ...row };
  });
  quoteModel.update.mockImplementation(async (_trx: any, _tenant: string, id: string, patch: FakeRow) => {
    const row = state.db.tables.quotes.find((quote: FakeRow) => quote.quote_id === id)!;
    Object.assign(row, patch);
    return { ...row };
  });
  quoteModel.getById.mockImplementation(async (_trx: any, _tenant: string, id: string) =>
    state.db.tables.quotes.find((quote: FakeRow) => quote.quote_id === id) ?? null);
  service = new QuoteService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: state.db, tenant: TENANT_ID });
});

describe('REST create runs the shared create guard (F4)', () => {
  it('denies a caller scoped to client A who creates for client B with the REST 403, before any number is allocated', async () => {
    state.rules = [scopeRule(CLIENT_A)];

    const failure = await service.create(createBody(CLIENT_B), context).then(() => null, (error) => error);

    expect(isRecordCreateDeniedError(failure)).toBe(true);
    expect(scopeSpies.assertQuoteCreateAllowed).toHaveBeenCalledTimes(1);
    expect(scopeSpies.assertQuoteCreateAllowed.mock.calls[0][1].candidate.client_id).toBe(CLIENT_B);
    expect(quoteModel.create).not.toHaveBeenCalled();
    expect(state.numbering.issued).toBe(0);
    expect((await handleApiError(failure)).status).toBe(403);
  });

  it('rejects another client\'s contact for a caller with no scope rules (400, nothing written)', async () => {
    const failure = await service.create(createBody(CLIENT_A, { contact_id: CONTACT_B }), context).then(() => null, (error) => error);

    expect(failure?.name).toBe('ValidationError');
    expect(String(failure?.message)).toContain("contact_id does not belong to this quote's client");
    expect(quoteModel.create).not.toHaveBeenCalled();
  });

  it('creates for the caller\'s own client', async () => {
    state.rules = [scopeRule(CLIENT_A)];
    await expect(service.create(createBody(CLIENT_A), context)).resolves.toBeTruthy();
    expect(state.numbering.issued).toBe(1);
  });
});

describe('REST update runs the shared reparent guard (F3)', () => {
  it('denies a caller scoped to client A who sets client_id to B with the REST 403; the stored quote is unchanged', async () => {
    state.rules = [scopeRule(CLIENT_A)];

    const failure = await service.update(QUOTE_ID, { client_id: CLIENT_B } as any, context).then(() => null, (error) => error);

    expect(failure?.name).toBe('ForbiddenError');
    expect(scopeSpies.authorizeQuoteWrite).toHaveBeenCalledTimes(1);
    expect(scopeSpies.authorizeQuoteWrite.mock.calls[0][1].candidate.client_id).toBe(CLIENT_B);
    expect(quoteModel.update).not.toHaveBeenCalled();
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
    expect((await handleApiError(failure)).status).toBe(403);
  });

  it('rejects an authorized reparent that leaves a stale contact (400), without writing', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    state.db.tables.quotes[0].contact_id = CONTACT_A;

    const failure = await service.update(QUOTE_ID, { client_id: CLIENT_B } as any, context).then(() => null, (error) => error);

    expect(failure?.name).toBe('ValidationError');
    expect(scopeSpies.assertQuotePatchReferencesInScope).toHaveBeenCalledTimes(1);
    expect(quoteModel.update).not.toHaveBeenCalled();
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_A);
  });

  it('allows an authorized reparent with a destination-client contact', async () => {
    state.rules = [scopeRule(CLIENT_A, CLIENT_B)];
    await service.update(QUOTE_ID, { client_id: CLIENT_B, contact_id: CONTACT_B } as any, context);
    expect(state.db.tables.quotes[0].client_id).toBe(CLIENT_B);
  });
});

describe('REST and the server actions share one implementation', () => {
  const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
  const actions = read('../../../../../packages/billing/src/actions/quoteActions.ts');
  const restService = read('../../../lib/api/services/QuoteService.ts');

  it('both import the create, reparent and candidate-authorization guards from quoteScope', () => {
    for (const name of ['assertQuoteCreateAllowed', 'assertQuotePatchReferencesInScope', 'authorizeQuoteWrite']) {
      expect(actions).toContain(name);
      expect(restService).toContain(name);
    }
    expect(actions).toContain("from '../lib/quoteScope'");
    expect(restService).toContain("from '@alga-psa/billing/lib/quoteScope'");
  });

  it('QuoteService no longer carries its own copy of the location ownership logic', () => {
    expect(restService).not.toContain('assertItemLocationsBelongToClient');
    expect(restService).toContain('assertQuoteLocationsOwnedByClient');
  });
});
