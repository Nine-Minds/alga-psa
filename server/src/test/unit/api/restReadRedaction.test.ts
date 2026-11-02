import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * REST read paths serialize the policy-redacted projection, never the source row. The kernel is mocked (as in
 * authorizationKernel.test.ts); the real projector and the real controllers run.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const P1 = '22222222-2222-2222-2222-222222222221';
const P2 = '22222222-2222-2222-2222-222222222222';
const P3 = '22222222-2222-2222-2222-222222222223';

const state = vi.hoisted(() => ({
  /** Kernel decision per record id. Missing => allowed with no redactions. */
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  projects: [] as Record<string, any>[],
  tickets: [] as Record<string, any>[],
  quote: null as Record<string, any> | null,
  assets: [] as Record<string, any>[],
  assetTickets: [] as Record<string, any>[],
  statuses: [] as Record<string, any>[],
  clients: [] as Record<string, any>[],
}));

const authorizeResource = vi.hoisted(() =>
  vi.fn(async (input: { record?: { id?: string } }) =>
    state.decisions.get(input.record?.id ?? '') ?? { allowed: true, redactedFields: [] }
  )
);

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({ authorizeResource })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

// Populated lookups ensure enrichment cannot restore values hidden by the project's decision.
vi.mock('@alga-psa/db', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('@alga-psa/db')>()),
    tenantDb: vi.fn(() => ({
      table: (name: string) => {
        const chain: any = {
          whereIn: () => chain,
          where: () => chain,
          select: async () => name === 'statuses' ? state.statuses : state.clients,
          first: async () => null,
        };
        return chain;
      },
    })),
  };
});
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('../../../lib/api/services/ProjectService', () => ({
  ProjectService: class {
    getById = vi.fn(async (id: string) => state.projects.find((p) => p.project_id === id) ?? null);
    list = vi.fn(async () => ({ data: state.projects, total: state.projects.length }));
    searchProjects = vi.fn(async () => state.projects);
    exportProjects = vi.fn(async () => state.projects);
  },
}));
vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    getById = vi.fn(async (id: string) => state.tickets.find((t) => t.ticket_id === id) ?? null);
    list = vi.fn(async () => ({ data: state.tickets, total: state.tickets.length }));
  },
}));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', () => ({
  resolveAssetAuthorizationRecords: vi.fn(async (_knex: unknown, _tenant: string, rows: { asset_id: string }[]) =>
    new Map(rows.map((row) => [row.asset_id, { id: row.asset_id }]))),
}));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa'), ProductAccessError: class extends Error {} }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));
vi.mock('../../../lib/api/services/AssetService', () => ({
  AssetService: class {
    getAuthorizationRecord = vi.fn(async (id: string) => (state.assets.some((a) => a.asset_id === id) ? { id } : null));
    getWithDetails = vi.fn(async (id: string) => state.assets.find((a) => a.asset_id === id) ?? null);
    list = vi.fn(async () => ({ data: state.assets, total: state.assets.length }));
    search = vi.fn(async () => state.assets);
    getAssetTickets = vi.fn(async () => state.assetTickets);
  },
}));
vi.mock('../../../lib/api/services/QuoteService', () => ({
  QuoteService: class {
    listItems = vi.fn(async () => state.quote?.items ?? []);
    requestChanges = vi.fn(async () => ({ ...state.quote, status: 'draft' }));
    getById = vi.fn(async () => state.quote);
    list = vi.fn(async () => ({ data: state.quote ? [state.quote] : [], total: state.quote ? 1 : 0 }));
  },
}));

import { ApiBaseController } from '../../../lib/api/controllers/ApiBaseController';
import { ApiProjectController } from '../../../lib/api/controllers/ApiProjectController';
import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';
import { ApiQuoteController } from '../../../lib/api/controllers/ApiQuoteController';
import { ApiAssetController } from '../../../lib/api/controllers/ApiAssetController';
import { ApiInventoryController } from '../../../lib/api/controllers/ApiInventoryController';
import { ENTITY_ADAPTERS } from '../../../lib/api/services/documents/entityAdapters';

const user = { user_id: 'user-1', user_type: 'internal', tenant: TENANT };
const context = { tenant: TENANT, user, userId: 'user-1', apiKeyId: 'key-1' };

const project = (id: string, extra: Record<string, any> = {}) => ({
  project_id: id, project_name: `Project ${id.slice(-1)}`, description: 'secret plan', budgeted_hours: 40,
  client_id: 'c-1', client_name: 'Acme', status: 's-1', ...extra,
});

