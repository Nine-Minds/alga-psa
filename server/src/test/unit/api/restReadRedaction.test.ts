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
  quoteVersions: [] as Record<string, any>[],
  conversionPreview: null as Record<string, any> | null,
  assets: [] as Record<string, any>[],
  assetAuthorizationRecords: new Map<string, Record<string, any>>(),
  assetReadAllowed: true,
  deployableStatusSlugs: ['active'] as string[],
  maintenanceSchedules: [] as Record<string, any>[],
  assetAssignments: [] as Record<string, any>[],
  maintenanceHistory: [] as Record<string, any>[],
  assetTickets: [] as Record<string, any>[],
  statuses: [] as Record<string, any>[],
  clients: [] as Record<string, any>[],
}));

const authorizeResource = vi.hoisted(() =>
  vi.fn(async (input: { record?: { id?: string }; recordContext?: { id?: string } }) =>
    state.decisions.get(input.record?.id ?? input.recordContext?.id ?? '') ?? { allowed: true, redactedFields: [] }
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
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => state.assetReadAllowed) }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', user_type: 'internal' })),
}));
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
    new Map(rows.map((row) => [row.asset_id, state.assetAuthorizationRecords.get(row.asset_id) ?? { id: row.asset_id }]))),
}));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa'), ProductAccessError: class extends Error {} }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));
vi.mock('../../../lib/api/services/AssetService', () => ({
  AssetService: class {
    getAuthorizationRecord = vi.fn(async (id: string) =>
      state.assetAuthorizationRecords.get(id) ?? (state.assets.some((a) => a.asset_id === id) ? { id } : null));
    getWithDetails = vi.fn(async (id: string) => state.assets.find((a) => a.asset_id === id) ?? null);
    getAssetDocuments = vi.fn(async (id: string) => state.assets.find((a) => a.asset_id === id)?.documents ?? []);
    update = vi.fn(async (id: string, values: Record<string, any>) => {
      const asset = state.assets.find((a) => a.asset_id === id);
      return asset ? { ...asset, ...values } : null;
    });
    getAssetRelationships = vi.fn(async (id: string) => state.assets.find((a) => a.asset_id === id)?.relationships ?? []);
    getMaintenanceSchedules = vi.fn(async (id: string) => state.assets.find((a) => a.asset_id === id)?.maintenance_schedules ?? []);
    getAssetAssignments = vi.fn(async () => state.assetAssignments);
    getMaintenanceHistory = vi.fn(async () => state.maintenanceHistory);
    getMaintenanceScheduleForUpdate = vi.fn(async (scheduleId: string) =>
      state.maintenanceSchedules.find((schedule) => schedule.schedule_id === scheduleId) ?? null);
    updateMaintenanceSchedule = vi.fn(async (scheduleId: string, values: Record<string, any>) => {
      const schedule = state.maintenanceSchedules.find((item) => item.schedule_id === scheduleId);
      return schedule ? { ...schedule, ...values } : null;
    });
    list = vi.fn(async () => ({ data: state.assets, total: state.assets.length }));
    search = vi.fn(async () => state.assets);
    getAssetTickets = vi.fn(async () => state.assetTickets);
    getDeployableStatusSlugs = vi.fn(async () => state.deployableStatusSlugs);
    getMaintenanceSchedulesForAssets = vi.fn(async (_context: unknown, assetIds: string[]) =>
      state.maintenanceSchedules.filter((schedule) => assetIds.includes(schedule.asset_id)));
  },
}));
vi.mock('../../../lib/api/services/QuoteService', () => ({
  QuoteService: class {
    listItems = vi.fn(async () => state.quote?.items ?? []);
    requestChanges = vi.fn(async () => ({ ...state.quote, status: 'draft' }));
    getById = vi.fn(async () => state.quote);
    list = vi.fn(async () => ({ data: state.quote ? [state.quote] : [], total: state.quote ? 1 : 0 }));
    listVersions = vi.fn(async () => state.quoteVersions);
    getConversionPreview = vi.fn(async () => state.conversionPreview);
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
  state.quoteVersions = [];
  state.conversionPreview = null;
  state.assets = [];
  state.assetAuthorizationRecords = new Map();
  state.assetReadAllowed = true;
  state.deployableStatusSlugs = ['active'];
  state.maintenanceSchedules = [];
  state.assetAssignments = [];
  state.maintenanceHistory = [];
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

  it('update response keeps hidden ticket fields hidden while preserving visible fields', async () => {
    state.tickets = [{ ...state.tickets[0], description: 'Sensitive details', priority: 'high' }];
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['tickets.title', 'description'] });
    const controller = new ApiTicketController();
    (controller as any).validateData = vi.fn(async () => ({ title: 'Updated title' }));
    (controller as any).service.update = vi.fn(async () => ({
      ...state.tickets[0], title: 'Updated title', description: 'Sensitive details', priority: 'high',
    }));

    const hidden = await controller.update()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    expect(hidden.status).toBe(200);
    const data = (await hidden.json()).data;
    expect(data).not.toHaveProperty('title');
    expect(data).not.toHaveProperty('description');
    expect(data.priority).toBe('high');

    state.decisions.delete(TICKET);
    const visible = await controller.update()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }));
    expect((await visible.json()).data).toMatchObject({ title: 'Updated title', description: 'Sensitive details', priority: 'high' });
  });
});

