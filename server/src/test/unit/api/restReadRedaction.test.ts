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
  checklistItems: [] as Record<string, any>[],
  externalLinks: [] as Record<string, any>[],
  quoteActivities: [] as Record<string, any>[],
  timeEntriesSummary: {
    entries: [] as Record<string, any>[],
    ownTotalMinutes: 0,
    ownEntryCount: 0,
    othersTotalMinutes: 0,
    othersEntryCount: 0,
    othersVisibleMinutes: 0,
    othersVisibleCount: 0,
    othersHiddenMinutes: 0,
    othersHiddenCount: 0,
    totalMinutes: 0,
  },
  watchers: [] as Record<string, any>[],
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
    listWatchers = vi.fn(async () => state.watchers);
  },
}));
vi.mock('@alga-psa/tickets/actions/checklists/ticketChecklistActions', () => ({
  addChecklistItem: vi.fn(),
  getTicketChecklistItems: vi.fn(async () => state.checklistItems),
  setChecklistItemCompleted: vi.fn(),
}));
vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkActions', () => ({
  addExternalLink: vi.fn(),
  findTicketByExternalLink: vi.fn(),
  getTicketExternalLinks: vi.fn(async () => state.externalLinks),
  removeExternalLink: vi.fn(),
  updateExternalLink: vi.fn(),
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
    listActivities = vi.fn(async () => state.quoteActivities);
  },
}));
vi.mock('@alga-psa/scheduling/actions/timeEntryTicketActions', () => ({
  fetchTimeEntriesForTicketCore: vi.fn(async () => state.timeEntriesSummary),
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
  state.checklistItems = [];
  state.externalLinks = [];
  state.quoteActivities = [];
  state.timeEntriesSummary = {
    entries: [], ownTotalMinutes: 0, ownEntryCount: 0, othersTotalMinutes: 0, othersEntryCount: 0,
    othersVisibleMinutes: 0, othersVisibleCount: 0, othersHiddenMinutes: 0, othersHiddenCount: 0, totalMinutes: 0,
  };
  state.watchers = [];
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

  it.each(['tickets.assigned_to', 'values.assigned_to', 'fields.tickets.assigned_to'])(
    'agents GET and add response suppress the primary representation when %s is hidden', async (alias) => {
      const assignee = '33333333-3333-3333-3333-333333333333';
      const ticket = { ...state.tickets[0], assigned_to: assignee };
      state.tickets = [ticket];
      const controller = new ApiTicketController();
      const actual = await vi.importActual<any>('../../../lib/api/services/TicketService');
      const agents = await actual.TicketService.prototype.buildTicketAgentsResponse.call({}, {}, context, ticket, []);
      (controller as any).ticketService.getTicketAgents = vi.fn(async () => agents);
      (controller as any).ticketService.addTicketAgent = vi.fn(async () => agents);

      const get = () => controller.getAgents()(request(`/api/v1/tickets/${TICKET}/agents`, { id: TICKET }));
      const visible = await get();
      expect((await visible.json()).data.primary_agent.user_id).toBe(assignee);

      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const hiddenGet = await get();
      expect(hiddenGet.status).toBe(200);
      expect((await hiddenGet.json()).data.primary_agent).toBeNull();

      const post = () => {
        const req = new NextRequest(`http://localhost/api/v1/tickets/${TICKET}/agents`, {
          method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: '44444444-4444-4444-4444-444444444444' }),
        }) as any;
        req.params = Promise.resolve({ id: TICKET });
        return controller.addAgent()(req);
      };
      const hiddenPost = await post();
      expect(hiddenPost.status).toBe(201);
      expect((await hiddenPost.json()).data.primary_agent).toBeNull();
    },
  );

  it('comments GET projects note-derived values and suppresses hidden comment rows', async () => {
    const controller = new ApiTicketController();
    const comment = {
      comment_id: P2, ticket_id: TICKET, note: 'Private note', comment_text: 'Private note',
      comment_html: '<p>Private note</p>',
    };
    (controller as any).ticketService.getTicketComments = vi.fn(async () => [comment]);
    const get = () => controller.getComments()(request(`/api/v1/tickets/${TICKET}/comments`, { id: TICKET }));
    const visible = await get();
    expect((await visible.json()).data[0]).toMatchObject({ note: 'Private note', comment_text: 'Private note', comment_html: '<p>Private note</p>' });

    for (const alias of ['comments.note', 'fields.comments.note']) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const data = (await (await get()).json()).data;
      expect(data).toHaveLength(1);
      expect(data[0]).not.toHaveProperty('note');
      expect(data[0].comment_text).toBeNull();
      expect(data[0].comment_html).toBeNull();
      state.decisions.delete(TICKET);
    }
    for (const alias of ['comments', 'comments.comment_id', 'values.comments.comment_id']) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      expect((await (await get()).json()).data).toEqual([]);
      state.decisions.delete(TICKET);
    }
  });

  it('materials GET omits hidden rates and suppresses hidden material rows', async () => {
    const controller = new ApiTicketController();
    const material = {
      ticket_material_id: P2, ticket_id: TICKET, rate: 4938, quantity: 1,
      description: 'Visible material', service_id: 'service-1', service_name: 'Visible service',
    };
    (controller as any).ticketService.getTicketMaterials = vi.fn(async () => [material]);
    const get = () => controller.getMaterials()(request(`/api/v1/tickets/${TICKET}/materials`, { id: TICKET }));
    const visible = await get();
    expect((await visible.json()).data[0]).toMatchObject({ rate: 4938, service_name: 'Visible service' });

    for (const alias of ['ticket_materials.rate', 'fields.ticket_materials.rate']) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const data = (await (await get()).json()).data;
      expect(data).toHaveLength(1);
      expect(data[0]).not.toHaveProperty('rate');
      expect(data[0].service_name).toBe('Visible service');
      state.decisions.delete(TICKET);
    }
    for (const alias of ['ticket_materials', 'ticket_materials.ticket_material_id', 'values.ticket_materials.ticket_material_id']) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      expect((await (await get()).json()).data).toEqual([]);
      state.decisions.delete(TICKET);
    }
  });

  it('checklist GET projects fields and suppresses hidden checklist identifiers', async () => {
    state.checklistItems = [{ checklist_item_id: P2, ticket_id: TICKET, item_name: 'Visible task', completed_by_name: 'Sam Doe' }];
    const controller = new ApiTicketController();
    const get = () => controller.getChecklist()(request(`/api/v1/tickets/${TICKET}/checklist`, { id: TICKET }));
    expect((await (await get()).json()).data[0].item_name).toBe('Visible task');

    state.decisions.set(TICKET, { allowed: true, redactedFields: ['ticket_checklist_items.item_name'] });
    const redacted = (await (await get()).json()).data[0];
    expect(redacted).not.toHaveProperty('item_name');
    expect(redacted.checklist_item_id).toBe(P2);
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['ticket_checklist_items.checklist_item_id'] });
    expect((await (await get()).json()).data).toEqual([]);
  });

  it('external link GET projects derived URL metadata and suppresses hidden link identifiers', async () => {
    state.externalLinks = [{
      link_id: P2, ticket_id: TICKET, system: 'tracker', external_id: 'EXT-7', external_parent_id: null,
      realm: 'tenant-a', url: 'https://tracker.example/EXT-7',
      display: { label: 'Tracker', icon: 'Link', href: 'https://tracker.example/EXT-7', realmLabel: null },
    }];
    const controller = new ApiTicketController();
    const get = () => controller.getExternalLinks()(request(`/api/v1/tickets/${TICKET}/external-links`, { id: TICKET }));
    expect((await (await get()).json()).data[0].display.href).toBe('https://tracker.example/EXT-7');

    state.decisions.set(TICKET, { allowed: true, redactedFields: ['external_entity_links.external_id'] });
    const redacted = (await (await get()).json()).data[0];
    expect(redacted).not.toHaveProperty('external_id');
    expect(redacted.url).toBeNull();
    expect(redacted.display).toBeNull();
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['external_entity_links.link_id'] });
    expect((await (await get()).json()).data).toEqual([]);
  });

  it('watcher GET projects email fields and suppresses hidden association identifiers', async () => {
    state.watchers = [{ email: 'visible@example.test', name: 'Visible Person', active: true, entity_type: 'contact', entity_id: P2, source: 'manual' }];
    const controller = new ApiTicketController();
    const get = () => controller.getWatchers()(request(`/api/v1/tickets/${TICKET}/watchers`, { id: TICKET }));
    expect((await (await get()).json()).data[0].email).toBe('visible@example.test');

    state.decisions.set(TICKET, { allowed: true, redactedFields: ['ticket_watchers.email'] });
    const redacted = (await (await get()).json()).data[0];
    expect(redacted).not.toHaveProperty('email');
    expect(redacted.name).toBe('Visible Person');
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['ticket_watchers.entity_id'] });
    expect((await (await get()).json()).data).toEqual([]);
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

  const teamMutationRequest = (method: 'PUT' | 'DELETE') => {
    const req = new NextRequest(`http://localhost/api/v1/tickets/${TICKET}/team`, {
      method,
      headers: { 'x-api-key': 'k', 'Content-Type': 'application/json' },
      body: JSON.stringify(method === 'PUT' ? { team_id: P2 } : {}),
    }) as any;
    req.context = context;
    req.params = Promise.resolve({ id: TICKET });
    return req;
  };

  it.each([
    ['assignTeam', 'PUT'],
    ['removeTeam', 'DELETE'],
  ] as const)('%s response uses the ticket projection and preserves visible fields', async (method, httpMethod) => {
    const ticket = { ...state.tickets[0], description: 'Sensitive team ticket details', priority: 'high' };
    const controller = new ApiTicketController();
    (controller as any).ticketService[method] = vi.fn(async () => ticket);

    const visible = await (controller as any)[method]()(teamMutationRequest(httpMethod));
    expect((await visible.json()).data.description).toBe('Sensitive team ticket details');
    state.decisions.set(TICKET, { allowed: true, redactedFields: ['tickets.description'] });
    const response = await (controller as any)[method]()(teamMutationRequest(httpMethod));
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data).toMatchObject({ ticket_id: TICKET, title: 'Printer', priority: 'high' });
    expect(data).not.toHaveProperty('description');
    expect(authorizeResource).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['assignTeam', 'PUT'],
    ['removeTeam', 'DELETE'],
  ] as const)('%s does not write when ticket read authorization denies the row', async (method, httpMethod) => {
    state.decisions.set(TICKET, { allowed: false, redactedFields: [] });
    const controller = new ApiTicketController();
    const write = vi.fn(async () => ({ ...state.tickets[0] }));
    (controller as any).ticketService[method] = write;

    const response = await (controller as any)[method]()(teamMutationRequest(httpMethod));
    expect(response.status).toBe(404);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    'documents.file_size',
    'values.documents.file_size',
    'fields.documents.file_size',
  ])('ticket documents omit file_size when %s is hidden while retaining visible metadata', async (alias) => {
    const controller = new ApiTicketController();
    (controller as any).ticketService.getTicketDocuments = vi.fn(async () => [
      { document_id: 'document-1', document_name: 'Visible document', file_size: 92831 },
    ]);

    const get = () => controller.getDocuments()(request(`/api/v1/tickets/${TICKET}/documents`, { id: TICKET }));
    const visible = await get();
    expect((await visible.json()).data[0].file_size).toBe(92831);
    state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
    const response = await get();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ document_id: 'document-1', document_name: 'Visible document' });
    expect(data[0]).not.toHaveProperty('file_size');
  });

  it.each(['documents', 'documents.document_id', 'values.documents.document_id'])(
    'ticket documents are suppressed when %s is hidden', async (alias) => {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const controller = new ApiTicketController();
      (controller as any).ticketService.getTicketDocuments = vi.fn(async () => [
        { document_id: 'document-1', document_name: 'Secret document', file_size: 92831 },
      ]);

      const response = await controller.getDocuments()(request(`/api/v1/tickets/${TICKET}/documents`, { id: TICKET }));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([]);
    },
  );

  it('ticket documents are not fetched when ticket read authorization denies the row', async () => {
    state.decisions.set(TICKET, { allowed: false, redactedFields: [] });
    const controller = new ApiTicketController();
    const readDocuments = vi.fn(async () => [{ document_id: 'document-1', document_name: 'Secret document' }]);
    (controller as any).ticketService.getTicketDocuments = readDocuments;

    const response = await controller.getDocuments()(request(`/api/v1/tickets/${TICKET}/documents`, { id: TICKET }));
    expect(response.status).toBe(404);
    expect(readDocuments).not.toHaveBeenCalled();
  });

  const joinedTicketDocument = () => ({
    document_id: P2,
    document_name: 'visible-plan.pdf',
    file_size: 92831,
    association_id: 'association-1',
    association_created_at: '2026-11-02T09:12:00Z',
    created_by: 'creator-1',
    created_by_full_name: 'Visible Creator',
    type_id: 'type-1',
    shared_type_id: 'shared-type-1',
    type_name: 'Visible Type',
    type_icon: 'visible-icon',
  });

  it.each(['detail', 'documents'])('%s projects joined ticket document source dependencies', async (endpoint) => {
    const document = joinedTicketDocument();
    state.tickets = [{ ticket_id: TICKET, title: 'Printer', documents: [document] }];
    const controller = new ApiTicketController();
    (controller as any).ticketService.getTicketDocuments = vi.fn(async () => [document]);
    const read = async () => {
      const response = endpoint === 'detail'
        ? await controller.getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }))
        : await controller.getDocuments()(request(`/api/v1/tickets/${TICKET}/documents`, { id: TICKET }));
      expect(response.status).toBe(200);
      const body = (await response.json()).data;
      return endpoint === 'detail' ? body.documents : body;
    };

    const visible = await read();
    expect(visible[0]).toMatchObject({
      document_id: P2,
      created_by_full_name: 'Visible Creator',
      association_created_at: '2026-11-02T09:12:00Z',
      type_name: 'Visible Type',
      type_icon: 'visible-icon',
    });

    for (const [alias, derivedFields] of [
      ['documents.created_by', ['created_by_full_name']],
      ['users.first_name', ['created_by_full_name']],
      ['users.last_name', ['created_by_full_name']],
      ['document_associations.created_at', ['association_created_at']],
      ['document_types.type_name', ['type_name']],
      ['shared_document_types.type_name', ['type_name']],
      ['document_types.icon', ['type_icon']],
      ['shared_document_types.icon', ['type_icon']],
      ['document_types', ['type_name', 'type_icon']],
      ['shared_document_types', ['type_name', 'type_icon']],
      ['document_types.type_id', ['type_name', 'type_icon']],
      ['shared_document_types.type_id', ['type_name', 'type_icon']],
      ['documents.type_id', ['type_name', 'type_icon']],
      ['documents.shared_type_id', ['type_name', 'type_icon']],
    ]) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const redacted = await read();
      expect(redacted[0].document_id).toBe(P2);
      for (const derivedField of derivedFields) expect(redacted[0][derivedField] ?? null).toBeNull();
      state.decisions.delete(TICKET);
    }
  });

  it.each(['detail', 'documents'])('%s suppresses ticket documents when the association is hidden', async (endpoint) => {
    const document = joinedTicketDocument();
    state.tickets = [{ ticket_id: TICKET, title: 'Printer', documents: [document] }];
    const controller = new ApiTicketController();
    (controller as any).ticketService.getTicketDocuments = vi.fn(async () => [document]);
    const read = async () => endpoint === 'detail'
      ? controller.getById()(request(`/api/v1/tickets/${TICKET}`, { id: TICKET }))
      : controller.getDocuments()(request(`/api/v1/tickets/${TICKET}/documents`, { id: TICKET }));

    for (const alias of [
      'document_associations',
      'document_associations.association_id',
      'document_associations.document_id',
      'association_id',
    ]) {
      state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
      const response = await read();
      expect(response.status).toBe(200);
      const body = (await response.json()).data;
      expect(endpoint === 'detail' ? body.documents : body).toEqual([]);
      state.decisions.delete(TICKET);
    }
  });

  it.each(['download', 'thumbnail', 'preview'] as const)(
    '%s serves a visible document but performs no storage operation when its identifier is hidden', async (kind) => {
      const document = joinedTicketDocument();
      state.tickets = [{ ticket_id: TICKET, title: 'Printer' }];
      const controller = new ApiTicketController();
      (controller as any).ticketService.getTicketDocuments = vi.fn(async () => [document]);
      const download = vi.fn(async () => ({ buffer: Buffer.from('file bytes'), fileName: 'file.pdf', mimeType: 'application/pdf' }));
      const variant = vi.fn(async () => ({ buffer: Buffer.from('preview bytes'), fileId: 'preview-1', mimeType: 'image/png' }));
      (controller as any).ticketService.downloadTicketDocument = download;
      (controller as any).ticketService.downloadTicketDocumentVariant = variant;
      const req = () => request(`/api/v1/tickets/${TICKET}/documents/${P2}/${kind}`, { id: TICKET });
      const serve = () => kind === 'download'
        ? controller.downloadDocument()(req())
        : controller.downloadDocumentVariant(kind)(req());

      expect((await serve()).status).toBe(200);
      expect(kind === 'download' ? download : variant).toHaveBeenCalledTimes(1);
      download.mockClear();
      variant.mockClear();

      for (const alias of ['documents', 'documents.document_id']) {
        state.decisions.set(TICKET, { allowed: true, redactedFields: [alias] });
        const response = await serve();
        expect(response.status).toBe(404);
        expect(download).not.toHaveBeenCalled();
        expect(variant).not.toHaveBeenCalled();
        state.decisions.delete(TICKET);
      }
    },
  );
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

  it('suppresses only the nested client when a path-qualified client identifier is hidden', async () => {
    const assetId = 'nested-client-path-alias';
    state.assets = [{
      asset_id: assetId,
      name: 'Laptop',
      client_id: 'client-1',
      client_name: 'Visible Client',
      client: { client_id: 'client-1', client_name: 'Visible Client' },
    }];
    const get = () => controller().getById(request(`/api/v2/assets/${assetId}`), { id: assetId });
    expect((await (await get()).json()).data.client).toMatchObject({ client_id: 'client-1' });

    state.decisions.set(assetId, { allowed: true, redactedFields: ['values.client.client_id'] });
    const response = await get();
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.client).toBeNull();
    expect(data.client_id).toBe('client-1');
    expect(data.name).toBe('Laptop');
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
    'items.unit_price', 'values.items.unit_price', 'quotes.items.unit_price', 'values.items.quote_item_id',
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
    if (field === 'quote_items' || field.endsWith('quote_item_id')) {
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

  it.each(['items.unit_price', 'values.items.unit_price', 'quotes.items.unit_price', 'values.items.quote_item_id'])(
    'header-only quote totals do not reveal data hidden by %s', async (alias) => {
      const id = '44444444-4444-4444-4444-444444444441';
      state.quote = {
        quote_id: id,
        title: 'Visible header-only quote',
        subtotal: 4938,
        discount_total: 0,
        tax: 0,
        total_amount: 4938,
      };
      const get = () => new ApiQuoteController().getById()(request(`/api/v1/quotes/${id}`, { id }));
      expect((await (await get()).json()).data.total_amount).toBe(4938);

      state.decisions.set(id, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      expect(data.title).toBe('Visible header-only quote');
      expect(data.subtotal).toBeNull();
      expect(data.total_amount).toBeNull();
    },
  );

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

  it.each(['extension_data.imei', 'values.extension_data.imei', 'fields.assets.extension_data.imei'])(
    'projects a mobile extension field hidden through %s', async (alias) => {
      state.assets = [{ asset_id: assetId, asset_type: 'mobile_device', name: 'Visible asset',
        extension_data: { asset_id: assetId, imei: 'PRIVATE-IMEI', carrier: 'Visible carrier' } }];
      const get = () => new ApiAssetController().getById(request(`/api/v1/assets/${assetId}`), { id: assetId });
      expect((await (await get()).json()).data.extension_data.imei).toBe('PRIVATE-IMEI');

      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      expect(data.name).toBe('Visible asset');
      expect(data.extension_data.imei ?? null).toBeNull();
      expect(data.extension_data.carrier).toBe('Visible carrier');
    },
  );
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

  it.each(['assets.documents.file_size', 'values.documents.file_size', 'fields.assets.documents.file_size'])(
    'projects a nested document field hidden through %s', async (alias) => {
      expect((await detail()).documents[0].file_size).toBe(4938);
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });

      const data = await detail();
      expect(data.name).toBe('Visible asset');
      expect(data.documents).toHaveLength(1);
      expect(data.documents[0].file_size ?? null).toBeNull();
      expect(data.documents[0].original_filename).toBe('PRIVATE-upload-name.txt');
    },
  );

  it('hides an asset document when its external-file identifier is hidden', async () => {
    state.assets[0].documents[0].file_id = 'file-1';
    state.decisions.set(assetId, { allowed: true, redactedFields: ['external_files.file_id'] });

    const data = await detail();
    expect(data.name).toBe('Visible asset');
    expect(data.documents).toEqual([]);
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


describe('standalone child responses retain the parent policy', () => {
  const assetId = '33333333-3333-3333-3333-333333333333';
  const targetId = '33333333-3333-3333-3333-333333333334';
  const quoteId = '44444444-4444-4444-4444-444444444441';
  const quoteItems = () => [{ quote_item_id: 'line-1', quote_id: quoteId, tenant: TENANT,
    description: 'Visible line', unit_price: 4938, quantity: 1, total_price: 4938, net_amount: 4938, tax_amount: 0,
    is_optional: false, is_selected: true, is_discount: false, is_recurring: false }];
  it.each(['items.unit_price', 'values.items.unit_price', 'quotes.items.unit_price'])(
    'items GET honors the same %s decision as quote GET', async (alias) => {
      state.quote = { quote_id: quoteId, title: 'Visible quote', created_by: 'u-1', items: quoteItems(), subtotal: 4938, total_amount: 4938 };
      const controller = new ApiQuoteController();
      const getItems = async () => (await (await controller.listItems()(request(`/api/v1/quotes/${quoteId}/items`, { id: quoteId }))).json()).data;
      expect((await getItems())[0].unit_price).toBe(4938);
      state.decisions.set(quoteId, { allowed: true, redactedFields: [alias] });
      const parent = (await (await controller.getById()(request(`/api/v1/quotes/${quoteId}`, { id: quoteId }))).json()).data;
      expect(parent.items[0]).not.toHaveProperty('unit_price');
      expect((await getItems())[0]).not.toHaveProperty('unit_price');
    });
  it.each(['items', 'values.items', 'values.items.quote_item_id'])(
    'items GET suppresses quote children hidden by %s', async (alias) => {
      state.quote = { quote_id: quoteId, title: 'Visible quote', created_by: 'u-1', items: quoteItems() };
      const get = () => new ApiQuoteController().listItems()(request(`/api/v1/quotes/${quoteId}/items`, { id: quoteId }));
      expect((await (await get()).json()).data[0].unit_price).toBe(4938);
      state.decisions.set(quoteId, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([]);
    });
  it.each(['values.maintenance_schedules.next_maintenance', 'values.maintenance_schedules.schedule_id'])(
    'maintenance GET honors %s identically to asset detail', async (alias) => {
      state.assets = [{ asset_id: assetId, name: 'Visible asset', maintenance_schedules: [
        { asset_id: assetId, schedule_id: 'schedule-1', schedule_name: 'Visible schedule', next_maintenance: '2027-01-01T00:00:00Z' },
      ] }];
      const controller = new ApiAssetController();
      const get = async () => (await (await controller.listMaintenanceSchedules(request(`/api/v1/assets/${assetId}/maintenance`), { id: assetId })).json()).data;
      expect((await get())[0].next_maintenance).toBe('2027-01-01T00:00:00Z');
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const parent = (await (await controller.getById(request(`/api/v1/assets/${assetId}`), { id: assetId })).json()).data;
      const rows = await get();
      if (alias.endsWith('schedule_id')) {
        expect(parent.maintenance_schedules).toEqual([]);
        expect(rows).toEqual([]);
      } else {
        expect(parent.maintenance_schedules[0]).not.toHaveProperty('next_maintenance');
        expect(rows[0]).not.toHaveProperty('next_maintenance');
      }
    });
  it.each(['values.relationships.related_asset_name', 'values.relationships.related_asset_id'])(
    'relationships GET honors %s identically to asset detail', async (alias) => {
      state.assets = [
        { asset_id: assetId, name: 'Visible asset', relationships: [{ relationship_id: 'rel-1', related_asset_id: targetId, related_asset_name: 'PRIVATE related name' }] },
        { asset_id: targetId, name: 'PRIVATE related name' },
      ];
      const controller = new ApiAssetController();
      const visible = await controller.listRelationships(request(`/api/v1/assets/${assetId}/relationships`), { id: assetId });
      expect((await visible.json()).data[0].related_asset_name).toBe('PRIVATE related name');
      state.decisions.set(assetId, { allowed: true, redactedFields: [alias] });
      const parent = (await (await controller.getById(request(`/api/v1/assets/${assetId}`), { id: assetId })).json()).data;
      const rows = (await (await controller.listRelationships(request(`/api/v1/assets/${assetId}/relationships`), { id: assetId })).json()).data;
      if (alias.endsWith('related_asset_id')) {
        expect(parent.relationships).toEqual([]);
        expect(rows).toEqual([]);
      } else {
        expect(parent.relationships[0]).not.toHaveProperty('related_asset_name');
        expect(rows[0]).not.toHaveProperty('related_asset_name');
      }
    });
  it.each(['values.items.unit_price', 'values.items.quote_item_id', 'items'])(
    'conversion preview preserves the quote child policy for %s', async alias => {
      const { buildQuoteConversionPreview } = await import('../../../../../packages/billing/src/services/quoteConversionService');
      state.quote = { quote_id: quoteId, tenant: TENANT, created_by: 'u-1', items: quoteItems() };
      state.conversionPreview = await buildQuoteConversionPreview({ ...state.quote, quote_items: quoteItems() } as any);
      const get = () => new ApiQuoteController().conversionPreview()(request(`/api/v1/quotes/${quoteId}/conversion-preview`, { id: quoteId }));
      expect((await (await get()).json()).data.invoice_items[0].unit_price).toBe(4938);
      state.decisions.set(quoteId, { allowed: true, redactedFields: [alias] });
      const response = await get();
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      if (alias === 'values.items.unit_price') {
        expect(data.invoice_items).toHaveLength(1);
        expect(data.invoice_items[0]).not.toHaveProperty('unit_price');
        expect(data.invoice_items[0].total_price).toBeNull();
      } else {
        expect(data.invoice_items).toEqual([]);
      }
      expect(JSON.stringify(data)).not.toContain('4938');
    },
  );
});

const fileDocument = () => ({
  document_id: P2,
  document_name: 'PRIVATE-plan.pdf',
  mime_type: 'application/x-private-plan',
  file_id: 'original-private-file',
  thumbnail_file_id: 'thumbnail-private-file',
  preview_file_id: 'preview-private-file',
});

const fileFixture = (document = fileDocument()) => {
  state.tickets = [{ ticket_id: P1, title: 'Visible ticket', documents: [document] }];
  const controller = new ApiTicketController();
  const service = (controller as any).ticketService;
  service.getTicketDocuments = vi.fn(async () => [document]);
  service.downloadTicketDocument = vi.fn(async () => ({
    buffer: Buffer.from('FILE'),
    fileName: document.document_name || 'PRIVATE-storage-fallback.pdf',
    mimeType: document.mime_type || 'application/x-storage-private',
  }));
  service.downloadTicketDocumentVariant = vi.fn(async (_ticket: string, _doc: string, kind: 'thumbnail' | 'preview') => ({
    buffer: Buffer.from('IMAGE'), fileId: document[`${kind}_file_id`], mimeType: 'image/png',
  }));
  return controller;
};

const fileRequest = (kind: 'download' | 'thumbnail' | 'preview') =>
  request(`/api/v1/tickets/${P1}/documents/${P2}/${kind}`, { id: P1 });

const serveFile = (controller: ApiTicketController, kind: 'download' | 'thumbnail' | 'preview', req = fileRequest(kind)) =>
  kind === 'download' ? controller.downloadDocument()(req) : controller.downloadDocumentVariant(kind)(req);

describe('ticket binary responses preserve document redactions', () => {
  it.each([
    'documents.document_name', 'values.documents.document_name', 'tickets.documents.document_name',
    'fields.tickets.documents.document_name',
  ])('download filename honors %s', async (field) => {
    const controller = fileFixture();
    const visible = await serveFile(controller, 'download');
    expect(visible.status).toBe(200);
    expect(visible.headers.get('content-disposition')).toContain('PRIVATE-plan.pdf');
    state.decisions.set(P1, { allowed: true, redactedFields: [field] });
    const list = await controller.getDocuments()(request(`/api/v1/tickets/${P1}/documents`, { id: P1 }));
    expect((await list.json()).data[0]).not.toHaveProperty('document_name');
    const response = await serveFile(controller, 'download');
    expect(authorizeResource).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(await response.text()).toBe('FILE');
  });

  it.each(['documents.mime_type', 'values.documents.mime_type'])('download content type honors %s', async (field) => {
    const controller = fileFixture();
    state.decisions.set(P1, { allowed: true, redactedFields: [field] });
    const list = await controller.getDocuments()(request(`/api/v1/tickets/${P1}/documents`, { id: P1 }));
    expect((await list.json()).data[0]).not.toHaveProperty('mime_type');
    const response = await serveFile(controller, 'download');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain('PRIVATE-plan.pdf');
    expect(await response.text()).toBe('FILE');
  });

  it.each(['external_files.original_name', 'external_files.mime_type'])('projects storage fallback metadata from %s', async (field) => {
    const controller = fileFixture({ ...fileDocument(), document_name: '', mime_type: '' });
    const visible = await serveFile(controller, 'download');
    expect(visible.headers.get('content-disposition')).toContain('PRIVATE-storage-fallback.pdf');
    expect(visible.headers.get('content-type')).toBe('application/x-storage-private');
    state.decisions.set(P1, { allowed: true, redactedFields: [field] });
    const response = await serveFile(controller, 'download');
    expect(response.status).toBe(200);
    if (field === 'external_files.original_name') {
      expect(response.headers.get('content-disposition')).toBe('attachment');
      expect(response.headers.get('content-type')).toBe('application/x-storage-private');
    } else {
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toContain('PRIVATE-storage-fallback.pdf');
    }
  });

  it.each(['thumbnail', 'preview'] as const)('%s hides its file ID in headers and conditional requests', async (kind) => {
    const controller = fileFixture();
    const visible = await serveFile(controller, kind);
    const visibleEtag = visible.headers.get('etag');
    expect(visibleEtag).toBeTruthy();
    for (const field of [
      `documents.${kind}_file_id`, `values.documents.${kind}_file_id`,
      `fields.tickets.documents.${kind}_file_id`,
    ]) {
      state.decisions.set(P1, { allowed: true, redactedFields: [field] });
      const list = await controller.getDocuments()(request(`/api/v1/tickets/${P1}/documents`, { id: P1 }));
      expect((await list.json()).data[0]).not.toHaveProperty(`${kind}_file_id`);
      for (const probe of [visibleEtag!, `"${kind}-private-file"`]) {
        const req = fileRequest(kind);
        req.headers.set('if-none-match', probe);
        const response = await serveFile(controller, kind, req);
        expect(response.status).toBe(200);
        expect(response.headers.get('etag')).toBeNull();
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.text()).toBe('IMAGE');
      }
    }
  });

  it.each(['thumbnail', 'preview'] as const)('%s validators change when the projected metadata changes', async (kind) => {
    const controller = fileFixture();
    const visible = await serveFile(controller, kind);
    expect(visible.headers.get('content-type')).toBe('image/png');
    expect(visible.headers.get('cache-control')).toBe('private, no-cache');
    const req = fileRequest(kind);
    req.headers.set('if-none-match', visible.headers.get('etag')!);
    expect((await serveFile(controller, kind, req)).status).toBe(304);

    state.decisions.set(P1, { allowed: true, redactedFields: ['documents.mime_type'] });
    const redacted = await serveFile(controller, kind, req);
    expect(redacted.status).toBe(200);
    expect(redacted.headers.get('content-type')).toBe('application/octet-stream');
    expect(redacted.headers.get('etag')).not.toBe(visible.headers.get('etag'));
    req.headers.set('if-none-match', redacted.headers.get('etag')!);
    expect((await serveFile(controller, kind, req)).status).toBe(304);
  });

  it.each(['thumbnail', 'preview'] as const)('%s keeps the other variant visible when its identifier is hidden', async (kind) => {
    const controller = fileFixture();
    const other = kind === 'thumbnail' ? 'preview' : 'thumbnail';
    state.decisions.set(P1, { allowed: true, redactedFields: [`documents.${kind}_file_id`] });
    const response = await serveFile(controller, other);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBeTruthy();
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it.each(['download', 'thumbnail', 'preview'] as const)('%s does not load storage when the file resource is hidden', async (kind) => {
    const controller = fileFixture();
    state.decisions.set(P1, { allowed: true, redactedFields: ['external_files'] });
    const response = await serveFile(controller, kind);
    expect(response.status).toBe(404);
    expect((controller as any).ticketService.downloadTicketDocument).not.toHaveBeenCalled();
    expect((controller as any).ticketService.downloadTicketDocumentVariant).not.toHaveBeenCalled();
  });

  it.each(['thumbnail', 'preview'] as const)('%s neutralizes non-raster preview MIME types', async (kind) => {
    for (const mimeType of ['image/svg+xml', 'text/html']) {
      const controller = fileFixture();
      (controller as any).ticketService.downloadTicketDocumentVariant.mockResolvedValue({
        buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
        fileId: 'legacy-original-alias',
        mimeType,
      });

      const response = await serveFile(controller, kind);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toMatch(/^attachment/);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
      expect(response.headers.get('etag')).not.toContain('legacy-original-alias');
      expect(response.headers.get('cache-control')).toBe('private, no-cache');
    }
  });

  it.each(['thumbnail', 'preview'] as const)('%s keeps raster policy on 200 and 304 and reauthorizes', async (kind) => {
    const controller = fileFixture();
    const first = await serveFile(controller, kind);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/png');
    expect(first.headers.get('content-disposition')).toMatch(/^inline/);
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('content-security-policy')).toContain('sandbox');
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(etag).not.toContain('thumbnail-private-file');

    const req = fileRequest(kind);
    req.headers.set('if-none-match', etag);
    const cached = await serveFile(controller, kind, req);
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(etag);
    expect(cached.headers.get('content-disposition')).toMatch(/^inline/);
    expect(cached.headers.get('x-content-type-options')).toBe('nosniff');
    expect(cached.headers.get('content-security-policy')).toContain('sandbox');
    expect(cached.headers.get('cache-control')).toBe('private, no-cache');
    expect(authorizeResource).toHaveBeenCalledTimes(2);
  });
});

describe('ticket subresource mutations and comment representations', () => {
  it.each(['full', 'markdown'] as const)('comments %s format hides note-derived markdown', async (format) => {
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
    const c = new ApiTicketController();
    const comment = {
      comment_id: P2,
      ticket_id: P1,
      note: 'Private note',
      comment_text: 'Private note',
      comment_html: '<p>Private note</p>',
      markdown_content: 'Private note',
    };
    (c as any).ticketService.getTicketComments = vi.fn(async () =>
      format === 'markdown' ? [{ comment_id: P2, ticket_id: P1, markdown_content: 'Private note' }] : [comment]
    );
    const get = () => c.getComments()(request(`/api/v1/tickets/${P1}/comments?content_format=${format}`, { id: P1 }));
    expect((await (await get()).json()).data[0].markdown_content).toBe('Private note');
    state.decisions.set(P1, { allowed: true, redactedFields: ['comments.note'] });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].markdown_content).toBeNull();
  });

  it.each(['ticket_checklist_items.item_name', 'ticket_checklist_items', 'ticket_checklist_items.checklist_item_id'])(
    'checklist completion response retains %s',
    async (field) => {
      state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
      state.checklistItems = [
        { checklist_item_id: P2, ticket_id: P1, item_name: 'Private checklist task', completed: true },
      ];
      const actions = await import('@alga-psa/tickets/actions/checklists/ticketChecklistActions');
      vi.mocked(actions.setChecklistItemCompleted).mockResolvedValue({ checklist_item_id: P2 } as any);
      const c = new ApiTicketController();
      const update = () => {
        const req = new NextRequest(`http://localhost/api/v1/tickets/${P1}/checklist/${P2}`, {
          method: 'PATCH',
          headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
          body: JSON.stringify({ completed: true }),
        }) as any;
        req.params = Promise.resolve({ id: P1, itemId: P2 });
        return c.updateChecklistItemCompletion()(req);
      };
      expect((await (await update()).json()).data.item_name).toBe('Private checklist task');
      state.decisions.set(P1, { allowed: true, redactedFields: [field] });
      const response = await update();
      if (field.endsWith('.item_name')) {
        expect(response.status).toBe(200);
        expect((await response.json()).data).not.toHaveProperty('item_name');
      } else {
        // A hidden row must not be serialized even when the mutation succeeded.
        expect(JSON.stringify(await response.json())).not.toContain('Private checklist task');
      }
    }
  );

  it.each(['addWatcher', 'updateWatcher'] as const)('%s projects the returned watcher list', async (method) => {
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
    state.watchers = [
      {
        email: 'known@example.test',
        name: 'Private watcher name',
        active: false,
        entity_type: 'contact',
        entity_id: P2,
        source: 'manual',
      },
    ];
    const c = new ApiTicketController();
    (c as any).ticketService.addWatcher = vi.fn(async () => state.watchers);
    (c as any).ticketService.setWatcherActive = vi.fn(async () => state.watchers);
    const change = () => {
      const req = new NextRequest(`http://localhost/api/v1/tickets/${P1}/watchers`, {
        method: method === 'addWatcher' ? 'POST' : 'PATCH',
        headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'known@example.test', active: false }),
      }) as any;
      req.params = Promise.resolve({ id: P1 });
      return c[method]()(req);
    };
    expect((await (await change()).json()).data[0].name).toBe('Private watcher name');
    state.decisions.set(P1, { allowed: true, redactedFields: ['ticket_watchers.name'] });
    const get = await c.getWatchers()(request(`/api/v1/tickets/${P1}/watchers`, { id: P1 }));
    expect((await get.json()).data[0].name).toBeNull();
    const response = await change();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].name).toBeNull();
  });
});