function request(url: string, params?: Record<string, string>) {
  const req = new NextRequest(`http://localhost${url}`, { headers: { 'x-api-key': 'k' } }) as any;
  req.context = context;
  if (params) req.params = Promise.resolve(params);
  return req;
}

beforeEach(() => {
  state.decisions = new Map();
  state.projects = [project(P1), project(P2, { budgeted_hours: 10 }), project(P3, { budgeted_hours: 5 })];
  state.tickets = [];
  state.quote = null;
  state.assets = [];
  state.assetTickets = [];
  state.statuses = [{ status_id: 's-1', name: 'Active' }];
  state.clients = [{ client_id: 'c-1', client_name: 'Acme' }];
  authorizeResource.mockClear();
  vi.spyOn(ApiBaseController.prototype as any, 'authenticate').mockImplementation(async (req: any) => {
    req.context = context;
    return req;
  });
  vi.spyOn(ApiBaseController.prototype as any, 'checkPermission').mockResolvedValue(undefined);
});

const hideProjectFields = (...redactedFields: string[]) => {
  for (const p of state.projects) state.decisions.set(p.project_id, { allowed: true, redactedFields });
};

describe('projects: REST reads serialize the projection', () => {
  const controller = () => new ApiProjectController();

  it('get returns the redacted record when allowed', async () => {
    hideProjectFields('description', 'budgeted_hours');
    const res = await controller().getById()(request(`/api/v1/projects/${P1}`, { id: P1 }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ project_id: P1, project_name: 'Project 1' });
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('budgeted_hours');
  });

  it('a suppressed get is a 404, never a 403', async () => {
    state.decisions.set(P1, { allowed: true, redactedFields: ['values.project_id'] });
    expect((await controller().getById()(request(`/api/v1/projects/${P1}`, { id: P1 }))).status).toBe(404);
    state.decisions.set(P1, { allowed: true, redactedFields: ['projects'] });
    expect((await controller().getById()(request(`/api/v1/projects/${P1}`, { id: P1 }))).status).toBe(404);
    state.decisions.set(P1, { allowed: false, redactedFields: [] });
    expect((await controller().getById()(request(`/api/v1/projects/${P1}`, { id: P1 }))).status).toBe(404);
  });

  it('list omits hidden fields, drops suppressed rows and does not count them', async () => {
    hideProjectFields('description');
    state.decisions.set(P2, { allowed: true, redactedFields: ['values.project_id'] });
    const res = await controller().list()(request('/api/v1/projects?page=1&limit=25'));
    const body = await res.json();
    expect(body.data.map((p: any) => p.project_id)).toEqual([P1, P3]);
    expect(body.data.every((p: any) => !('description' in p))).toBe(true);
    expect(body.pagination.total).toBe(2);
  });

  it('search omits hidden fields and drops suppressed rows', async () => {
    hideProjectFields('projects.description');
    state.decisions.set(P3, { allowed: true, redactedFields: ['*'] });
    const res = await controller().search()(request('/api/v1/projects/search?query=x'));
    const { data } = await res.json();
    expect(data.map((p: any) => p.project_id)).toEqual([P1, P2]);
    expect(data.every((p: any) => !('description' in p) && p.project_name)).toBe(true);
  });

  it('export (json and csv) omits hidden fields', async () => {
    hideProjectFields('description', 'budgeted_hours');
    const json = await controller().export()(request('/api/v1/projects/export?format=json'));
    const { data } = await json.json();
    expect(data).toHaveLength(3);
    expect(data.every((p: any) => !('description' in p) && !('budgeted_hours' in p))).toBe(true);

    const csv = await controller().export()(request('/api/v1/projects/export?format=csv'));
    const text = await csv.text();
    expect(text.split('\n')[0]).not.toMatch(/description|budgeted_hours/);
    expect(text).not.toContain('secret plan');
  });

  it('stats exclude hidden values from aggregates', async () => {
    const visible = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(visible.data.total_budgeted_hours).toBe(55);
    expect(visible.data.top_clients_by_project_count).toEqual([
      { client_name: 'Acme', project_count: 3 },
    ]);

    hideProjectFields('budgeted_hours');
    state.decisions.set(P3, { allowed: true, redactedFields: ['projects'] });
    const hidden = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(hidden.data.total_projects).toBe(2);
    expect(hidden.data.total_budgeted_hours).toBe(0);
  });

  it('stats preserve projected client-name redactions despite populated client lookup data', async () => {
    hideProjectFields('client_name');

    const detail = await (await controller().getById()(request(`/api/v1/projects/${P1}`, { id: P1 }))).json();
    expect(detail.data.client_name).toBeNull();

    const stats = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(stats.data.top_clients_by_project_count).toEqual([
      { client_name: null, project_count: 3 },
    ]);
  });

  it.each(['statuses', 'statuses.name', 'status_name', 'status', 'values.status', 'projects.status'])(
    'stats preserve visible status aggregates and exclude status values hidden by %s', async (alias) => {
      state.statuses = ['Active', 'Completed', 'On Hold', 'Cancelled'].map((name, index) => ({
        status_id: `s-${index + 1}`, name,
      }));
      state.projects = state.statuses.map(({ status_id }, index) => project(
        `22222222-2222-2222-2222-22222222222${index + 1}`,
        { status: status_id, end_date: '2000-01-01', updated_at: new Date().toISOString() },
      ));
      const visible = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
      expect(visible.data).toMatchObject({
        active_projects: 1, completed_projects: 1, on_hold_projects: 1, cancelled_projects: 1,
        overdue_projects: 3, projects_completed_this_month: 1,
        projects_by_status: { Active: 1, Completed: 1, 'On Hold': 1, Cancelled: 1 },
      });

      hideProjectFields(alias);
      const hidden = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
      expect(hidden.data).toMatchObject({
        total_projects: 4,
        active_projects: 0, completed_projects: 0, on_hold_projects: 0, cancelled_projects: 0,
        overdue_projects: 0, projects_completed_this_month: 0,
        projects_by_status: { unknown: 4 },
      });
    },
  );

  it('stats enrich each project under its original decision without reauthorizing', async () => {
    state.statuses = [{ status_id: 's-1', name: 'Active' }, { status_id: 's-2', name: 'Completed' }];
    state.projects = [project(P1), project(P2, { status: 's-2' })];
    state.decisions.set(P1, { allowed: true, redactedFields: ['statuses.name'] });

    const response = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(response.data).toMatchObject({
      total_projects: 2, active_projects: 0, completed_projects: 1,
      projects_by_status: { unknown: 1, Completed: 1 },
    });
    expect(authorizeResource).toHaveBeenCalledTimes(2);
  });
});