describe('quotes: REST reads serialize the projection', () => {
  const QUOTE = '44444444-4444-4444-4444-444444444441';
  const buildPreview = async (redactedFields: string[], quote_items: Record<string, any>[]) => {
    const { buildQuoteConversionPreview } = await import('../../../../../packages/billing/src/services/quoteConversionService');
    state.quote = { quote_id: QUOTE, tenant: TENANT, created_by: 'u-1', quote_items };
    state.conversionPreview = await buildQuoteConversionPreview(state.quote as any);
    state.decisions.set(QUOTE, { allowed: true, redactedFields });
    const response = await new ApiQuoteController().conversionPreview()(
      request(`/api/v1/quotes/${QUOTE}/conversion-preview`, { id: QUOTE }),
    );
    expect(response.status).toBe(200);
    return (await response.json()).data;
  };

  const recurringDiscountItems = () => [
    {
      quote_item_id: 'recurring-line', quote_id: QUOTE, tenant: TENANT, description: 'Sensitive recurring description',
      service_id: 'svc-1', quantity: 1, unit_price: 400, total_price: 400, is_optional: false,
      is_selected: true, is_recurring: true, is_discount: false, billing_frequency: 'annually',
    },
    {
      quote_item_id: 'recurring-discount', quote_id: QUOTE, tenant: TENANT, description: 'Discount',
      quantity: 1, unit_price: 0, total_price: 0, is_optional: false, is_selected: true,
      is_recurring: true, is_discount: true, discount_type: 'percentage', discount_percentage: 25,
    },
  ];

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
    expect(data.tax).toBeNull();
    expect(data.total_amount).toBeNull();
    expect(data.items[0]).not.toHaveProperty('cost');

    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['billing'] });
    expect((await new ApiQuoteController().getById()(request(`/api/v1/quotes/${QUOTE}`, { id: QUOTE }))).status).toBe(404);
  });

  it('authorizes and projects each quote revision independently', async () => {
    const v1 = `${QUOTE}-v1`;
    const v2 = `${QUOTE}-v2`;
    const v3 = `${QUOTE}-v3`;
    state.quoteVersions = [
      { quote_id: v1, title: 'Visible revision', version: 1, subtotal: 9876 },
      { quote_id: v2, title: 'Denied revision', version: 2, subtotal: 4321 },
      { quote_id: v3, title: 'Suppressed revision', version: 3, subtotal: 1111 },
    ];
    state.decisions.set(QUOTE, { allowed: true, redactedFields: [] });
    state.decisions.set(v1, { allowed: true, redactedFields: ['subtotal'] });
    state.decisions.set(v2, { allowed: false, redactedFields: [] });
    state.decisions.set(v3, { allowed: true, redactedFields: ['quote_id'] });

    const response = await new ApiQuoteController().listVersions()(
      request(`/api/v1/quotes/${QUOTE}/revisions`, { id: QUOTE }),
    );
    const { data } = await response.json();

    expect(data).toEqual([{ quote_id: v1, title: 'Visible revision', version: 1, subtotal: null }]);
    expect(authorizeResource.mock.calls.map(([input]) => input.record?.id)).toEqual([QUOTE, v1, v2, v3]);
  });

  it('projects conversion preview lines and totals from the real preview builder', async () => {
    const { buildQuoteConversionPreview } = await import('../../../../../packages/billing/src/services/quoteConversionService');
    const quote = {
      quote_id: QUOTE,
      tenant: TENANT,
      quote_items: [{
        quote_item_id: 'preview-line', quote_id: QUOTE, tenant: TENANT, description: 'Hidden price line',
        quantity: 1, unit_price: 4938, total_price: 4938, is_optional: false, is_selected: true,
        is_recurring: false, is_discount: false,
      }],
    } as any;
    state.conversionPreview = await buildQuoteConversionPreview(quote);
    state.decisions.set(QUOTE, { allowed: true, redactedFields: ['unit_price'] });

    const response = await new ApiQuoteController().conversionPreview()(
      request(`/api/v1/quotes/${QUOTE}/conversion-preview`, { id: QUOTE }),
    );
    const { data } = await response.json();

    expect(data.invoice_items).toHaveLength(1);
    expect(data.invoice_items[0]).not.toHaveProperty('unit_price');
    expect(data.invoice_items[0].total_price).toBeNull();
    expect(data.contract_monthly_total).toBeNull();
    expect(data.available_actions).toBeNull();
    expect(data.invoice_error).toBeNull();
    expect(JSON.stringify(data)).not.toContain('4938');
  });

  it('projects copied and derived recurring discount fields under their source aliases', async () => {
    const visible = await buildPreview([], recurringDiscountItems());
    expect(visible.contract_discounts[0].line_description).toBe('Sensitive recurring description');
    expect(visible.contract_discounts[0].percentage).toBe(25);
    expect(visible.contract_monthly_total).toBeGreaterThan(0);

    const hiddenDescription = await buildPreview(['quote_items.description'], recurringDiscountItems());
    expect(hiddenDescription.contract_discounts[0].line_description).toBeNull();
    expect(JSON.stringify(hiddenDescription)).not.toContain('Sensitive recurring description');

    const hiddenPercentage = await buildPreview(['quote_items.discount_percentage'], recurringDiscountItems());
    expect(hiddenPercentage.contract_discounts[0].percentage).toBeNull();
    expect(hiddenPercentage.contract_discounts[0].amount).toBeNull();
  });

  it.each(['quote_items.billing_frequency', 'quote_items.is_selected', 'quote_items.is_recurring'])(
    'nulls recurring monthly totals when %s is hidden', async (field) => {
      const data = await buildPreview([field], recurringDiscountItems());
      expect(data.contract_monthly_before_discounts).toBeNull();
      expect(data.contract_monthly_total).toBeNull();
    },
  );
});