describe('copied ticket field provenance', () => {
  it.each(['full', 'markdown'] as const)('comments %s format hides copied creator IDs', async (format) => {
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
    const c = new ApiTicketController();
    (c as any).ticketService.getTicketComments = vi.fn(async () => [
      { comment_id: P2, ticket_id: P1, user_id: P3, created_by: P3, markdown_content: 'Visible note' },
    ]);
    const get = () => c.getComments()(request(`/api/v1/tickets/${P1}/comments?content_format=${format}`, { id: P1 }));
    expect((await (await get()).json()).data[0].created_by).toBe(P3);
    state.decisions.set(P1, { allowed: true, redactedFields: ['comments.user_id'] });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].created_by ?? null).toBeNull();
  });
  it('ticket detail projects its stored watcher mirror with the watcher decision', async () => {
    const watcher = {
      email: 'private@example.test',
      name: 'Visible name',
      active: true,
      entity_type: 'contact',
      entity_id: P2,
    };
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket', attributes: { watch_list: [watcher] } }];
    state.watchers = [watcher];
    const c = new ApiTicketController();
    const get = () => c.getById()(request(`/api/v1/tickets/${P1}`, { id: P1 }));
    expect((await (await get()).json()).data.attributes.watch_list[0].email).toBe('private@example.test');
    state.decisions.set(P1, { allowed: true, redactedFields: ['ticket_watchers.email'] });
    const detached = await c.getWatchers()(request(`/api/v1/tickets/${P1}/watchers`, { id: P1 }));
    expect((await detached.json()).data[0]).not.toHaveProperty('email');
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data.attributes.watch_list[0]).not.toHaveProperty('email');
  });
});