describe('tickets: REST reads serialize the projection', () => {
  const TICKET = '33333333-3333-3333-3333-333333333331';
  beforeEach(() => {
    state.tickets = [{
      ticket_id: TICKET,
      title: 'Printer',
      client_id: 'c-1',
      client_logo_url: '/client-logo.png',
      contact_name_id: 'contact-1',
      contact_avatar_url: '/contact-avatar.png',
      assigned_to: 'u-9',
      assigned_to_name: 'Pat Doe',
      entered_by: 'u-2',
      entered_by_name: 'Jo Doe',
      board_id: 'board-1',
      board_name: 'Security board',
      subcategory_id: 'subcategory-1',
      subcategory_name: 'Sensitive category',
      attributes: { body: 'secret' },
      description_html: '<p>secret</p>',
      status_name: 'Open',
    }];
  });

  it('get nulls derived values and omits hidden fields; suppressed get is 404', async () => {
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['assigned_to'] });
    const res = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    const { data } = await res.json();
    expect(data).not.toHaveProperty('assigned_to');
    expect(data.assigned_to_name).toBeNull();
    expect(data.title).toBe('Printer');

    state.decisions.set(TICKET, { allowed: true, redactedFields: ['tickets'] });
    const hidden = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    expect(hidden.status).toBe(404);
  });

  it.each(['tickets.assigned_to', 'values.assigned_to'])(
    'get nulls assigned_to_name when its dependency is redacted as %s', async (alias) => {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const res = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
      const { data } = await res.json();

      expect(data).not.toHaveProperty('assigned_to');
      expect(data.assigned_to_name).toBeNull();
      expect(data.title).toBe('Printer');
    },
  );

  it.each([
    ['entered_by', 'entered_by_name'],
    ['board_id', 'board_name'],
    ['subcategory_id', 'subcategory_name'],
    ['attributes', 'description_html'],
    ['contact_name_id', 'contact_avatar_url'],
    ['client_id', 'client_logo_url'],
  ])('preserves %s-derived values only for readers who can see the source', async (sourceField, derivedField) => {
    const visible = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    const visibleData = (await visible.json()).data;
    expect(visibleData[derivedField]).toBe(state.tickets[0][derivedField]);

    state.decisions.set(TICKET, { allowed: true, redactedFields: [sourceField] });
    const hidden = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    const hiddenData = (await hidden.json()).data;
    expect(hiddenData).not.toHaveProperty(sourceField);
    expect(hiddenData[derivedField]).toBeNull();
    expect(hiddenData.title).toBe('Printer');
  });
});

