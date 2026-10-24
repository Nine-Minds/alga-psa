import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

const mocks = vi.hoisted(() => ({
  validateApiKeyAnyTenant: vi.fn(),
  validateApiKeyForTenant: vi.fn(),
  findUserByIdForApi: vi.fn(),
  hasPermission: vi.fn(),
  getScheduleEntries: vi.fn(),
  getScheduleEntriesPage: vi.fn(),
  tsList: vi.fn(),
  tsSearch: vi.fn(),
  tsListOther: vi.fn(),
}));

vi.mock('../../../lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant,
    validateApiKeyForTenant: mocks.validateApiKeyForTenant,
  },
}));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: mocks.findUserByIdForApi }));
vi.mock('../../../lib/db', () => ({ runWithTenant: (_t: string, fn: () => any) => fn() }));
vi.mock('../../../lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('../../../lib/api/services/TimeSheetService', () => ({
  TimeSheetService: class {
    getScheduleEntries = mocks.getScheduleEntries;
    getScheduleEntriesPage = mocks.getScheduleEntriesPage;
    list = mocks.tsList;
    search = mocks.tsSearch;
    getTimeSheets = mocks.tsListOther;
  },
}));

import { GET } from '../../../app/api/v1/schedules/search/route';
import { ApiTimeSheetController } from '../../../lib/api/controllers/ApiTimeSheetController';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const START = '2026-01-01T00:00:00.000Z';
const END = '2026-01-31T23:59:59.000Z';

function req(qs = '', headers: Record<string, string> = { 'x-api-key': 'good' }) {
  return new Request(`http://localhost/api/v1/schedules/search${qs}`, { headers }) as any;
}

const entry = {
  entry_id: 'e1', title: 'Visit', scheduled_start: START, scheduled_end: END,
  assigned_users: [], access: 'full', can_edit: true,
};

describe('GET /api/v1/schedules/search', () => {
  let listSpy: any;
  beforeEach(() => {
    vi.clearAllMocks();
    listSpy = vi.spyOn(ApiTimeSheetController.prototype, 'list');
    vi.spyOn(ApiTimeSheetController.prototype as any, 'assertProductApiAccess').mockResolvedValue(undefined);
    mocks.validateApiKeyAnyTenant.mockResolvedValue({ user_id: 'u1', tenant: 't1', api_key_id: 'k1' });
    mocks.findUserByIdForApi.mockResolvedValue({ user_id: 'u1', user_type: 'internal' });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getScheduleEntriesPage.mockResolvedValue({ data: [entry], total: 1 });
  });

  function expectNoTimeSheetPath() {
    expect(listSpy).not.toHaveBeenCalled();
    expect(mocks.tsList).not.toHaveBeenCalled();
    expect(mocks.tsSearch).not.toHaveBeenCalled();
    expect(mocks.tsListOther).not.toHaveBeenCalled();
  }

  it('returns paginated schedule entries and forwards filters unchanged', async () => {
    const res = await GET(req(`?start_date=${START}&end_date=${END}&user_id=${USER_ID}&page=1&limit=10`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ entry_id: 'e1', scheduled_start: START });
    expect(body.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });

    expect(mocks.getScheduleEntriesPage).toHaveBeenCalledTimes(1);
    const [, filters, paging] = mocks.getScheduleEntriesPage.mock.calls[0];
    expect(filters).toEqual({ start_date: START, end_date: END, user_id: USER_ID });
    expect(paging).toEqual({ page: 1, limit: 10 });
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'user_schedule', 'read', expect.anything());
    expectNoTimeSheetPath();
  });

  it.each([
    // C3: a date-only end_date covers the whole UTC day (exclusive next-day bound).
    ['end_date=2026-11-04', { end_before: '2026-11-05T00:00:00.000Z' }],
    ['start_date=2026-11-04&end_date=2026-11-04', { start_date: '2026-11-04T00:00:00.000Z', end_before: '2026-11-05T00:00:00.000Z' }],
    ['end_date=2026-12-31', { end_before: '2027-01-01T00:00:00.000Z' }],
    ['start_date=2026-11-04T12:00:00Z&end_date=2026-11-04', { start_date: '2026-11-04T12:00:00Z', end_before: '2026-11-05T00:00:00.000Z' }],
    ['end_date=2026-11-04T23:59:59Z', { end_date: '2026-11-04T23:59:59Z' }],
  ])('normalizes %s to whole-day UTC bounds', async (qs, expected) => {
    const res = await GET(req(`?${qs}`));
    expect(res.status).toBe(200);
    const [, filters] = mocks.getScheduleEntriesPage.mock.calls[0];
    expect(filters).toEqual(expected);
  });

  it.each([
    ['start_date=not-a-date'],
    ['end_date=2026-13-45'],
    [`start_date=2026-02-01&end_date=2026-01-01`],
    ['start_date=2026-11-05T00:00:00Z&end_date=2026-11-04'],
    ['user_id=nope'],
  ])('returns 400 for invalid query %s without calling the service', async (qs) => {
    const res = await GET(req(`?${qs}`));
    expect(res.status).toBe(400);
    expect(mocks.getScheduleEntriesPage).not.toHaveBeenCalled();
    expect(mocks.getScheduleEntries).not.toHaveBeenCalled();
    expectNoTimeSheetPath();
  });

  it('returns 401 without an API key and with an invalid one', async () => {
    expect((await GET(req('', {}))).status).toBe(401);
    mocks.validateApiKeyAnyTenant.mockResolvedValue(null);
    expect((await GET(req('', { 'x-api-key': 'bad' }))).status).toBe(401);
    expect(mocks.getScheduleEntriesPage).not.toHaveBeenCalled();
  });

  it('returns 403 without user_schedule:read', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mocks.getScheduleEntriesPage).not.toHaveBeenCalled();
    expectNoTimeSheetPath();
  });
});
