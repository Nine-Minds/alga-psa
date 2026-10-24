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

import { GET } from '../../../app/api/v1/schedules/route';
import { ApiTimeSheetController } from '../../../lib/api/controllers/ApiTimeSheetController';

const START = '2026-01-04T05:00:00.000Z'; // shape produced by ee/mobile weekQueryRange()
const END = '2026-01-11T04:59:59.999Z';

function req(qs = '') {
  return new Request(`http://localhost/api/v1/schedules${qs}`, { headers: { 'x-api-key': 'good' } }) as any;
}

const makeEntries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ entry_id: `e${i}`, title: `T${i}`, scheduled_start: START, scheduled_end: END }));

// Shipped mobile builds read result.data as the FULL set from this route, so it must stay unpaginated.
describe('GET /api/v1/schedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ApiTimeSheetController.prototype as any, 'assertProductApiAccess').mockResolvedValue(undefined);
    mocks.validateApiKeyAnyTenant.mockResolvedValue({ user_id: 'u1', tenant: 't1', api_key_id: 'k1' });
    mocks.findUserByIdForApi.mockResolvedValue({ user_id: 'u1', user_type: 'internal' });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getScheduleEntries.mockResolvedValue(makeEntries(60));
  });

  it('returns every visible entry (no default limit) in { data: [...] } and accepts mobile ISO date-times', async () => {
    const res = await GET(req(`?start_date=${START}&end_date=${END}&user_id=11111111-1111-4111-8111-111111111111`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(60);
    expect(body.pagination).toBeUndefined();
    expect(mocks.getScheduleEntriesPage).not.toHaveBeenCalled();
    const [, filters] = mocks.getScheduleEntries.mock.calls[0];
    expect(filters).toEqual({ start_date: START, end_date: END, user_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('treats a date-only end_date as the whole UTC day (shared filter with /search)', async () => {
    const res = await GET(req('?start_date=2026-11-04&end_date=2026-11-04'));
    expect(res.status).toBe(200);
    const [, filters] = mocks.getScheduleEntries.mock.calls[0];
    expect(filters).toEqual({ start_date: '2026-11-04T00:00:00.000Z', end_before: '2026-11-05T00:00:00.000Z' });
  });

  it('ignores page/limit instead of paginating', async () => {
    const res = await GET(req('?page=2&limit=5'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(60);
    expect(mocks.getScheduleEntriesPage).not.toHaveBeenCalled();
  });

  it.each([['start_date=nope'], ['start_date=2026-02-01&end_date=2026-01-01'], ['user_id=nope']])(
    'returns 400 for invalid query %s',
    async (qs) => {
      expect((await GET(req(`?${qs}`))).status).toBe(400);
      expect(mocks.getScheduleEntries).not.toHaveBeenCalled();
    }
  );
});
