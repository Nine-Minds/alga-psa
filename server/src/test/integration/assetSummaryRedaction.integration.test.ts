import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

// Identity/coarse RBAC are fixture boundaries. The route, authorization-record loader, joined SQL,
// kernel (including bundle constraints), and response projector are real.
const state = vi.hoisted(() => ({
  db: null as any, tenant: '', userId: '', clientId: '',
  assetRedactions: [] as string[], ticketRedactions: [] as string[], scopedTickets: false,
}));
const principal = () => ({ user_id: state.userId, tenant: state.tenant, user_type: 'internal' });
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  getCurrentUser: vi.fn(async () => principal()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (request: any) => {
    request.context = { tenant: state.tenant, user: principal(), userId: state.userId, apiKeyId: request.headers.get('x-api-key') };
    return request;
  }),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => state.db) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishNonCatalogWorkflowEvent: vi.fn(),
}));
vi.mock('server/src/lib/authorization/kernel', async () => {
  const { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider } =
    await import('@alga-psa/authorization/kernel');
  const kernel = createAuthorizationKernel({
    rbacEvaluator: async () => true,
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async input => {
      if (input.subject.apiKeyId !== 'summary-restricted') return [];
      return [
        { id: 'summary-asset', resource: 'asset', action: 'read', templateKey: null, constraintKey: 'hide_sensitive_fields', redactedFields: state.assetRedactions },
        { id: 'summary-ticket', resource: 'ticket', action: 'read', templateKey: state.scopedTickets ? 'selected_clients' : null,
          selectedClientIds: state.scopedTickets ? [state.clientId] : [], constraintKey: 'hide_sensitive_fields', redactedFields: state.ticketRedactions },
      ];
    } }),
  });
  return { getAuthorizationKernel: vi.fn(async () => kernel) };
});

const id = {
  tenant: randomUUID(), user: randomUUID(), client: randomUUID(), otherClient: randomUUID(),
  asset: randomUUID(), open: randomUUID(), closed: randomUUID(), ticketA: randomUUID(), ticketB: randomUUID(), ticketClosed: randomUUID(),
};
let db: Knex;
const table = (name: string) => tenantDb(db, id.tenant).table(name);
const tenants = () => tenantDb(db, '__summary_test_fixture__').unscoped('tenants', 'isolated summary test tenant');
const read = async (key = 'summary-restricted') => {
  const { GET } = await import('../../app/api/v1/assets/[id]/summary/route');
  return GET(new Request(`http://localhost/api/v1/assets/${id.asset}/summary`, { headers: { 'x-api-key': key } }),
    { params: Promise.resolve({ id: id.asset }) });
};

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection({ runSeeds: false });
  state.db = db; state.tenant = id.tenant; state.userId = id.user; state.clientId = id.client;
  const columns = await tenants().columnInfo();
  await tenants().insert({ tenant: id.tenant, email: `${id.tenant}@example.com`,
    ...('company_name' in columns ? { company_name: 'Summary projection' } : { client_name: 'Summary projection' }) });
  await table('users').insert({ tenant: id.tenant, user_id: id.user, username: `summary-${id.user}`, hashed_password: 'x',
    email: `${id.user}@example.com`, first_name: 'Summary', last_name: 'Reader', user_type: 'internal' });
  await table('clients').insert([
    { tenant: id.tenant, client_id: id.client, client_name: 'Visible client' },
    { tenant: id.tenant, client_id: id.otherClient, client_name: 'Other client' },
  ]);
  await table('statuses').insert([
    { tenant: id.tenant, status_id: id.open, status_type: 'ticket', name: 'Open', is_closed: false, order_number: 1 },
    { tenant: id.tenant, status_id: id.closed, status_type: 'ticket', name: 'Closed', is_closed: true, order_number: 2 },
  ]);
  await table('asset_statuses').insert({ tenant: id.tenant, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true });
  await table('assets').insert({ tenant: id.tenant, asset_id: id.asset, asset_type: 'workstation', client_id: id.client,
    name: 'Summary laptop', asset_tag: 'SUMMARY-1', status: 'active', warranty_end_date: '2099-01-15',
    agent_status: 'offline', last_seen_at: '2020-01-01T12:00:00Z' });
  await table('workstation_assets').insert({ tenant: id.tenant, asset_id: id.asset, antivirus_status: 'at_risk', antivirus_product: 'Test AV', failed_patches: 7, pending_patches: 42 });
  await table('tickets').insert([
    { tenant: id.tenant, ticket_id: id.ticketA, ticket_number: 'SUMMARY-A', title: 'Visible ticket', client_id: id.client, status_id: id.open },
    { tenant: id.tenant, ticket_id: id.ticketB, ticket_number: 'SUMMARY-B', title: 'Scoped ticket', client_id: id.otherClient, status_id: id.open },
    { tenant: id.tenant, ticket_id: id.ticketClosed, ticket_number: 'SUMMARY-C', title: 'Closed ticket', client_id: id.client, status_id: id.closed },
  ]);
  await table('asset_associations').insert([id.ticketA, id.ticketB, id.ticketClosed].map(entity_id => ({
    tenant: id.tenant, asset_id: id.asset, entity_id, entity_type: 'ticket', created_by: id.user,
  })));
}, 180_000);

beforeEach(() => { state.assetRedactions = []; state.ticketRedactions = []; state.scopedTickets = false; });
afterAll(async () => {
  if (db) {
    for (const name of ['asset_associations', 'workstation_assets', 'assets', 'asset_statuses', 'tickets', 'statuses', 'clients', 'users']) {
      await table(name).del();
    }
    await tenants().where({ tenant: id.tenant }).del();
    await db.destroy();
  }
}, 180_000);

describe('summary joins and real bundle projection', () => {
  it('visible control keeps derived metrics and counts only open statuses', async () => {
    const response = await read('summary-control');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ warranty_status: 'active', health_status: 'critical', security_status: 'critical', open_tickets_count: 2 });
  });
  it('key-scoped asset rules redact derived dates, health and extension text', async () => {
    state.assetRedactions = ['assets.warranty_end_date', 'assets.agent_status', 'values.extension_data.failed_patches'];
    const response = await read();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ warranty_status: null, warranty_days_remaining: null, health_status: null, health_reason: null,
      security_status: null, security_issues: null, open_tickets_count: 2 });
  });
  it('independently scoped tickets do not contribute to the aggregate', async () => {
    state.scopedTickets = true;
    expect((await (await read()).json()).data.open_tickets_count).toBe(1);
  });
  for (const owner of ['asset', 'ticket'] as const) {
    it.each(['asset_associations.entity_id', 'asset_associations.entity_type'])(
      `${owner} policy suppresses counted association membership via %s`, async alias => {
        if (owner === 'asset') state.assetRedactions = [alias];
        else state.ticketRedactions = [alias];
        expect((await (await read()).json()).data.open_tickets_count).toBe(0);
      });
  }
  it('does not use a hidden joined status flag as a predicate', async () => {
    state.ticketRedactions = ['statuses.is_closed'];
    expect((await (await read()).json()).data.open_tickets_count).toBe(0);
  });
  it('whole asset suppression is a not-found response', async () => {
    state.assetRedactions = ['assets'];
    expect((await read()).status).toBe(404);
  });
});
