import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('server/src/lib/api/services/TimeSheetService', () => ({
  TimeSheetService: class {},
}));

import { ApiTimeSheetController } from '../../../lib/api/controllers/ApiTimeSheetController';
import { timeSheetSearchRowSchema, timeSheetSearchSchema, timeSheetSummaryResponseSchema } from '../../../lib/api/schemas/timeSheet';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerWorkManagementV1Routes } from '../../../lib/api/openapi/routes/workManagementV1';

const sheetA = '00000000-0000-4000-8000-00000000000a';
const sheetB = '00000000-0000-4000-8000-00000000000b';
const unknownSheet = '00000000-0000-4000-8000-0000000000ff';
const userId = '00000000-0000-4000-8000-000000000001';

const entriesA = [{ entry_id: 'ea1', time_sheet_id: sheetA }, { entry_id: 'ea2', time_sheet_id: sheetA }];
const entriesB = [{ entry_id: 'eb1', time_sheet_id: sheetB }];

function makeService() {
  const sheets: Record<string, any> = { [sheetA]: { id: sheetA }, [sheetB]: { id: sheetB } };
  return {
    list: vi.fn().mockResolvedValue({ data: [{ id: sheetA }, { id: sheetB }], total: 2 }),
    getById: vi.fn(async (id: string) => sheets[id] ?? null),
    getTimeSheetEntries: vi.fn(async (id: string) => (id === sheetA ? entriesA : entriesB)),
    getTimeSheetSummary: vi.fn(async (id: string) => ({
      total_hours: id === sheetA ? 3 : 1,
      billable_hours: 2,
      non_billable_hours: 1,
      entries_by_type: {},
      entries_by_day: {},
      approval_ready: true,
    })),
    search: vi.fn().mockResolvedValue([{ id: sheetB, notes: 'weekly' }]),
  };
}

class TestController extends ApiTimeSheetController {
  constructor(service: any) {
    super();
    (this as any).timeSheetService = service;
  }
}

vi.mock('../../../lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyForTenant: vi.fn(async () => ({ user_id: '00000000-0000-4000-8000-000000000001', tenant: 'test-tenant' })),
    validateApiKeyAnyTenant: vi.fn(async () => ({ user_id: '00000000-0000-4000-8000-000000000001', tenant: 'test-tenant' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: '00000000-0000-4000-8000-000000000001', user_type: 'internal', tenant: 'test-tenant' })),
}));
vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
  getConnection: vi.fn(async () => ({})),
}));
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

function get(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-api-key': 'k', 'x-tenant-id': 'test-tenant' },
  });
}

const withParams = (req: NextRequest, id: string) => Object.assign(req, { params: Promise.resolve({ id }) });