describe('quotes: REST reads serialize the projection', () => {
  const QUOTE = '44444444-4444-4444-4444-444444444441';
  beforeEach(() => {
    state.quote = {
      quote_id: QUOTE, title: 'Q', quote_number: 'QUO-1', version: 2,
      display_quote_number: 'QUO-1 v2', subtotal: 10, tax: 1, total_amount: 11, created_by: 'u-1',
      items: [{ quote_item_id: 'i-1', unit_price: 5, quantity: 2, total_price: 10, cost: 3 }],
    };
  });

  it('nulls display_quote_number when quote_number is hidden and preserves it otherwise', async () => {
    const visible = await new ApiQuoteController().getById()(request(`/api/v1/quotes/${QUOTE}`, { id: QUOTE }));
    expect((await visible.json()).data.display_quote_number).toBe('QUO-1 v2');

    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['quote_number'] });
    const hidden = await new ApiQuoteController().getById()(request(`/api/v1/quotes/${QUOTE}`, { id: QUOTE }));
    const hiddenData = (await hidden.json()).data;
    expect(hiddenData).not.toHaveProperty('quote_number');
    expect(hiddenData.display_quote_number).toBeNull();
  });

  it('get hides cost/margin style fields, nulls computed totals and suppresses with 404', async () => {
    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['cost', 'tax'] });
    const res = await new ApiQuoteController().getById()(request(`/api/v1/quotes/${QUOTE}`, { id: QUOTE }));
    const { data } = await res.json();
    expect(data).not.toHaveProperty('tax');
    expect(data.total_amount).toBeNull();
    expect(data.items[0]).not.toHaveProperty('cost');

    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['billing'] });
    expect((await new ApiQuoteController().getById()(request(`/api/v1/quotes/${QUOTE}`, { id: QUOTE }))).status).toBe(404);
  });
});

