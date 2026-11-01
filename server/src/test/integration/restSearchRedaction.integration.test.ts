import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

/**
 * Search/filter side channel (alga-2026-0003011): a caller whose `hide_sensitive_fields` rule redacts a column must
 * not be able to learn, through `?search=` or `/search`, that a substring exists in that column. Real services and
 * SQL against a migrated Postgres, the REAL authorization kernel with a published rule assigned to one API key; only
 * the rule store is stubbed. A control key (no rule) must still match the same text.
 */

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const RESTRICTED = 'key-restricted';
const CONTROL = 'key-control';
const SCOPED = 'key-scoped';

const state = vi.hoisted(() => ({ db: null as any, tenant: '', emeraldClient: '' }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: state.db, tenant: state.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

// BaseService resolves its connection through this module, not the package barrel.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db/tenant')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: state.db, tenant: state.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

vi.mock('server/src/lib/authorization/kernel', async () => {
  const { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider } =
    await import('@alga-psa/authorization/kernel');
  const hide = (id: string, resource: string, redactedFields: string[], extra: Record<string, unknown> = {}) =>
    ({ id, resource, action: 'read', templateKey: null, constraintKey: 'hide_sensitive_fields', redactedFields, ...extra });
  const restricted = [
    hide('r-project', 'project', ['description']),
    hide('r-asset', 'asset', ['serial_number']),
    hide('r-ticket', 'ticket', ['title', 'assigned_to']),
    hide('r-quote', 'billing', ['title']),
  ];
  const kernel = createAuthorizationKernel({
    rbacEvaluator: async () => true,
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        if (input.subject.apiKeyId === 'key-restricted') return restricted;
        if (input.subject.apiKeyId === 'key-scoped') {
          return [hide('s-project', 'project', ['description'], { templateKey: 'selected_clients', selectedClientIds: [state.emeraldClient] })];
        }
        return [];
      },
    }),
  });
  return { getAuthorizationKernel: vi.fn(async () => kernel) };
});

let db: Knex;
const tenants = new Set<string>();
const t = (name: string) => tenantDb(db, state.tenant).table(name);
const unscoped = (name: string) => tenantDb(db, '__search_redaction_fixture__').unscoped(name, 'search redaction fixture');

const id = {
  user: randomUUID(), emerald: randomUUID(), oz: randomUUID(), projStatus: randomUUID(),
  projEmerald: randomUUID(), projOz: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
  ticketA: randomUUID(), ticketB: randomUUID(), quoteA: randomUUID(), quoteB: randomUUID(),
};

const ctx = (apiKeyId: string) => ({
  tenant: state.tenant, userId: id.user, db, apiKeyId,
  user: { user_id: id.user, tenant: state.tenant, user_type: 'internal' },
});

beforeAll(async () => {
  wireLocalTestDbEnv();
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  db = await createTestDbConnection({ runSeeds: false });
  state.db = db;
  state.tenant = randomUUID();
  state.emeraldClient = id.emerald;
  tenants.add(state.tenant);
  const tenantCols = await unscoped('tenants').columnInfo();
  await unscoped('tenants').insert({
    tenant: state.tenant,
    ...('company_name' in tenantCols ? { company_name: 'Search Redaction' } : { client_name: 'Search Redaction' }),
    email: `${state.tenant}@example.com`,
  });
  const userCols = await t('users').columnInfo();
  await t('users').insert({
    tenant: state.tenant, user_id: id.user, username: `u-${state.tenant.slice(0, 8)}`, hashed_password: 'x',
    first_name: 'Sam', last_name: 'Search',
    ...('email' in userCols ? { email: `u-${state.tenant.slice(0, 8)}@example.com` } : {}),
    ...('user_type' in userCols ? { user_type: 'internal' } : {}),
  });
  await t('clients').insert([
    { tenant: state.tenant, client_id: id.emerald, client_name: 'Emerald City' },
    { tenant: state.tenant, client_id: id.oz, client_name: 'Oz Holdings' },
  ]);
  await t('statuses').insert({
    tenant: state.tenant, status_id: id.projStatus, name: 'Active', status_type: 'project', order_number: 1,
  });
  await t('projects').insert([
    { tenant: state.tenant, project_id: id.projEmerald, project_name: 'Alpha Rollout', project_number: 'P-1', wbs_code: '1',
      status: id.projStatus, client_id: id.emerald, description: 'zebrafish secret plan' },
    { tenant: state.tenant, project_id: id.projOz, project_name: 'Beta Rollout', project_number: 'P-2', wbs_code: '2',
      status: id.projStatus, client_id: id.oz, description: 'zebrafish at oz' },
  ]);
  await t('asset_statuses').insert([
    { tenant: state.tenant, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 },
  ]);
  await t('assets').insert([
    { tenant: state.tenant, asset_id: id.assetA, asset_type: 'workstation', client_id: id.emerald, asset_tag: 'TAG-ALPHA',
      name: 'Alpha Laptop', status: 'active', serial_number: 'SN-QUOKKA-9' },
    { tenant: state.tenant, asset_id: id.assetB, asset_type: 'workstation', client_id: id.emerald, asset_tag: 'TAG-BETA',
      name: 'Beta Laptop', status: 'active', serial_number: 'SN-OTHER-1' },
  ]);
  await t('tickets').insert([
    { tenant: state.tenant, ticket_id: id.ticketA, ticket_number: 'T-ALPHA-1', client_id: id.emerald, title: 'narwhal outage' },
    { tenant: state.tenant, ticket_id: id.ticketB, ticket_number: 'T-BETA-2', client_id: id.emerald, title: 'plain printer issue' },
  ]);
  await t('quotes').insert([
    { tenant: state.tenant, quote_id: id.quoteA, title: 'pangolin migration', quote_number: 'Q-ALPHA', client_id: id.emerald, is_template: false, status: 'draft' },
    { tenant: state.tenant, quote_id: id.quoteB, title: 'plain renewal', quote_number: 'Q-BETA', client_id: id.emerald, is_template: false, status: 'draft' },
  ]);
}, HOOK_TIMEOUT);