describe('time sheet read controllers', () => {
  let service: ReturnType<typeof makeService>;
  let controller: TestController;

  beforeEach(() => {
    service = makeService();
    controller = new TestController(service);
    vi.spyOn(controller as any, 'assertManualProductAccess').mockResolvedValue(undefined);
  });

  it('entries returns only the path sheet\'s entries', async () => {
    const res = await controller.getEntries()(withParams(get(`/api/v1/time-sheets/${sheetA}/entries`), sheetA));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(entriesA);
    expect(service.getTimeSheetEntries).toHaveBeenCalledWith(sheetA, expect.anything());
    expect(service.list).not.toHaveBeenCalled();
  });

  it('entries for an unknown sheet is 404 and reads nothing', async () => {
    const res = await controller.getEntries()(withParams(get(`/api/v1/time-sheets/${unknownSheet}/entries`), unknownSheet));
    expect(res.status).toBe(404);
    expect(service.getTimeSheetEntries).not.toHaveBeenCalled();
  });

  it('a malformed id is 400, not 500', async () => {
    const res = await controller.getEntries()(withParams(get('/api/v1/time-sheets/nope/entries'), 'nope'));
    expect(res.status).toBe(400);
    expect(service.getById).not.toHaveBeenCalled();
  });

  it('summary is computed for the path sheet', async () => {
    const res = await controller.getSummary()(withParams(get(`/api/v1/time-sheets/${sheetA}/summary`), sheetA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(timeSheetSummaryResponseSchema.parse(body.data).total_hours).toBe(3);
    expect(service.getTimeSheetSummary).toHaveBeenCalledWith(sheetA, expect.anything());
    expect(service.list).not.toHaveBeenCalled();
  });

  it('summary for an unknown sheet is 404', async () => {
    const res = await controller.getSummary()(withParams(get(`/api/v1/time-sheets/${unknownSheet}/summary`), unknownSheet));
    expect(res.status).toBe(404);
    expect(service.getTimeSheetSummary).not.toHaveBeenCalled();
  });

  it('search passes the query and filters to the service', async () => {
    const res = await controller.search()(get(`/api/v1/time-sheets/search?query=weekly&fields=user_name&user_ids=${userId}&approval_statuses=DRAFT,SUBMITTED&include_entries=true&limit=5`));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: sheetB, notes: 'weekly' }]);
    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'weekly',
        fields: ['user_name'],
        user_ids: [userId],
        approval_statuses: ['DRAFT', 'SUBMITTED'],
        include_entries: true,
        limit: 5,
      }),
      expect.anything(),
    );
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each(['notes', 'approval_notes'])('search with non-column fields=%s is 400 and never reaches the service', async (field) => {
    const res = await controller.search()(get(`/api/v1/time-sheets/search?query=weekly&fields=${field}`));
    expect(res.status).toBe(400);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('search without query is 400', async () => {
    const res = await controller.search()(get('/api/v1/time-sheets/search?fields=user_name'));
    expect(res.status).toBe(400);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('search date_from/date_to accept the documented YYYY-MM-DD and reject other formats', () => {
    expect(timeSheetSearchSchema.parse({ query: 'x', date_from: '2026-01-05', date_to: '2026-01-11' })).toMatchObject({
      date_from: '2026-01-05', date_to: '2026-01-11',
    });
    expect(timeSheetSearchSchema.safeParse({ query: 'x', date_from: '2026-01-05T00:00:00.000Z' }).success).toBe(false);
    expect(timeSheetSearchSchema.safeParse({ query: 'x', date_to: '01/11/2026' }).success).toBe(false);
  });

  it('search response schema describes the real row, not timeSheetResponseSchema', () => {
    const row = {
      tenant: userId, id: sheetA, user_id: userId, period_id: sheetB, approval_status: 'DRAFT',
      submitted_at: null, approved_at: null, approved_by: null, notes: null, user_name: 'Alice Zebra',
    };
    expect(timeSheetSearchRowSchema.strict().safeParse(row).success).toBe(true);
    expect(timeSheetSearchRowSchema.strict().safeParse({ ...row, notes: 'Covered on-call' }).success).toBe(true);
    // time_sheets.notes (20261028135300) is selected via time_sheets.*, so the row always carries it.
    expect(timeSheetSearchRowSchema.safeParse({ ...row, notes: undefined }).success).toBe(false);
    expect(timeSheetSearchRowSchema.safeParse({ ...row, user_name: undefined }).success).toBe(false);
  });

  it('search array params parse as repeated and comma-separated', () => {
    const other = '00000000-0000-4000-8000-000000000002';
    expect(timeSheetSearchSchema.parse({ query: 'x', user_ids: [userId, other] }).user_ids).toEqual([userId, other]);
    expect(timeSheetSearchSchema.parse({ query: 'x', user_ids: `${userId},${other}` }).user_ids).toEqual([userId, other]);
    expect(timeSheetSearchSchema.parse({ query: 'x', fields: 'user_name,user_name' }).fields).toEqual(['user_name', 'user_name']);
    expect(timeSheetSearchSchema.parse({ query: 'x' }).fields).toBeUndefined();
    expect(() => timeSheetSearchSchema.parse({ query: 'x', user_ids: 'not-a-uuid' })).toThrow();
  });
});

describe('time sheet route files dispatch to the dedicated handlers', () => {
  async function dispatch(modulePath: string, url: string, params?: { id: string }) {
    const calls: string[] = [];
    const spies = ['list', 'getEntries', 'getSummary', 'search'] as const;
    for (const name of spies) {
      vi.spyOn(ApiTimeSheetController.prototype, name).mockImplementation((() => async () => {
        calls.push(name);
        return new Response('{}');
      }) as any);
    }
    const mod = await import(modulePath);
    await mod.GET(new Request(`http://localhost${url}`), { params: Promise.resolve(params) });
    vi.restoreAllMocks();
    return calls;
  }

  it('entries route -> getEntries()', async () => {
    expect(await dispatch('../../../app/api/v1/time-sheets/[id]/entries/route', `/api/v1/time-sheets/${sheetA}/entries`, { id: sheetA })).toEqual(['getEntries']);
  });
  it('summary route -> getSummary()', async () => {
    expect(await dispatch('../../../app/api/v1/time-sheets/[id]/summary/route', `/api/v1/time-sheets/${sheetA}/summary`, { id: sheetA })).toEqual(['getSummary']);
  });
  it('search route -> search()', async () => {
    expect(await dispatch('../../../app/api/v1/time-sheets/search/route', '/api/v1/time-sheets/search?query=x')).toEqual(['search']);
  });
});

describe('OpenAPI contract for the time sheet read routes', () => {
  const registry = createRegistry();
  registerWorkManagementV1Routes(registry);
  const doc = registry.buildDocument({ title: 't', version: '1', edition: 'ce' }) as any;

  it.each([
    '/api/v1/time-sheets/search',
    '/api/v1/time-sheets/{id}/entries',
    '/api/v1/time-sheets/{id}/summary',
  ])('%s is no longer flagged as a controller mismatch', (path) => {
    const op = doc.paths[path].get;
    expect(op['x-route-controller-mismatch']).toBeUndefined();
    expect(op.description).not.toMatch(/delegates to ApiTimeSheetController\.list/);
  });

  it('documents the real response shapes and params', () => {
    const entries = doc.paths['/api/v1/time-sheets/{id}/entries'].get;
    expect(entries.parameters.find((p: any) => p.name === 'id')?.schema.format).toBe('uuid');
    expect(entries.parameters.find((p: any) => p.name === 'page')).toBeUndefined();
    expect(entries.responses['404']).toBeDefined();

    const summary = doc.paths['/api/v1/time-sheets/{id}/summary'].get;
    const summarySchema = JSON.stringify(summary.responses['200']);
    for (const key of ['total_hours', 'billable_hours', 'non_billable_hours', 'entries_by_type', 'entries_by_day', 'approval_ready']) {
      expect(summarySchema + JSON.stringify(doc.components.schemas.WorkV1TimeSheetSummaryResponse)).toContain(key);
    }

    const search = doc.paths['/api/v1/time-sheets/search'].get;
    const names = search.parameters.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['query', 'fields', 'approval_statuses', 'user_ids', 'period_ids', 'date_from', 'date_to', 'include_entries', 'limit']));
    expect(search.parameters.find((p: any) => p.name === 'query').required).toBe(true);
    expect(search.responses['400']).toBeDefined();
  });
});