describe('assets / inventory lookup and document adapters', () => {
  it('inventory lookup authorizer returns redacted asset projections and drops suppressed assets', async () => {
    const Controller = ApiInventoryController;
    state.decisions.set('a-1', { allowed: true, redactedFields: ['vendor_id'] });
    state.decisions.set('a-2', { allowed: true, redactedFields: ['assets'] });
    const authorizer = (new Controller() as any).buildAssetLookupAuthorizer({ context });
    const readable = await authorizer({}, [
      { asset_id: 'a-1', vendor_id: 'v', vendor_name: 'Dell', name: 'PC' },
      { asset_id: 'a-2', name: 'Hidden' },
    ]);
    expect(readable).toEqual([{ asset_id: 'a-1', vendor_name: null, name: 'PC' }]);
  });

  it('project_task attach adapter answers 404 for a suppressed or denied parent project (gate only)', async () => {
    const { tenantDb } = await import('@alga-psa/db');
    const taskChain = () => {
      const chain: any = { where: () => chain, tenantJoin: () => undefined, first: async () => ({ project_id: 'p-1' }) };
      return { table: () => chain, tenantJoin: () => undefined };
    };
    for (const decision of [
      { allowed: true, redactedFields: ['projects'] },
      { allowed: false, redactedFields: [] },
    ]) {
      state.decisions.set('p-1', decision);
      (tenantDb as any).mockReturnValueOnce(taskChain());
      await expect(
        ENTITY_ADAPTERS.project_task.assertCanAttach({ context } as any, 't-1', {} as any)
      ).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it('ticket attach adapter answers 404 for a suppressed ticket (gate only)', async () => {
    state.decisions.set('t-1', { allowed: true, redactedFields: ['tickets'] });
    const { tenantDb } = await import('@alga-psa/db');
    (tenantDb as any).mockReturnValueOnce({ table: () => ({ where: () => ({ first: async () => ({ ticket_id: 't-1' }) }) }) });
    await expect(
      ENTITY_ADAPTERS.ticket.assertCanAttach({ context } as any, 't-1', {} as any)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});


describe('asset routes serialize the projection', () => {
  const A1 = 'a-1', A2 = 'a-2';
  const asset = (id: string, extra: Record<string, any> = {}) => ({
    asset_id: id, name: `Asset ${id}`, serial_number: 'SN-1', purchase_price: 900, vendor_id: 'v-1', vendor_name: 'Dell', ...extra,
  });
  const controller = () => new ApiAssetController();
  beforeEach(() => {
    state.assets = [asset(A1), asset(A2)];
  });

  it('get serializes the detailed record under one decision, redacted', async () => {
    state.decisions.set(A1, { allowed: true, redactedFields: ['serial_number', 'vendor_id'] });
    state.assets = [asset(A1, { documents: [{ document_id: 'd-1' }] })];
    const res = await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ asset_id: A1, name: 'Asset a-1', documents: [{ document_id: 'd-1' }] });
    expect(data).not.toHaveProperty('serial_number');
    expect(data.vendor_name).toBeNull();
    expect(authorizeResource).toHaveBeenCalledTimes(1);
  });

  it('a suppressed or denied get is 404', async () => {
    state.decisions.set(A1, { allowed: true, redactedFields: ['assets'] });
    expect((await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 })).status).toBe(404);
    state.decisions.set(A1, { allowed: false, redactedFields: [] });
    expect((await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 })).status).toBe(404);
  });

  it('list omits hidden fields and drops suppressed rows from rows and total', async () => {
    state.decisions.set(A1, { allowed: true, redactedFields: ['purchase_price'] });
    state.decisions.set(A2, { allowed: true, redactedFields: ['asset_id'] });
    const body = await (await controller().list(request('/api/v2/assets?page=1&limit=25'))).json();
    expect(body.data.map((a: any) => a.asset_id)).toEqual([A1]);
    expect(body.data[0]).not.toHaveProperty('purchase_price');
    expect(body.meta?.total ?? body.pagination?.total).toBe(1);
  });

  it('search and export (csv and json) omit hidden fields and suppressed rows', async () => {
    state.decisions.set(A1, { allowed: true, redactedFields: ['purchase_price'] });
    state.decisions.set(A2, { allowed: true, redactedFields: ['*'] });
    const search = await (await controller().search(request('/api/v2/assets/search?query=x'))).json();
    expect(search.data.map((a: any) => a.asset_id)).toEqual([A1]);
    expect(search.data[0]).not.toHaveProperty('purchase_price');

    state.decisions.set(A2, { allowed: true, redactedFields: ['purchase_price'] });
    const json = await (await controller().export(request('/api/v2/assets/export?format=json'))).json();
    expect(json.data).toHaveLength(2);
    expect(json.data.every((a: any) => !('purchase_price' in a))).toBe(true);
    const csv = await (await controller().export(request('/api/v2/assets/export?format=csv'))).text();
    expect(csv.split('\n')[0]).not.toContain('purchase_price');
    expect(csv).not.toContain('900');
  });

  it('asset tickets are redacted under the ticket policy and hidden tickets dropped', async () => {
    state.assets = [asset(A1)];
    state.assetTickets = [
      { ticket_id: 't-1', title: 'Visible', assigned_to: 'u-9' },
      { ticket_id: 't-2', title: 'Hidden' },
    ];
    state.decisions.set('t-1', { allowed: true, redactedFields: ['assigned_to'] });
    state.decisions.set('t-2', { allowed: true, redactedFields: ['tickets'] });
    const { data } = await (await controller().listTickets(request(`/api/v1/assets/${A1}/tickets`), { id: A1 })).json();
    expect(data).toEqual([{ ticket_id: 't-1', title: 'Visible' }]);
  });
});

describe('quote responses and items are projected', () => {
  const QUOTE = '44444444-4444-4444-4444-444444444442';
  beforeEach(() => {
    state.quote = {
      quote_id: QUOTE, title: 'Q', status: 'pending_approval', subtotal: 10, tax: 1, created_by: 'u-1',
      items: [{ quote_item_id: 'i-1', unit_price: 5, quantity: 2, total_price: 10, description: 'Line' }],
    };
  });

  it('requestChanges serializes the post-mutation quote redacted', async () => {
    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['subtotal'] });
    const req = request(`/api/v1/quotes/${QUOTE}/request-changes`, { id: QUOTE }) as any;
    req.text = async () => JSON.stringify({ reason: 'please revise' });
    const res = await new ApiQuoteController().requestChanges()(req);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe('draft');
    expect(data).not.toHaveProperty('subtotal');
    expect(data.created_by).toBe('u-1');
  });

  it('items GET hides redacted line prices and nulls totals derived from them', async () => {
    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['unit_price'] });
    const res = await new ApiQuoteController().listItems()(request(`/api/v1/quotes/${QUOTE}/items`, { id: QUOTE }));
    const { data } = await res.json();
    expect(data[0]).not.toHaveProperty('unit_price');
    expect(data[0].total_price).toBeNull();
    expect(data[0].description).toBe('Line');
  });
});