describe('remaining REST projection consumers', () => {
  it('project update response reuses the read decision and retains the unrestricted response shape', async () => {
    hideProjectFields('description', 'budgeted_hours');
    const controller = new ApiProjectController();
    (controller as any).validateData = vi.fn(async () => ({ project_name: 'Renamed' }));
    (controller as any).service.update = vi.fn(async () => ({ ...state.projects[0], project_name: 'Renamed' }));

    const hidden = await controller.update()(request(`/api/v1/projects/${P1}`, { id: P1 }));
    expect(hidden.status).toBe(200);
    const redacted = (await hidden.json()).data;
    expect(redacted).toMatchObject({ project_id: P1, project_name: 'Renamed' });
    expect(redacted).not.toHaveProperty('description');
    expect(redacted).not.toHaveProperty('budgeted_hours');

    state.decisions.delete(P1);
    const visible = await controller.update()(request(`/api/v1/projects/${P1}`, { id: P1 }));
    expect((await visible.json()).data).toMatchObject({ project_name: 'Renamed', description: 'secret plan', budgeted_hours: 40 });
  });

  it('ticket bundle independently projects complete master and child records', async () => {
    const masterId = '33333333-3333-3333-3333-333333333331';
    const childId = '33333333-3333-3333-3333-333333333332';
    const master = { ticket_id: masterId, title: 'Sensitive master', ticket_number: 'T-1', client_id: 'c-1' };
    const child = { ticket_id: childId, title: 'Visible child', ticket_number: 'T-2', client_id: 'c-2' };
    state.tickets = [
      { ...master, entered_by: 'master-owner', assigned_to: 'master-assignee', board_id: 'board-master', assigned_team_id: 'team-master' },
      { ...child, entered_by: 'child-owner', assigned_to: 'child-assignee', board_id: 'board-child', assigned_team_id: 'team-child' },
    ];
    state.decisions.set(masterId, { allowed: true, redactedFields: ['tickets.title'] });
    state.decisions.set(childId, { allowed: true, redactedFields: ['tickets.ticket_number'] });
    const controller = new ApiTicketController();
    (controller as any).ticketService.getBundle = vi.fn(async () => ({
      role: 'master', master_ticket_id: masterId, master, children: [child], settings: null,
    }));

    const response = await controller.getBundle()(request(`/api/v1/tickets/${masterId}/bundle`, { id: masterId }));
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.master).not.toHaveProperty('title');
    expect(data.children[0]).toMatchObject({ ticket_id: childId, title: 'Visible child' });
    expect(data.children[0]).not.toHaveProperty('ticket_number');
    expect(data.master_ticket_id).toBe(masterId);

    for (const [id, owner, assignee, board, team] of [
      [masterId, 'master-owner', 'master-assignee', 'board-master', 'team-master'],
      [childId, 'child-owner', 'child-assignee', 'board-child', 'team-child'],
    ]) {
      expect(authorizeResource.mock.calls.some(([input]) => input.record?.id === id
        && input.record.ownerUserId === owner
        && input.record.assignedUserIds.includes(assignee)
        && input.record.boardId === board
        && input.record.teamIds.includes(team))).toBe(true);
    }

    state.decisions.delete(masterId);
    state.decisions.delete(childId);
    const unrestricted = await controller.getBundle()(request(`/api/v1/tickets/${masterId}/bundle`, { id: masterId }));
    const visible = (await unrestricted.json()).data;
    expect(visible.master.title).toBe('Sensitive master');
    expect(visible.children[0]).toMatchObject({ title: 'Visible child', ticket_number: 'T-2' });
  });

  it('ticket bundle returns 404 for a denied requested ticket and hides a suppressed master identifier', async () => {
    const masterId = '33333333-3333-3333-3333-333333333331';
    const childId = '33333333-3333-3333-3333-333333333332';
    const master = { ticket_id: masterId, title: 'Master' };
    const child = { ticket_id: childId, title: 'Child', master_ticket_id: masterId };
    state.tickets = [master, child];
    const controller = new ApiTicketController();
    const getBundle = vi.fn(async () => ({ role: 'child', master_ticket_id: masterId, master, children: [child], settings: null }));
    (controller as any).ticketService.getBundle = getBundle;

    state.decisions.set(childId, { allowed: false, redactedFields: [] });
    const denied = await controller.getBundle()(request(`/api/v1/tickets/${childId}/bundle`, { id: childId }));
    expect(denied.status).toBe(404);
    expect(getBundle).not.toHaveBeenCalled();

    state.decisions.set(childId, { allowed: true, redactedFields: [] });
    state.decisions.set(masterId, { allowed: true, redactedFields: ['tickets.ticket_id'] });
    const suppressedMaster = await controller.getBundle()(request(`/api/v1/tickets/${childId}/bundle`, { id: childId }));
    expect(suppressedMaster.status).toBe(404);
    expect(await suppressedMaster.text()).not.toContain(masterId);
  });

  it.each(['detail', 'relationships'])('related asset names honor parent aliases on %s', async (endpoint) => {
    const id = 'alias-parent', relatedId = 'alias-related';
    state.assets = [{ asset_id: id, name: 'Visible parent', relationships: [{
      relationship_id: 'r-alias', related_asset_id: relatedId, related_asset_name: 'Sensitive related label', status: 'active',
    }] }];
    state.assetAuthorizationRecords.set(relatedId, { id: relatedId });
    const controller = new ApiAssetController();
    const get = () => endpoint === 'detail'
      ? controller.getById(request(`/api/v2/assets/${id}`), { id })
      : controller.listRelationships(request(`/api/v2/assets/${id}/relationships`), { id });

    expect(JSON.stringify((await (await get()).json()).data)).toContain('Sensitive related label');
    for (const alias of ['values.name', 'fields.values.name', 'fields.assets.name', 'fields.name']) {
      state.decisions.set(id, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      expect(JSON.stringify((await response.json()).data)).not.toContain('Sensitive related label');
      state.decisions.clear();
    }
  });

  it.each(['detail', 'relationships'])('related asset names honor their own aliases on %s', async (endpoint) => {
    const id = 'alias-parent', relatedId = 'alias-related';
    state.assets = [{ asset_id: id, name: 'Visible parent', relationships: [{
      relationship_id: 'r-alias', related_asset_id: relatedId, related_asset_name: 'Sensitive related label', status: 'active',
    }] }];
    state.assetAuthorizationRecords.set(relatedId, { id: relatedId });
    const controller = new ApiAssetController();
    const get = () => endpoint === 'detail'
      ? controller.getById(request(`/api/v2/assets/${id}`), { id })
      : controller.listRelationships(request(`/api/v2/assets/${id}/relationships`), { id });

    for (const alias of ['values.name', 'fields.values.name', 'fields.assets.name', 'fields.name']) {
      state.decisions.set(relatedId, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      expect(JSON.stringify((await response.json()).data)).not.toContain('Sensitive related label');
      state.decisions.clear();
    }
    expect(JSON.stringify((await (await get()).json()).data)).toContain('Sensitive related label');
  });

  it.each(['updateStatus', 'updateAssignment'])('%s reuses ticket read redactions and preserves unrestricted fields', async (method) => {
    const id = '33333333-3333-3333-3333-333333333331';
    state.tickets = [{ ticket_id: id, title: 'Visible title', description: 'Sensitive details', assigned_to: null }];
    state.decisions.set(id, { allowed: true, redactedFields: ['tickets.description'] });
    const controller = new ApiTicketController();
    (controller as any).ticketService.update = vi.fn(async () => state.tickets[0]);
    const makeRequest = () => {
      const req = request(`/api/v1/tickets/${id}/${method === 'updateStatus' ? 'status' : 'assignment'}`, { id }) as any;
      req.json = async () => method === 'updateStatus'
        ? { status_id: '55555555-5555-5555-5555-555555555555' }
        : { assigned_to: null };
      return req;
    };

    const hidden = await (controller as any)[method]()(makeRequest());
    expect(hidden.status).toBe(200);
    const data = (await hidden.json()).data;
    expect(data.title).toBe('Visible title');
    expect(data).not.toHaveProperty('description');

    state.decisions.delete(id);
    const visible = await (controller as any)[method]()(makeRequest());
    expect((await visible.json()).data).toMatchObject({ title: 'Visible title', description: 'Sensitive details' });
  });

  it('ticket linked asset list projects each asset and omits denied or suppressed rows', async () => {
    const ticketId = '33333333-3333-3333-3333-333333333331';
    const visibleAsset = { asset_id: 'linked-asset', name: 'PC', serial_number: 'Secret serial' };
    const deniedAsset = { asset_id: 'denied-linked-asset', name: 'Denied PC' };
    const suppressedAsset = { asset_id: 'suppressed-linked-asset', name: 'Suppressed PC' };
    state.tickets = [{ ticket_id: ticketId, title: 'Ticket' }];
    state.assets = [visibleAsset, deniedAsset, suppressedAsset];
    state.assetAuthorizationRecords.set(visibleAsset.asset_id, {
      id: visibleAsset.asset_id, ownerUserId: 'asset-owner', assignedUserIds: ['asset-assignee'],
      clientId: 'asset-client', teamIds: ['asset-team'],
    });
    state.decisions.set(visibleAsset.asset_id, { allowed: true, redactedFields: ['assets.serial_number'] });
    state.decisions.set(deniedAsset.asset_id, { allowed: false, redactedFields: [] });
    state.decisions.set(suppressedAsset.asset_id, { allowed: true, redactedFields: ['assets.asset_id'] });
    const controller = new ApiTicketController();
    (controller as any).ticketService.getTicketAssets = vi.fn(async () => [visibleAsset, deniedAsset, suppressedAsset]);

    const response = await controller.getAssets()(request(`/api/v1/tickets/${ticketId}/assets`, { id: ticketId }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ asset_id: visibleAsset.asset_id, name: 'PC' }]);
    expect(authorizeResource.mock.calls.some(([input]) => input.record?.id === visibleAsset.asset_id
      && input.record.ownerUserId === 'asset-owner'
      && input.record.assignedUserIds.includes('asset-assignee')
      && input.record.clientId === 'asset-client'
      && input.record.teamIds.includes('asset-team'))).toBe(true);

    state.decisions.delete(visibleAsset.asset_id);
    const unrestricted = await controller.getAssets()(request(`/api/v1/tickets/${ticketId}/assets`, { id: ticketId }));
    expect((await unrestricted.json()).data).toMatchObject([
      { asset_id: visibleAsset.asset_id, name: 'PC', serial_number: 'Secret serial' },
    ]);
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

  it('projects nested client details and suppresses them when the client identifier is hidden', async () => {
    const assetId = 'nested-client-asset';
    state.assets = [{
      asset_id: assetId,
      name: 'Laptop',
      client_id: 'client-1',
      client_name: 'Visible Client',
      client: { client_id: 'client-1', client_name: 'Visible Client', billing_email: 'billing@example.test' },
    }];
    const get = () => controller().getById(request(`/api/v2/assets/${assetId}`), { id: assetId });

    const visible = (await (await get()).json()).data;
    expect(visible.client).toMatchObject({ client_id: 'client-1', client_name: 'Visible Client' });

    for (const alias of ['clients.client_name', 'values.client_name', 'client_name', 'assets.client_name', 'fields.assets.client_name']) {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const data = (await (await get()).json()).data;
      expect(JSON.stringify(data)).not.toContain('Visible Client');
      expect(data.client).toMatchObject({ client_id: 'client-1', billing_email: 'billing@example.test' });
    }

    for (const alias of ['clients.client_id', 'values.client_id', 'client_id', 'assets.client_id', 'fields.assets.client_id']) {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const data = (await (await get()).json()).data;
      expect(data.client).toBeNull();
      if (alias === 'clients.client_id') expect(data.client_id).toBe('client-1');
      else expect(data).not.toHaveProperty('client_id');
      expect(data.name).toBe('Laptop');
    }
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

  it('asset detail independently authorizes related assets and projects copied fields', async () => {
    const related = {
      id: 'related-asset', ownerUserId: 'related-owner', assignedUserIds: ['related-owner'], clientId: 'c-related',
    };
    state.assetAuthorizationRecords.set(related.id, related);
    state.assets = [
      asset(A1, { relationships: [{ relationship_id: 'r1', related_asset_id: related.id,
        related_asset_name: 'Sensitive related name', asset_tag: 'OTHER', asset_type: 'workstation', status: 'active' }] }),
    ];
    state.decisions.set(A1, { allowed: true, redactedFields: ['assets.name'] });
    const hidden = await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 });
    expect(hidden.status).toBe(200);
    expect(JSON.stringify((await hidden.json()).data.relationships)).not.toContain('Sensitive related name');

    state.decisions.delete(A1);
    state.decisions.set(related.id, { allowed: true, redactedFields: ['assets.asset_tag'] });
    const visible = await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 });
    const relationship = (await visible.json()).data.relationships[0];
    expect(relationship).toMatchObject({ related_asset_id: related.id, related_asset_name: 'Sensitive related name', status: 'active' });
    expect(relationship).not.toHaveProperty('asset_tag');
    expect(authorizeResource.mock.calls.some(([input]) => input.record?.id === related.id
      && input.record.ownerUserId === 'related-owner'
      && input.record.assignedUserIds.includes('related-owner'))).toBe(true);

    state.decisions.delete(related.id);
    const unrestricted = await controller().getById(request(`/api/v2/assets/${A1}`), { id: A1 });
    expect((await unrestricted.json()).data.relationships[0].asset_tag).toBe('OTHER');
  });

  it('asset relationship list applies parent and related-asset projections, dropping hidden related identifiers', async () => {
    const relatedId = 'related-list-asset';
    state.assetAuthorizationRecords.set(relatedId, { id: relatedId, ownerUserId: 'owner-2', assignedUserIds: ['owner-2'] });
    state.assets = [asset(A1, { relationships: [{ relationship_id: 'r-list', related_asset_id: relatedId,
      related_asset_name: 'Related list name', asset_tag: 'LIST-TAG', asset_type: 'server', status: 'active' }] })];
    state.decisions.set(relatedId, { allowed: true, redactedFields: ['assets.asset_tag'] });

    const visible = await controller().listRelationships(request(`/api/v2/assets/${A1}/relationships`), { id: A1 });
    expect(visible.status).toBe(200);
    const rows = (await visible.json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ related_asset_id: relatedId, related_asset_name: 'Related list name', status: 'active' });
    expect(rows[0]).not.toHaveProperty('asset_tag');

    state.decisions.set(relatedId, { allowed: true, redactedFields: ['assets.asset_id'] });
    const suppressed = await controller().listRelationships(request(`/api/v2/assets/${A1}/relationships`), { id: A1 });
    expect((await suppressed.json()).data).toEqual([]);
  });

  it('maintenance list uses the asset child descriptor for schedule fields and identifiers', async () => {
    const schedule = { schedule_id: 's-review', asset_id: A1, next_maintenance: '2099-01-01', schedule_name: 'Service' };
    state.assets = [asset(A1)];
    const schedulesController = controller();
    (schedulesController as any).assetService.getMaintenanceSchedules = vi.fn(async () => [schedule]);
    state.decisions.set(A1, { allowed: true, redactedFields: ['asset_maintenance_schedules.next_maintenance'] });

    const hidden = await schedulesController.listMaintenanceSchedules(request(`/api/v2/assets/${A1}/maintenance`), { id: A1 });
    expect((await hidden.json()).data[0]).not.toHaveProperty('next_maintenance');
    state.decisions.delete(A1);
    const visible = await schedulesController.listMaintenanceSchedules(request(`/api/v2/assets/${A1}/maintenance`), { id: A1 });
    expect((await visible.json()).data[0]).toMatchObject({ next_maintenance: '2099-01-01', schedule_name: 'Service' });
  });

  it('statistics aggregate authorized asset projections and only their maintenance schedules', async () => {
    const { AssetService: ActualAssetService } = await vi.importActual<typeof import('../../../lib/api/services/AssetService')>(
      '../../../lib/api/services/AssetService',
    );
    const controller = new ApiAssetController();
    const mockedService = (controller as any).assetService;
    mockedService.getStatisticsFromProjections = ActualAssetService.prototype.getStatisticsFromProjections;
    const now = new Date();
    const oldPurchaseDate = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const oldWarrantyDate = new Date(now.getTime() - 20 * 86_400_000).toISOString();
    state.assets = [
      {
        asset_id: 'a-visible', asset_type: 'workstation', status: 'active', client_id: 'c-1', client_name: 'Acme',
        created_at: now.toISOString(), purchase_date: oldPurchaseDate, purchase_price: 4938,
        warranty_end_date: oldWarrantyDate,
      },
      {
        asset_id: 'a-suppressed', asset_type: 'server', status: 'active', client_id: 'c-2', client_name: 'Hidden client',
        created_at: now.toISOString(), purchase_date: oldPurchaseDate, purchase_price: 90000,
        warranty_end_date: oldWarrantyDate,
      },
    ];
    state.decisions.set('a-suppressed', { allowed: true, redactedFields: ['assets'] });
    state.maintenanceSchedules = [
      { asset_id: 'a-visible', schedule_id: 'm-1', next_maintenance: oldPurchaseDate, is_active: true },
      { asset_id: 'a-visible', schedule_id: 'm-2', next_maintenance: new Date(now.getTime() + 86_400_000), is_active: true },
      { asset_id: 'a-suppressed', schedule_id: 'm-3', next_maintenance: oldPurchaseDate, is_active: true },
    ];

    const visible = await controller.getStatistics(request('/api/v2/assets/stats'));
    const visibleStats = (await visible.json()).data;
    expect(visibleStats).toMatchObject({
      total_assets: 1, deployed_assets: 1, assets_added_this_month: 1, total_asset_value: 4938,
      assets_by_type: { workstation: 1 }, assets_by_client: { Acme: 1 }, warranty_expired: 1,
      maintenance_due: 1, maintenance_overdue: 1,
    });

    state.decisions.set('a-visible', {
      allowed: true,
      redactedFields: [
        'purchase_price', 'purchase_date', 'created_at', 'warranty_end_date', 'client_id',
        'asset_maintenance_schedules.next_maintenance',
      ],
    });
    const hidden = await controller.getStatistics(request('/api/v2/assets/stats'));
    const hiddenStats = (await hidden.json()).data;
    expect(hiddenStats).toMatchObject({
      total_assets: 1, assets_added_this_month: 0, average_asset_age_days: null, total_asset_value: 0,
      assets_by_client: { Unknown: 1 }, warranty_expiring_soon: 0, warranty_expired: 0,
      maintenance_due: 0, maintenance_overdue: 0,
    });
    expect(JSON.stringify(hiddenStats)).not.toContain('4938');
  });

  it('asset statistics require asset:read before querying records', async () => {
    state.assetReadAllowed = false;
    const service = (new ApiAssetController() as any).assetService;
    const list = vi.spyOn(service, 'list');

    const response = await new ApiAssetController().getStatistics(request('/api/v2/assets/stats'));

    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('asset mutation and history projections', () => {
  const ASSET_ID = '22222222-2222-2222-2222-222222222229';
  const SECOND_ASSET_ID = '22222222-2222-2222-2222-222222222228';

  beforeEach(() => {
    state.assets = [{ asset_id: ASSET_ID, name: 'Visible asset', serial_number: 'SECRET-SERIAL' }];
  });

  it('projects asset update results, preserves visible fields, and suppresses hidden identifiers before mutation', async () => {
    const controller = new ApiAssetController();
    const update = vi.spyOn((controller as any).assetService, 'update');
    const makeRequest = () => {
      const req = request(`/api/v1/assets/${ASSET_ID}`, { id: ASSET_ID });
      req.json = async () => ({ name: 'Renamed asset' });
      return req;
    };

    state.assetReadAllowed = false;
    expect((await controller.update(makeRequest(), { id: ASSET_ID })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    state.assetReadAllowed = true;

    state.decisions.set(ASSET_ID, { allowed: false, redactedFields: [] });
    expect((await controller.update(makeRequest(), { id: ASSET_ID })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.serial_number'] });
    const hidden = await controller.update(makeRequest(), { id: ASSET_ID });
    expect(hidden.status).toBe(200);
    const hiddenData = (await hidden.json()).data;
    expect(hiddenData).toMatchObject({ asset_id: ASSET_ID, name: 'Renamed asset' });
    expect(hiddenData).not.toHaveProperty('serial_number');

    state.decisions.delete(ASSET_ID);
    const visible = await controller.update(makeRequest(), { id: ASSET_ID });
    expect((await visible.json()).data).toMatchObject({ name: 'Renamed asset', serial_number: 'SECRET-SERIAL' });

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.asset_id'] });
    const callsBeforeSuppression = update.mock.calls.length;
    const suppressed = await controller.update(makeRequest(), { id: ASSET_ID });
    expect(suppressed.status).toBe(404);
    expect(update).toHaveBeenCalledTimes(callsBeforeSuppression);
  });

  it('gates assignment history and projects joined contact names with visible and suppressed controls', async () => {
    const controller = new ApiAssetController();
    const getAssignments = vi.spyOn((controller as any).assetService, 'getAssetAssignments');
    state.assetAssignments = [{
      assignment_id: 'assignment-1', asset_id: ASSET_ID, contact_name_id: 'contact-1',
      contact_name: 'Private Contact Name', note: 'Visible assignment note',
    }];

    state.decisions.set(ASSET_ID, { allowed: false, redactedFields: [] });
    expect((await controller.listAssignments(request(`/api/v1/assets/${ASSET_ID}/assignments`), { id: ASSET_ID })).status).toBe(404);
    expect(getAssignments).not.toHaveBeenCalled();

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['contacts.full_name'] });
    const hiddenLabel = await controller.listAssignments(request(`/api/v1/assets/${ASSET_ID}/assignments`), { id: ASSET_ID });
    expect(hiddenLabel.status).toBe(200);
    expect((await hiddenLabel.json()).data).toEqual([{
      assignment_id: 'assignment-1', asset_id: ASSET_ID, contact_name_id: 'contact-1',
      contact_name: null, note: 'Visible assignment note',
    }]);

    state.decisions.delete(ASSET_ID);
    expect((await (await controller.listAssignments(request(`/api/v1/assets/${ASSET_ID}/assignments`), { id: ASSET_ID })).json()).data[0].contact_name)
      .toBe('Private Contact Name');

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.asset_id'] });
    expect((await controller.listAssignments(request(`/api/v1/assets/${ASSET_ID}/assignments`), { id: ASSET_ID })).status).toBe(404);
  });

  it('projects maintenance data and performer labels, suppresses hidden history rows, and returns 404 for a denied asset', async () => {
    const controller = new ApiAssetController();
    state.maintenanceHistory = [{
      history_id: 'history-1', asset_id: ASSET_ID, performed_by: 'user-1', performed_by_user_name: 'Ada Lovelace',
      maintenance_data: { cost: 4938, notes: 'Private maintenance notes' },
    }];
    const get = () => controller.getMaintenanceHistory(request(`/api/v1/assets/${ASSET_ID}/history`), { id: ASSET_ID });

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['asset_maintenance_history.maintenance_data'] });
    const hiddenData = await get();
    expect(hiddenData.status).toBe(200);
    const hiddenHistory = (await hiddenData.json()).data[0];
    expect(hiddenHistory).toMatchObject({ history_id: 'history-1', performed_by_user_name: 'Ada Lovelace' });
    expect(hiddenHistory).not.toHaveProperty('maintenance_data');

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['users.first_name'] });
    const hiddenName = await get();
    expect((await hiddenName.json()).data[0]).toMatchObject({ maintenance_data: { cost: 4938 }, performed_by_user_name: null });

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['asset_maintenance_history.history_id'] });
    expect((await (await get()).json()).data).toEqual([]);

    state.decisions.set(ASSET_ID, { allowed: false, redactedFields: [] });
    expect((await get()).status).toBe(404);

    state.decisions.delete(ASSET_ID);
    expect((await (await get()).json()).data[0]).toMatchObject({
      maintenance_data: { cost: 4938, notes: 'Private maintenance notes' },
      performed_by_user_name: 'Ada Lovelace',
    });
  });

  it.each(['bulkUpdate', 'bulkStatusUpdate'] as const)(
    '%s authorizes every target before writing and returns only projected assets',
    async (method) => {
      const first = { asset_id: ASSET_ID, name: 'First asset', serial_number: 'FIRST-SECRET', status: 'active' };
      const second = { asset_id: SECOND_ASSET_ID, name: 'Second asset', serial_number: 'SECOND-SECRET', status: 'active' };
      state.assets = [first, second];
      const controller = new ApiAssetController();
      const update = vi.spyOn((controller as any).assetService, 'update');
      const makeRequest = () => {
        const req = request(`/api/v2/assets/${method === 'bulkUpdate' ? 'bulk-update' : 'bulk-status'}`);
        req.json = async () => method === 'bulkUpdate'
          ? { assets: [
            { asset_id: ASSET_ID, data: { name: 'Renamed first' } },
            { asset_id: SECOND_ASSET_ID, data: { name: 'Renamed second' } },
          ] }
          : { asset_ids: [ASSET_ID, SECOND_ASSET_ID], status: 'active' };
        return req;
      };
      const call = () => method === 'bulkUpdate'
        ? controller.bulkUpdate(makeRequest())
        : controller.bulkStatusUpdate(makeRequest());

      const visible = await call();
      expect(visible.status).toBe(200);
      expect((await visible.json()).data).toMatchObject([
        { asset_id: ASSET_ID, serial_number: 'FIRST-SECRET' },
        { asset_id: SECOND_ASSET_ID, serial_number: 'SECOND-SECRET' },
      ]);

      state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.serial_number'] });
      const hidden = await call();
      const projected = (await hidden.json()).data;
      expect(projected[0]).toMatchObject({ asset_id: ASSET_ID });
      expect(projected[0]).not.toHaveProperty('serial_number');
      expect(projected[1].serial_number).toBe('SECOND-SECRET');

      const callsBeforeDeniedBatch = update.mock.calls.length;
      state.decisions.set(SECOND_ASSET_ID, { allowed: false, redactedFields: [] });
      expect((await call()).status).toBe(404);
      expect(update).toHaveBeenCalledTimes(callsBeforeDeniedBatch);

      state.decisions.set(SECOND_ASSET_ID, { allowed: true, redactedFields: [] });
      state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.asset_id'] });
      expect((await call()).status).toBe(404);
      expect(update).toHaveBeenCalledTimes(callsBeforeDeniedBatch);

      state.assetReadAllowed = false;
      expect((await call()).status).toBe(403);
      expect(update).toHaveBeenCalledTimes(callsBeforeDeniedBatch);
    },
  );

  it('authorizes the owning asset before maintenance schedule writes and projects stored schedule values', async () => {
    const scheduleId = '44444444-4444-4444-4444-444444444449';
    const schedule = {
      schedule_id: scheduleId, asset_id: ASSET_ID, schedule_name: 'Old name',
      next_maintenance: '2099-01-01T00:00:00Z', created_by: 'user-1', created_by_name: 'Ada Lovelace',
    };
    state.maintenanceSchedules = [schedule];
    const controller = new ApiAssetController();
    const service = (controller as any).assetService;
    const findSchedule = vi.spyOn(service, 'getMaintenanceScheduleForUpdate');
    const updateSchedule = vi.spyOn(service, 'updateMaintenanceSchedule');
    const makeRequest = () => {
      const req = request(`/api/v2/assets/maintenance/${scheduleId}`, { scheduleId });
      req.json = async () => ({ schedule_name: 'Renamed schedule' });
      return req;
    };
    const call = () => controller.updateMaintenanceSchedule(makeRequest(), { scheduleId });

    const visible = await call();
    expect((await visible.json()).data).toMatchObject({
      schedule_name: 'Renamed schedule', next_maintenance: '2099-01-01T00:00:00Z',
      created_by_name: 'Ada Lovelace',
    });

    state.decisions.set(ASSET_ID, {
      allowed: true,
      redactedFields: ['asset_maintenance_schedules.next_maintenance', 'users.first_name'],
    });
    const hidden = await call();
    const hiddenData = (await hidden.json()).data;
    expect(hiddenData.schedule_name).toBe('Renamed schedule');
    expect(hiddenData).not.toHaveProperty('next_maintenance');
    expect(hiddenData.created_by_name).toBeNull();

    const writesBeforeDeniedOwner = updateSchedule.mock.calls.length;
    state.decisions.set(ASSET_ID, { allowed: false, redactedFields: [] });
    expect((await call()).status).toBe(404);
    expect(updateSchedule).toHaveBeenCalledTimes(writesBeforeDeniedOwner);

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['assets.asset_id'] });
    expect((await call()).status).toBe(404);
    expect(updateSchedule).toHaveBeenCalledTimes(writesBeforeDeniedOwner);

    state.decisions.set(ASSET_ID, { allowed: true, redactedFields: ['asset_maintenance_schedules.schedule_id'] });
    expect((await call()).status).toBe(404);
    expect(updateSchedule).toHaveBeenCalledTimes(writesBeforeDeniedOwner);

    state.assetReadAllowed = false;
    expect((await call()).status).toBe(403);
    expect(findSchedule).toHaveBeenCalledTimes(writesBeforeDeniedOwner + 3);
    expect(updateSchedule).toHaveBeenCalledTimes(writesBeforeDeniedOwner);
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
    expect(data.subtotal).toBeNull();
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

describe('quote financial projections', () => {
  it.each([
    'unit_price', 'values.unit_price', 'quote_items.unit_price', 'fields.quote_items.unit_price',
    'fields.values.unit_price', 'quote_items.quantity', 'quote_items.is_selected', 'quote_items.quote_item_id', 'quote_items',
  ])('quote header totals do not reveal %s', async (field) => {
    const { summarizeQuoteTotals } = await import('../../../../../packages/billing/src/lib/quoteTotals');
    const id = '44444444-4444-4444-4444-444444444441';
    const items = [{
      quote_item_id: 'price-line', quote_id: id, quantity: 1, unit_price: 4938,
      total_price: 4938, net_amount: 4938, tax_amount: 0, is_optional: false,
      is_selected: true, is_discount: false,
    }];
    // Use the same financial summary that persisted quote recalculation uses.
    const totals = summarizeQuoteTotals(items, {
      amountOf: (item) => item.total_price, taxOf: (item) => item.tax_amount, discountTotal: 0,
    });
    state.quote = { quote_id: id, title: 'Visible quote', created_by: 'u-1', items, ...totals };
    const get = () => new ApiQuoteController().getById()(request(`/api/v1/quotes/${id}`, { id }));
    const open = (await (await get()).json()).data;
    expect(open.subtotal).toBe(4938);
    expect(open.total_amount).toBe(4938);
    state.decisions.set(id, { allowed: true, redactedFields: [field] });
    const response = await get();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.title).toBe('Visible quote');
    if (field === 'quote_items' || field === 'quote_items.quote_item_id') {
      expect(data.items).toEqual([]);
    } else {
      expect(data.items[0].total_price).toBeNull();
      if (field.endsWith('unit_price')) expect(data.items[0]).not.toHaveProperty('unit_price');
    }
    expect(data).toMatchObject({
      subtotal: null, discount_total: null, tax: null, total_amount: null,
      optional_subtotal: null, optional_tax: null, optional_total: null,
    });
  });

  it('list projects header amounts even when its service response does not include quote lines', async () => {
    const id = '44444444-4444-4444-4444-444444444441';
    state.quote = { quote_id: id, title: 'Visible quote', subtotal: 4938, discount_total: 0, tax: 0, total_amount: 4938 };
    const get = () => new ApiQuoteController().list()(request('/api/v1/quotes'));
    const visible = (await (await get()).json()).data[0];
    expect(visible).toMatchObject({ subtotal: 4938, total_amount: 4938 });

    state.decisions.set(id, { allowed: true, redactedFields: ['quote_items.unit_price'] });
    const response = await get();
    expect(response.status).toBe(200);
    const data = (await response.json()).data[0];
    expect(data).toMatchObject({ quote_id: id, title: 'Visible quote', subtotal: null, discount_total: null, tax: null, total_amount: null });
    expect(data).not.toHaveProperty('items');
  });

  it('follows discount and tax dependencies while preserving totals for unrelated redactions', async () => {
    const { summarizeQuoteTotals } = await import('../../../../../packages/billing/src/lib/quoteTotals');
    const id = '44444444-4444-4444-4444-444444444441';
    const items = [
      { quote_item_id: 'base', quantity: 2, unit_price: 250, total_price: 500, net_amount: 500,
        tax_amount: 50, tax_rate: 10, is_discount: false, description: 'Private description' },
      { quote_item_id: 'discount', quantity: 1, unit_price: 0, total_price: 125, net_amount: 125,
        tax_amount: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 25 },
    ];
    const totals = summarizeQuoteTotals(items, {
      amountOf: item => item.total_price, taxOf: item => item.tax_amount, discountTotal: 125,
    });
    state.quote = { quote_id: id, title: 'Visible quote', items, ...totals };
    const get = async () => (await (await new ApiQuoteController().getById()(
      request(`/api/v1/quotes/${id}`, { id }),
    )).json()).data;
    expect(await get()).toMatchObject({ subtotal: 500, discount_total: 125, tax: 50, total_amount: 425 });

    state.decisions.set(id, { allowed: true, redactedFields: ['quote_items.description'] });
    const descriptionHidden = await get();
    expect(descriptionHidden).toMatchObject({ subtotal: 500, discount_total: 125, tax: 50, total_amount: 425 });
    expect(descriptionHidden.items[0]).not.toHaveProperty('description');

    state.decisions.set(id, { allowed: true, redactedFields: ['quote_items.tax_rate'] });
    expect(await get()).toMatchObject({ subtotal: 500, discount_total: 125, tax: null, total_amount: null });

    state.decisions.set(id, { allowed: true, redactedFields: ['quote_items.discount_percentage'] });
    const discountHidden = await get();
    expect(discountHidden).toMatchObject({ subtotal: null, discount_total: null, tax: null, total_amount: null });
    expect(discountHidden.items[1]).toMatchObject({ total_price: null, net_amount: null });
  });
});