afterAll(async () => {
  for (const tenant of tenants) {
    for (const name of ['quote_items', 'quotes', 'tickets', 'assets', 'asset_statuses', 'projects', 'statuses', 'clients', 'users']) {
      await tenantDb(db, tenant).table(name).del().catch(() => undefined);
    }
    await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
  }
  await db?.destroy().catch(() => undefined);
}, HOOK_TIMEOUT);

const names = (rows: Array<Record<string, any>>, key: string) => rows.map(r => r[key]).sort();

describe('projects: search predicates honor field redactions', () => {
  it('/projects/search: hidden description text matches nothing for the restricted key, the control key still matches', async () => {
    const { ProjectService } = await import('../../lib/api/services/ProjectService');
    const svc = new ProjectService();
    expect(await svc.search({ query: 'zebrafish' } as any, ctx(RESTRICTED) as any)).toEqual([]);
    const control = await svc.search({ query: 'zebrafish' } as any, ctx(CONTROL) as any);
    expect(names(control, 'project_name')).toEqual(['Alpha Rollout', 'Beta Rollout']);
  }, HOOK_TIMEOUT);

  it('/projects/search: an explicit fields=[description] cannot be used to reach the hidden column', async () => {
    const { ProjectService } = await import('../../lib/api/services/ProjectService');
    const svc = new ProjectService();
    expect(await svc.search({ query: 'zebrafish', fields: ['description'] } as any, ctx(RESTRICTED) as any)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('/projects/search: no over-redaction, the restricted key still matches on the visible name', async () => {
    const { ProjectService } = await import('../../lib/api/services/ProjectService');
    const svc = new ProjectService();
    const rows = await svc.search({ query: 'Alpha' } as any, ctx(RESTRICTED) as any);
    expect(names(rows, 'project_name')).toEqual(['Alpha Rollout']);
  }, HOOK_TIMEOUT);

  it('GET /projects?search=: no row and no total for hidden text; control matches; visible name still matches', async () => {
    const { ProjectService } = await import('../../lib/api/services/ProjectService');
    const svc = new ProjectService();
    const filters = { search: 'zebrafish' } as any;
    const restricted = await svc.list({ page: 1, limit: 25, filters }, ctx(RESTRICTED) as any, filters);
    expect(restricted.data).toEqual([]);
    expect(restricted.total).toBe(0);
    const control = await svc.list({ page: 1, limit: 25, filters }, ctx(CONTROL) as any, filters);
    expect(control.total).toBe(2);
    const byName = { search: 'Beta' } as any;
    const visible = await svc.list({ page: 1, limit: 25, filters: byName }, ctx(RESTRICTED) as any, byName);
    expect(names(visible.data, 'project_name')).toEqual(['Beta Rollout']);
    expect(visible.total).toBe(1);
  }, HOOK_TIMEOUT);

  it('row scoping: a selected_clients rule drops out-of-scope rows through the kernel and still hides description text in scope', async () => {
    const { ProjectService } = await import('../../lib/api/services/ProjectService');
    const { projectApiResourceReads } = await import('../../lib/api/controllers/authorizationKernel');
    const svc = new ProjectService();
    const c = ctx(SCOPED) as any;
    const visible = async (filters: any) => {
      const page = await svc.list({ page: 1, limit: 25, filters }, c, filters);
      return projectApiResourceReads({ knex: db, tenant: state.tenant, user: c.user, apiKeyId: SCOPED, kind: 'project', records: page.data });
    };
    // Hidden text: no match, even on the in-scope row (approach (b): unsearchable while any applicable rule redacts it).
    expect(await visible({ search: 'zebrafish' })).toEqual([]);
    // Visible field in scope still matches; the out-of-scope client's row is never served.
    expect(names(await visible({ search: 'Rollout' }), 'project_name')).toEqual(['Alpha Rollout']);
  }, HOOK_TIMEOUT);
});

describe('assets: search predicates honor field redactions', () => {
  it('/assets/search: hidden serial_number matches nothing for the restricted key, control matches', async () => {
    const { AssetService } = await import('../../lib/api/services/AssetService');
    const svc = new AssetService();
    expect(await svc.search({ query: 'QUOKKA' } as any, ctx(RESTRICTED) as any)).toEqual([]);
    expect(await svc.search({ query: 'QUOKKA', fields: ['serial_number'] } as any, ctx(RESTRICTED) as any)).toEqual([]);
    const control = await svc.search({ query: 'QUOKKA' } as any, ctx(CONTROL) as any);
    expect(names(control, 'asset_tag')).toEqual(['TAG-ALPHA']);
  }, HOOK_TIMEOUT);

  it('/assets/search: no over-redaction, name still matches for the restricted key', async () => {
    const { AssetService } = await import('../../lib/api/services/AssetService');
    const svc = new AssetService();
    const rows = await svc.search({ query: 'Beta Laptop' } as any, ctx(RESTRICTED) as any);
    expect(names(rows, 'asset_tag')).toEqual(['TAG-BETA']);
  }, HOOK_TIMEOUT);
});

describe('tickets: search and filter predicates honor field redactions', () => {
  it('/tickets/search: hidden title matches nothing; ticket_number still matches; control matches the title', async () => {
    const { TicketService } = await import('../../lib/api/services/TicketService');
    const svc = new TicketService();
    expect(await svc.search({ query: 'narwhal', include_closed: true } as any, ctx(RESTRICTED) as any)).toEqual([]);
    expect(await svc.search({ query: 'narwhal', fields: ['title'], include_closed: true } as any, ctx(RESTRICTED) as any)).toEqual([]);
    const visible = await svc.search({ query: 'T-ALPHA', include_closed: true } as any, ctx(RESTRICTED) as any);
    expect(names(visible, 'ticket_number')).toEqual(['T-ALPHA-1']);
    const control = await svc.search({ query: 'narwhal', include_closed: true } as any, ctx(CONTROL) as any);
    expect(names(control, 'ticket_number')).toEqual(['T-ALPHA-1']);
  }, HOOK_TIMEOUT);

  it('GET /tickets: ?title=, ?search= and the assigned_to filter cannot probe hidden fields; totals exclude them', async () => {
    const { TicketService } = await import('../../lib/api/services/TicketService');
    const svc = new TicketService();
    const list = (filters: any, key: string) => svc.list({ page: 1, limit: 25, filters }, ctx(key) as any);
    const byTitle = await list({ title: 'narwhal' }, RESTRICTED);
    expect(byTitle.data).toEqual([]);
    expect(byTitle.total).toBe(0);
    expect((await list({ search: 'narwhal' }, RESTRICTED)).total).toBe(0);
    expect((await list({ assigned_to: id.user }, RESTRICTED)).total).toBe(0);
    expect((await list({ has_assignment: false }, RESTRICTED)).total).toBe(0);
    expect((await list({ title: 'narwhal' }, CONTROL)).total).toBe(1);
    const visible = await list({ search: 'T-BETA' }, RESTRICTED);
    expect(names(visible.data, 'ticket_number')).toEqual(['T-BETA-2']);
    expect(visible.total).toBe(1);
  }, HOOK_TIMEOUT);
});

describe('quotes: list search honors billing field redactions', () => {
  it('GET /quotes?search=: hidden title matches nothing; quote_number still matches; control matches the title', async () => {
    const { QuoteService } = await import('../../lib/api/services/QuoteService');
    const svc = new QuoteService();
    const restricted = await svc.list({ search: 'pangolin' } as any, ctx(RESTRICTED) as any);
    expect(restricted.data).toEqual([]);
    expect(restricted.total).toBe(0);
    const visible = await svc.list({ search: 'Q-BETA' } as any, ctx(RESTRICTED) as any);
    expect(names(visible.data, 'quote_number')).toEqual(['Q-BETA']);
    const control = await svc.list({ search: 'pangolin' } as any, ctx(CONTROL) as any);
    expect(names(control.data, 'quote_number')).toEqual(['Q-ALPHA']);
  }, HOOK_TIMEOUT);
});