function ticketMutationRequest(path: string, body: Record<string, unknown>, method = 'POST') {
  const req = new NextRequest(`http://localhost/api/v1/tickets/${P1}${path}`, {
    method,
    headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
  req.params = Promise.resolve({ id: P1 });
  return req;
}

describe('ticket mutation response projection boundaries', () => {
  beforeEach(() => {
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
  });

  it('projects newly created checklist rows, including joined completion values and suppression', async () => {
    const actions = await import('@alga-psa/tickets/actions/checklists/ticketChecklistActions');
    vi.mocked(actions.addChecklistItem).mockResolvedValue({ checklist_item_id: P2 } as any);
    state.checklistItems = [
      {
        checklist_item_id: P2,
        ticket_id: P1,
        item_name: 'Visible task',
        completed_by: P3,
        completed_by_name: 'Private person',
      },
    ];
    const c = new ApiTicketController();
    const create = () => c.createChecklistItem()(ticketMutationRequest('/checklist', { item_name: 'Visible task' }));
    expect((await (await create()).json()).data.completed_by_name).toBe('Private person');
    state.decisions.set(P1, { allowed: true, redactedFields: ['ticket_checklist_items.completed_by'] });
    const hidden = await create();
    expect(hidden.status).toBe(201);
    expect((await hidden.json()).data).toMatchObject({ item_name: 'Visible task', completed_by_name: null });
    state.decisions.set(P1, { allowed: true, redactedFields: ['values.checklist.checklist_item_id'] });
    expect((await (await create()).json()).data).toBeNull();
    state.decisions.set(P1, { allowed: false, redactedFields: [] });
    vi.mocked(actions.addChecklistItem).mockClear();
    expect((await create()).status).toBe(404);
    expect(actions.addChecklistItem).not.toHaveBeenCalled();
  });

  it.each(['createExternalLink', 'updateExternalLink', 'deleteExternalLink'] as const)(
    '%s returns only the authorized external-link representation',
    async (method) => {
      const actions = await import('@alga-psa/tickets/actions/externalLinks/externalLinkActions');
      const link = {
        link_id: P2,
        ticket_id: P1,
        system: 'generic',
        external_id: 'PRIVATE-4938',
        url: 'https://tracker.example/PRIVATE-4938',
        display: { href: 'https://tracker.example/PRIVATE-4938' },
      };
      state.externalLinks = [link];
      vi.mocked(actions.addExternalLink).mockResolvedValue(link as any);
      vi.mocked(actions.updateExternalLink).mockResolvedValue(link as any);
      vi.mocked(actions.removeExternalLink).mockResolvedValue({ link_id: P2 } as any);
      const c = new ApiTicketController();
      const invoke = () =>
        c[method]()(
          ticketMutationRequest(
            `/external-links${method === 'createExternalLink' ? '' : `/${P2}`}`,
            method === 'createExternalLink'
              ? { system: 'generic', external_id: 'PRIVATE-4938', url: link.url }
              : { external_status: 'closed' },
            method === 'deleteExternalLink' ? 'DELETE' : method === 'updateExternalLink' ? 'PATCH' : 'POST'
          )
        );
      expect((await (await invoke()).json()).data.link_id).toBe(P2);
      if (method !== 'deleteExternalLink') {
        state.decisions.set(P1, { allowed: true, redactedFields: ['external_entity_links.external_id'] });
        const redacted = (await (await invoke()).json()).data;
        expect(redacted).not.toHaveProperty('external_id');
        expect(redacted.url).toBeNull();
        expect(redacted.display).toBeNull();
      }
      state.decisions.set(P1, { allowed: true, redactedFields: ['values.external_links.link_id'] });
      expect((await (await invoke()).json()).data).toBeNull();
    }
  );

  it.each(['addWatcher', 'updateWatcher', 'removeWatcher'] as const)(
    '%s suppresses watcher rows under the same decision as GET and the mirror',
    async (method) => {
      state.watchers = [
        { email: 'known@example.test', name: 'Private name', entity_type: 'contact', entity_id: P2, active: false },
      ];
      state.tickets[0].attributes = { watch_list: state.watchers };
      const c = new ApiTicketController();
      const write = vi.fn(async () => state.watchers);
      (c as any).ticketService.addWatcher = write;
      (c as any).ticketService.setWatcherActive = write;
      (c as any).ticketService.removeWatcher = write;
      const invoke = () =>
        c[method]()(
          ticketMutationRequest(
            '/watchers?email=known@example.test',
            { email: 'known@example.test', active: false },
            method === 'removeWatcher' ? 'DELETE' : method === 'updateWatcher' ? 'PATCH' : 'POST'
          )
        );
      expect((await (await invoke()).json()).data[0].name).toBe('Private name');
      state.decisions.set(P1, { allowed: true, redactedFields: ['tickets.attributes.watch_list.entity_id'] });
      const hidden = await invoke();
      expect(hidden.status).toBe(200);
      expect((await hidden.json()).data).toEqual([]);
      state.decisions.set(P1, { allowed: false, redactedFields: [] });
      write.mockClear();
      expect((await invoke()).status).toBe(404);
      expect(write).not.toHaveBeenCalled();
    }
  );

  it.each(['addComment', 'updateComment', 'cancelScheduledComment'] as const)(
    '%s returns projected comment rows and respects suppression',
    async (method) => {
      const comment = {
        comment_id: P2,
        ticket_id: P1,
        user_id: P3,
        created_by: P3,
        note: 'Visible content',
        markdown_content: 'Visible content',
      };
      const c = new ApiTicketController();
      const write = vi.fn(async () =>
        method === 'cancelScheduledComment' ? { comment_id: P2, publish_state: 'canceled' } : comment
      );
      (c as any).ticketService.addComment = write;
      (c as any).ticketService.updateComment = write;
      (c as any).ticketService.cancelScheduledComment = write;
      const invoke = () =>
        c[method]()(
          ticketMutationRequest(
            `/comments${method === 'addComment' ? '' : `/${P2}`}${method === 'cancelScheduledComment' ? '/cancel' : ''}`,
            { comment_text: 'Visible content' },
            method === 'updateComment' ? 'PATCH' : 'POST'
          )
        );
      expect((await (await invoke()).json()).data.comment_id).toBe(P2);
      if (method !== 'cancelScheduledComment') {
        state.decisions.set(P1, { allowed: true, redactedFields: ['comments.user_id'] });
        const redacted = (await (await invoke()).json()).data;
        expect(redacted).not.toHaveProperty('user_id');
        expect(redacted.created_by).toBeNull();
      } else {
        state.decisions.set(P1, { allowed: true, redactedFields: ['comments.publish_state'] });
        expect((await (await invoke()).json()).data).not.toHaveProperty('publish_state');
      }
      state.decisions.set(P1, { allowed: true, redactedFields: ['values.comments.comment_id'] });
      expect((await (await invoke()).json()).data).toBeNull();
      state.decisions.set(P1, { allowed: false, redactedFields: [] });
      write.mockClear();
      expect((await invoke()).status).toBe(404);
      expect(write).not.toHaveBeenCalled();
    }
  );

  it('projects joined material values and suppresses a hidden created material', async () => {
    const c = new ApiTicketController();
    (c as any).ticketService.addTicketMaterial = vi.fn(async () => ({
      ticket_material_id: P2,
      ticket_id: P1,
      service_id: P3,
      service_name: 'Private product',
      rate: 4938,
    }));
    const invoke = () =>
      c.addMaterial()(
        ticketMutationRequest('/materials', { service_id: P3, quantity: 1, rate: 4938, currency_code: 'USD' })
      );
    expect((await (await invoke()).json()).data.service_name).toBe('Private product');
    state.decisions.set(P1, { allowed: true, redactedFields: ['ticket_materials.service_id'] });
    const hidden = await invoke();
    expect(hidden.status).toBe(201);
    expect((await hidden.json()).data.service_name).toBeNull();
    state.decisions.set(P1, { allowed: true, redactedFields: ['materials.ticket_material_id'] });
    expect((await (await invoke()).json()).data).toBeNull();
  });

  it('projects uploaded document metadata and suppresses a hidden document', async () => {
    const c = new ApiTicketController();
    (c as any).ticketService.uploadTicketDocument = vi.fn(async () => ({
      document_id: P2,
      document_name: 'Visible file',
      file_size: 4938,
    }));
    const invoke = () => {
      const form = new FormData();
      form.append('file', new File(['bytes'], 'visible.txt', { type: 'text/plain' }));
      const req = new NextRequest(`http://localhost/api/v1/tickets/${P1}/documents`, {
        method: 'POST',
        headers: { 'x-api-key': 'k' },
        body: form,
      }) as any;
      req.params = Promise.resolve({ id: P1 });
      return c.uploadDocument()(req);
    };
    expect((await (await invoke()).json()).data.file_size).toBe(4938);
    state.decisions.set(P1, { allowed: true, redactedFields: ['documents.file_size'] });
    const hidden = await invoke();
    expect(hidden.status).toBe(201);
    expect((await hidden.json()).data).toEqual({ document_id: P2, document_name: 'Visible file' });
    state.decisions.set(P1, { allowed: true, redactedFields: ['documents.document_id'] });
    expect((await (await invoke()).json()).data).toBeNull();
  });
});

describe('detached project, quote, and time-entry responses retain parent projections', () => {
  beforeEach(() => {
    vi.spyOn(ApiBaseController.prototype as any, 'assertProductApiAccess').mockResolvedValue(undefined);
  });

  const task = { task_id: 'task-1', task_name: 'Visible task', description: 'Private task description', estimated_hours: 91 };
  it.each([
    ['project_tasks.description', 'description'],
    ['fields.project_tasks.description', 'description'],
    ['projects.tasks.description', 'description'],
  ])('projects task rows under %s and preserves the visible control', async (redaction, field) => {
    const c = new ApiProjectController();
    (c as any).projectService.getProjectTasks = vi.fn(async () => [task]);
    const get = () => c.getTasks()(request(`/api/v1/projects/${P1}/tasks`));
    const visible = await get();
    expect((await visible.json()).data[0]).toMatchObject({ task_name: task.task_name, description: task.description });

    state.decisions.set(P1, { allowed: true, redactedFields: [redaction] });
    const hidden = await get();
    expect(hidden.status).toBe(200);
    const [projected] = (await hidden.json()).data;
    expect(projected.task_name).toBe(task.task_name);
    expect(projected).not.toHaveProperty(field);
  });

  it.each(['project_tasks', 'project_tasks.task_id'])('suppresses project task rows when %s is hidden', async redaction => {
    state.decisions.set(P1, { allowed: true, redactedFields: [redaction] });
    const c = new ApiProjectController();
    (c as any).projectService.getProjectTasks = vi.fn(async () => [task]);
    const response = await c.getTasks()(request(`/api/v1/projects/${P1}/tasks`));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

  const phase = { phase_id: 'phase-1', phase_name: 'Visible phase', description: 'Private phase description' };
  it.each(['project_phases.description', 'projects.phases.description'])(
    'projects phase descriptions under %s and retains visible fields', async redaction => {
      const c = new ApiProjectController();
      (c as any).projectService.listPhases = vi.fn(async () => [phase]);
      const get = () => c.listPhases()(request(`/api/v1/projects/${P1}/phases`));
      expect((await (await get()).json()).data[0].description).toBe(phase.description);
      state.decisions.set(P1, { allowed: true, redactedFields: [redaction] });
      const response = await get();
      expect(response.status).toBe(200);
      const [projected] = (await response.json()).data;
      expect(projected).toMatchObject({ phase_id: phase.phase_id, phase_name: phase.phase_name });
      expect(projected).not.toHaveProperty('description');
    },
  );

  it.each(['project_phases', 'project_phases.phase_id'])('suppresses project phases when %s is hidden', async redaction => {
    state.decisions.set(P1, { allowed: true, redactedFields: [redaction] });
    const c = new ApiProjectController();
    (c as any).projectService.listPhases = vi.fn(async () => [phase]);
    const response = await c.listPhases()(request(`/api/v1/projects/${P1}/phases`));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

  const Q = '44444444-4444-4444-4444-444444444441';
  const activity = {
    activity_id: 'activity-1', quote_id: Q, activity_type: 'approval_changes_requested',
    description: 'Private approval reason', metadata: { comment: 'Private approval reason' },
  };
  it.each(['quote_activities.description', 'quotes.activities.description'])(
    'projects quote activity description and copied metadata under %s', async redaction => {
      state.quote = { quote_id: Q, title: 'Visible quote' };
      state.quoteActivities = [activity];
      const c = new ApiQuoteController();
      const get = () => c.listActivities()(request(`/api/v1/quotes/${Q}/activities`, { id: Q }));
      expect((await (await get()).json()).data[0]).toMatchObject({ description: activity.description, metadata: activity.metadata });
      state.decisions.set(Q, { allowed: true, redactedFields: [redaction] });
      const response = await get();
      expect(response.status).toBe(200);
      const [projected] = (await response.json()).data;
      expect(projected).not.toHaveProperty('description');
      expect(projected.metadata).toBeNull();
    },
  );

  it.each(['quote_activities', 'quote_activities.activity_id'])(
    'suppresses quote activities when %s is hidden', async redaction => {
      state.quote = { quote_id: Q, title: 'Visible quote' };
      state.quoteActivities = [activity];
      state.decisions.set(Q, { allowed: true, redactedFields: [redaction] });
      const c = new ApiQuoteController();
      const response = await c.listActivities()(request(`/api/v1/quotes/${Q}/activities`, { id: Q }));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([]);
    },
  );

  const T = '33333333-3333-3333-3333-333333333331';
  const timeEntry = { entry_id: 'time-1', notes: 'Private time note', billable_duration: 90, is_own: true };
  const timeSummary = {
    entries: [timeEntry], ownTotalMinutes: 90, ownEntryCount: 1, othersTotalMinutes: 0, othersEntryCount: 0,
    othersVisibleMinutes: 0, othersVisibleCount: 0, othersHiddenMinutes: 0, othersHiddenCount: 0, totalMinutes: 90,
  };
  it.each(['time_entries.notes', 'tickets.time_entries.notes'])(
    'projects ticket time-entry notes under %s without hiding independent totals', async redaction => {
      state.tickets = [{ ticket_id: T, title: 'Visible ticket' }];
      state.timeEntriesSummary = timeSummary;
      const c = new ApiTicketController();
      const get = () => c.getTimeEntries()(request(`/api/v1/tickets/${T}/time-entries`, { id: T }));
      expect((await (await get()).json()).data.entries[0].notes).toBe(timeEntry.notes);
      state.decisions.set(T, { allowed: true, redactedFields: [redaction] });
      const response = await get();
      expect(response.status).toBe(200);
      const body = (await response.json()).data;
      expect(body.entries[0]).not.toHaveProperty('notes');
      expect(body.totalMinutes).toBe(90);
    },
  );

  it.each(['time_entries', 'time_entries.entry_id'])(
    'suppresses time-entry rows and their aggregates when %s is hidden', async redaction => {
      state.tickets = [{ ticket_id: T, title: 'Visible ticket' }];
      state.timeEntriesSummary = timeSummary;
      state.decisions.set(T, { allowed: true, redactedFields: [redaction] });
      const c = new ApiTicketController();
      const response = await c.getTimeEntries()(request(`/api/v1/tickets/${T}/time-entries`, { id: T }));
      expect(response.status).toBe(200);
      const body = (await response.json()).data;
      expect(body.entries).toEqual([]);
      expect(body.totalMinutes).toBeNull();
      expect(body.ownEntryCount).toBeNull();
    },
  );

  it('does not fetch child records after the parent decision denies each read', async () => {
    const Q = '44444444-4444-4444-4444-444444444441';
    const T = '33333333-3333-3333-3333-333333333331';
    state.quote = { quote_id: Q, title: 'Visible quote' };
    state.tickets = [{ ticket_id: T, title: 'Visible ticket' }];
    state.decisions.set(P1, { allowed: false, redactedFields: [] });
    state.decisions.set(Q, { allowed: false, redactedFields: [] });
    state.decisions.set(T, { allowed: false, redactedFields: [] });

    const projectController = new ApiProjectController();
    const getProjectTasks = vi.fn(async () => [task]);
    (projectController as any).projectService.getProjectTasks = getProjectTasks;
    const projectResponse = await projectController.getTasks()(request(`/api/v1/projects/${P1}/tasks`));
    expect(projectResponse.status).toBe(404);
    expect(getProjectTasks).not.toHaveBeenCalled();

    const quoteController = new ApiQuoteController();
    const listActivities = vi.fn(async () => [activity]);
    (quoteController as any).quoteService.listActivities = listActivities;
    const quoteResponse = await quoteController.listActivities()(request(`/api/v1/quotes/${Q}/activities`, { id: Q }));
    expect(quoteResponse.status).toBe(404);
    expect(listActivities).not.toHaveBeenCalled();

    const timeEntries = await import('@alga-psa/scheduling/actions/timeEntryTicketActions');
    const fetchEntries = vi.mocked(timeEntries.fetchTimeEntriesForTicketCore);
    fetchEntries.mockClear();
    const ticketController = new ApiTicketController();
    const ticketResponse = await ticketController.getTimeEntries()(request(`/api/v1/tickets/${T}/time-entries`, { id: T }));
    expect(ticketResponse.status).toBe(404);
    expect(fetchEntries).not.toHaveBeenCalled();
  });
});


describe('external-link lookup projection and predicate privacy', () => {
  beforeEach(async () => {
    state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
    const actions = await import('@alga-psa/tickets/actions/externalLinks/externalLinkActions');
    vi.mocked(actions.findTicketByExternalLink).mockResolvedValue({ ticket_id: P1, link: {
      link_id: P2, ticket_id: P1, system: 'generic', external_id: 'PRIVATE-4938', external_parent_id: 'parent-1',
      external_status: 'Private status', url: 'https://tracker.example/PRIVATE-4938',
    } } as any);
  });

  it.each([
    'external_entity_links.external_id', 'external_entity_links.system', 'external_entity_links.link_id',
    'external_links', 'link.external_id', 'values.link.external_id', 'tickets.link.external_id',
  ])('does not confirm a lookup on a link hidden by %s', async field => {
    const c = new ApiTicketController();
    const get = () => c.findByExternalLink()(request('/api/v1/tickets/by-external-link?system=generic&external_id=PRIVATE-4938'));
    const visible = await get();
    expect(visible.status).toBe(200);
    expect((await visible.json()).data.link.external_id).toBe('PRIVATE-4938');
    state.decisions.set(P1, { allowed: true, redactedFields: [field] });
    expect((await get()).status).toBe(404);
  });

  it('projects non-predicate fields while allowing a readable lookup', async () => {
    const c = new ApiTicketController();
    state.decisions.set(P1, { allowed: true, redactedFields: ['external_entity_links.external_status', 'external_entity_links.external_parent_id'] });
    const get = (parent = '') => c.findByExternalLink()(request(`/api/v1/tickets/by-external-link?system=generic&external_id=PRIVATE-4938${parent}`));
    const visiblePredicate = await get();
    expect(visiblePredicate.status).toBe(200);
    const data = (await visiblePredicate.json()).data;
    expect(data.link).not.toHaveProperty('external_status');
    expect(data.link).not.toHaveProperty('external_parent_id');
    expect(data.ticket_id).toBe(P1);
    expect((await get('&external_parent_id=parent-1')).status).toBe(404);
  });
});


describe('ticket copied identifier aliases', () => {
  it.each(['comments.user_id', 'comments.created_by', 'comments.contact_id', 'comments.author_contact_id'])(
    'hides both comment identifier representations for %s', async field => {
      state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
      const c = new ApiTicketController();
      (c as any).ticketService.getTicketComments = vi.fn(async () => [{
        comment_id: P2, user_id: P3, created_by: P3, contact_id: P1, author_contact_id: P1, note: 'Visible comment',
      }]);
      state.decisions.set(P1, { allowed: true, redactedFields: [field] });
      const response = await c.getComments()(request(`/api/v1/tickets/${P1}/comments`, { id: P1 }));
      expect(response.status).toBe(200);
      const row = (await response.json()).data[0];
      expect(row.note).toBe('Visible comment');
      if (field.includes('contact')) {
        expect(row).not.toHaveProperty('contact_id');
        expect(row.author_contact_id).toBeNull();
        expect(row.user_id).toBe(P3);
      } else {
        expect(row).not.toHaveProperty('user_id');
        expect(row.created_by).toBeNull();
        expect(row.contact_id).toBe(P1);
      }
    },
  );

  it.each(['users.user_id', 'ticket_resources.additional_user_id', 'values.additional_agents.user_id'])(
    'suppresses additional-agent identity copies under %s', async field => {
      state.tickets = [{ ticket_id: P1, title: 'Visible ticket' }];
      const c = new ApiTicketController();
      const actual = await vi.importActual<any>('../../../lib/api/services/TicketService');
      const agents = await actual.TicketService.prototype.buildTicketAgentsResponse.call({}, {}, context, state.tickets[0],
        [{ additional_user_id: P3, assignment_id: P2 }]);
      (c as any).ticketService.getTicketAgents = vi.fn(async () => agents);
      const get = () => c.getAgents()(request(`/api/v1/tickets/${P1}/agents`, { id: P1 }));
      expect((await (await get()).json()).data.additional_agents[0].user_id).toBe(P3);
      state.decisions.set(P1, { allowed: true, redactedFields: [field] });
      const response = await get();
      expect(response.status).toBe(200);
      expect((await response.json()).data.additional_agents).toEqual([]);
    },
  );
});