describe('asset extension projections', () => {
  const assetId = '33333333-3333-3333-3333-333333333333';
  const cases = [
    { type: 'workstation', table: 'workstation_assets', field: 'os_version', secret: 'Private OS version' },
    { type: 'network_device', table: 'network_device_assets', field: 'management_ip', secret: '10.20.30.40' },
    { type: 'server', table: 'server_assets', field: 'primary_ip', secret: '10.20.30.41' },
    { type: 'mobile_device', table: 'mobile_device_assets', field: 'imei', secret: 'PRIVATE-IMEI-4938' },
    { type: 'printer', table: 'printer_assets', field: 'ip_address', secret: '10.20.30.42' },
  ];

  it.each(cases)('projects $type extension fields under their canonical aliases', async ({ type, table, field, secret }) => {
    const extension = { asset_id: assetId, [field]: secret, visible_property: 'Visible extension value' };
    state.assets = [{ asset_id: assetId, asset_type: type, name: 'Visible asset', extension_data: extension }];
    const controller = new ApiAssetController();
    const get = async () => {
      const response = await controller.getById(request(`/api/v1/assets/${assetId}`), { id: assetId });
      expect(response.status).toBe(200);
      return (await response.json()).data;
    };
    expect((await get()).extension_data[field]).toBe(secret);
    for (const alias of [field, `values.${field}`, `${table}.${field}`, `fields.${table}.${field}`]) {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const hidden = await get();
      expect(hidden.name).toBe('Visible asset');
      expect(hidden.extension_data).toMatchObject({ asset_id: assetId, visible_property: 'Visible extension value' });
      expect(hidden.extension_data).not.toHaveProperty(field);
    }
    // Projection copies the data; a later unrestricted reader still sees the source values.
    state.decisions.delete(assetId);
    expect((await get()).extension_data[field]).toBe(secret);
  });

  it.each(cases)('suppresses hidden $type extension records without suppressing their asset', async ({ type, table }) => {
    state.assets = [{ asset_id: assetId, asset_type: type, name: 'Visible asset', extension_data: { asset_id: assetId, secret: 'Private' } }];
    for (const alias of [table, `${table}.asset_id`, `fields.${table}.asset_id`]) {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const response = await new ApiAssetController().getById(request(`/api/v1/assets/${assetId}`), { id: assetId });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ asset_id: assetId, name: 'Visible asset', extension_data: null });
    }
  });

  it('keeps extension variants separate and selects the source before hiding the discriminator', async () => {
    state.assets = [{ asset_id: assetId, asset_type: 'workstation', name: 'Visible asset',
      extension_data: { asset_id: assetId, os_version: 'Visible OS version' } }];
    const get = async () => (await (await new ApiAssetController().getById(request(`/api/v1/assets/${assetId}`), { id: assetId })).json()).data;
    for (const alias of ['mobile_device_assets', 'mobile_device_assets.asset_id', 'mobile_device_assets.os_version']) {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      expect((await get()).extension_data.os_version).toBe('Visible OS version');
    }
    state.decisions.set(assetId, { allowed: true, redactedFields: ['assets.asset_type'] });
    const hiddenType = await get();
    expect(hiddenType).not.toHaveProperty('asset_type');
    expect(hiddenType.extension_data).toBeNull();
  });

  it.each(['unrecognized', '__proto__', undefined])('does not expose extension records with unknown asset type %s', async (type) => {
    state.assets = [{ asset_id: assetId, asset_type: type, name: 'Visible asset', extension_data: { secret: 'Private' } }];
    const response = await new ApiAssetController().getById(request(`/api/v1/assets/${assetId}`), { id: assetId });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ name: 'Visible asset', extension_data: null });
  });

  it('projects extensions in search results through the same asset descriptor', async () => {
    state.assets = [{ asset_id: assetId, asset_type: 'mobile_device', name: 'Visible asset',
      extension_data: { asset_id: assetId, imei: 'PRIVATE-IMEI-4938', carrier: 'Visible carrier' } }];
    const search = () => new ApiAssetController().search(request('/api/v1/assets/search?query=Visible&include_extension_data=true'));
    expect((await (await search()).json()).data[0].extension_data.imei).toBe('PRIVATE-IMEI-4938');
    state.decisions.set(assetId, { allowed: true, redactedFields: ['mobile_device_assets.imei'] });
    const response = await search();
    expect(response.status).toBe(200);
    const data = (await response.json()).data[0];
    expect(data.extension_data).toEqual({ asset_id: assetId, carrier: 'Visible carrier' });
  });
});

describe('asset document projections', () => {
  const assetId = '33333333-3333-3333-3333-333333333333';
  const document = {
    association_id: 'association-1',
    document_id: 'document-1',
    entity_type: 'asset',
    entity_id: assetId,
    notes: 'PRIVATE association notes',
    original_filename: 'PRIVATE-upload-name.txt',
    file_size: 4938,
    mime_type: 'text/plain',
    uploaded_at: '2026-11-02T10:00:00.000Z',
  };

  beforeEach(() => {
    state.assets = [{ asset_id: assetId, name: 'Visible asset', documents: [{ ...document }] }];
  });

  const detail = async () => (await (await new ApiAssetController().getById(
    request(`/api/v1/assets/${assetId}`), { id: assetId },
  )).json()).data;

  const listResponse = () => new ApiAssetController().listDocuments(
      request(`/api/v1/assets/${assetId}/documents`), { id: assetId },
    );
  const list = async () => (await (await listResponse()).json()).data;

  it.each([
    ['document_associations.notes', 'notes'],
    ['external_files.original_name', 'original_filename'],
  ])('asset detail redacts nested document field from %s while preserving visible controls', async (alias, field) => {
    expect((await detail()).documents[0][field]).toBe(document[field as keyof typeof document]);
    state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });

    const response = await detail();
    expect(response.name).toBe('Visible asset');
    expect(response.documents).toHaveLength(1);
    expect(response.documents[0].file_size).toBe(4938);
    expect(response.documents[0][field] ?? null).toBeNull();
  });

  it('asset document list redacts joined document fields under the asset decision', async () => {
    expect((await list())[0]).toMatchObject({
      association_id: 'association-1', document_id: 'document-1', file_size: 4938,
      original_filename: 'PRIVATE-upload-name.txt',
    });
    state.decisions.set(assetId, { allowed: true, redactedFields: ['documents.file_size'] });

    authorizeResource.mockClear();
    const response = await list();
    expect(response).toHaveLength(1);
    expect(response[0]).not.toHaveProperty('file_size');
    expect(response[0].original_filename).toBe('PRIVATE-upload-name.txt');
    expect(authorizeResource).toHaveBeenCalledTimes(1);
    expect(authorizeResource.mock.calls[0][0].record.id).toBe(assetId);
  });

  it.each(['documents', 'documents.document_id'])(
    'asset document list suppresses associations when %s is hidden', async (alias) => {
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const response = await listResponse();
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([]);
    },
  );
});
