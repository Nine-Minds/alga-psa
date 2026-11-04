import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * alga-2026-0002807: REST schedule create/update/delete decide exactly like the
 * addScheduleEntry / updateScheduleEntry / deleteScheduleEntry server actions
 * (resolveCalendarAccess + evaluateEntryAccess + canAssignUser).
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const X = '33333333-3333-4333-8333-333333333333';
const Y = '44444444-4444-4444-8444-444444444444';
const CAL = '55555555-5555-4555-8555-555555555555';
const ENTRY = '66666666-6666-4666-8666-666666666666';

const state = vi.hoisted(() => ({
  perms: {} as Record<string, boolean>,
  entry: null as any,
  groupLevels: new Map<string, any>(),
  userLevels: new Map<string, string>(),
  calls: [] as string[],
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, resource: string, action: string) => !!state.perms[`${resource}:${action}`]),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/db', () => ({ runWithTenant: async (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ user_id: ME, tenant: TENANT })),
    validateApiKeyForTenant: vi.fn(async () => ({ user_id: ME, tenant: TENANT })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: ME, tenant: TENANT, user_type: 'internal' })),
}));
vi.mock('@alga-psa/scheduling/lib/calendarAccess', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveCalendarAccess: async (_db: unknown, _t: string, viewer: { user_id: string }, canViewAll: boolean) => ({
      viewerUserId: viewer.user_id,
      canViewAll,
      userLevels: canViewAll ? new Map() : state.userLevels,
      groupLevels: state.groupLevels,
      hiddenCalendarIds: [],
    }),
  };
});
vi.mock('@/lib/api/services/TimeSheetService', () => ({
  TimeSheetService: class {
    async getScheduleEntryForAccess() {
      return state.entry;
    }
    async createScheduleEntry() {
      state.calls.push('create');
      return { entry_id: ENTRY };
    }
    async updateScheduleEntry() {
      state.calls.push('update');
      return { entry_id: ENTRY };
    }
    async deleteScheduleEntry() {
      state.calls.push('delete');
    }
    async listCalendars() {
      state.calls.push('listCalendars');
      return [];
    }
  },
}));

const { ApiTimeSheetController } = await import('@/lib/api/controllers/ApiTimeSheetController');

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/schedules/${ENTRY}`, {
    method,
    headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const createBody = (ids: string[]) => ({
  title: 'T',
  scheduled_start: '2026-10-22T10:00:00.000Z',
  scheduled_end: '2026-10-22T11:00:00.000Z',
  work_item_type: 'meeting',
  assigned_user_ids: ids,
});

function groupEntry(extra: Record<string, unknown> = {}) {
  return { entry_id: ENTRY, calendar_id: CAL, is_private: false, work_item_type: 'ad_hoc', assigned_user_ids: [X], ...extra };
}

beforeEach(() => {
  state.perms = { 'user_schedule:read': true };
  state.groupLevels = new Map();
  state.userLevels = new Map();
  state.calls = [];
  state.entry = groupEntry();
});

const group = (level: string) => new Map([[CAL, { calendarId: CAL, level, isArchived: false }]]);

describe('REST schedule update / delete', () => {
  it('edit share on a group calendar: PUT and DELETE are allowed', async () => {
    state.groupLevels = group('edit');
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(200);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(204);
    expect(state.calls).toEqual(['update', 'delete']);
  });

  it('read share: PUT and DELETE return 403', async () => {
    state.groupLevels = group('read');
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(403);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('no visibility: 404', async () => {
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(404);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(404);
  });

  it('DELETE without user_schedule:read is 403 even with an edit share', async () => {
    state.perms = {};
    state.groupLevels = group('edit');
    expect((await new ApiTimeSheetController().deleteScheduleEntry()(req('DELETE'))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('missing entry: 404', async () => {
    state.entry = null;
    expect((await new ApiTimeSheetController().updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(404);
  });

  it('private entry edited by a non-owner is 403 even with a share', async () => {
    state.entry = { entry_id: ENTRY, calendar_id: null, is_private: true, work_item_type: 'ad_hoc', assigned_user_ids: [X] };
    state.userLevels = new Map([[X, 'edit']]);
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(403);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('delete mirrors the action: plain is_private blocks a non-owner even on a group calendar; update does not', async () => {
    state.groupLevels = group('edit');
    state.entry = groupEntry({ is_private: true });
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(200);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(403);
  });

  it('delegate with edit share on X may add X on update', async () => {
    state.entry = groupEntry({ calendar_id: null, assigned_user_ids: [ME] });
    state.userLevels = new Map([[X, 'edit']]);
    const res = await new ApiTimeSheetController().updateScheduleEntry()(req('PUT', { assigned_user_ids: [ME, X] }));
    expect(res.status).toBe(200);
  });

  it('adding someone without a share on update is 403; keeping existing assignees is fine', async () => {
    state.groupLevels = group('edit');
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { assigned_user_ids: [X, Y] }))).status).toBe(403);
    expect((await c.updateScheduleEntry()(req('PUT', { assigned_user_ids: [X] }))).status).toBe(200);
  });

  it('user_schedule:update (global) can edit and delete anything visible', async () => {
    state.perms['user_schedule:update'] = true;
    const c = new ApiTimeSheetController();
    expect((await c.updateScheduleEntry()(req('PUT', { notes: 'x' }))).status).toBe(200);
    expect((await c.deleteScheduleEntry()(req('DELETE'))).status).toBe(204);
  });
});

describe('REST schedule create', () => {
  it('delegate with edit share on X may create for X', async () => {
    state.userLevels = new Map([[X, 'edit']]);
    const res = await new ApiTimeSheetController().createScheduleEntry()(req('POST', createBody([X])));
    expect(res.status).toBe(201);
  });

  it('no share: assigning someone else is 403; self is fine', async () => {
    const c = new ApiTimeSheetController();
    expect((await c.createScheduleEntry()(req('POST', createBody([X])))).status).toBe(403);
    expect((await c.createScheduleEntry()(req('POST', createBody([ME, X])))).status).toBe(403);
    expect((await c.createScheduleEntry()(req('POST', createBody([ME])))).status).toBe(201);
    expect(state.calls).toEqual(['create']);
  });

  it('read-only share does not allow assigning', async () => {
    state.userLevels = new Map([[X, 'read']]);
    expect((await new ApiTimeSheetController().createScheduleEntry()(req('POST', createBody([X])))).status).toBe(403);
  });
});

describe('REST schedule update with calendar_id: null (move to personal)', () => {
  it('edit share on the existing group calendar: allowed', async () => {
    state.groupLevels = group('edit');
    const res = await new ApiTimeSheetController().updateScheduleEntry()(req('PUT', { calendar_id: null }));
    expect(res.status).toBe(200);
    expect(state.calls).toEqual(['update']);
  });

  it('read-only share on the existing group calendar: 403, nothing written', async () => {
    state.groupLevels = group('read');
    const res = await new ApiTimeSheetController().updateScheduleEntry()(req('PUT', { calendar_id: null }));
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('no access to the existing group calendar: 404', async () => {
    const res = await new ApiTimeSheetController().updateScheduleEntry()(req('PUT', { calendar_id: null }));
    expect(res.status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});

describe('REST GET /api/v1/calendars authorisation', () => {
  const listReq = () => new NextRequest('http://localhost/api/v1/calendars', { headers: { 'x-api-key': 'k' } });

  it('without user_schedule:read: 403 and the service is not called', async () => {
    state.perms = {};
    expect((await new ApiTimeSheetController().listCalendars()(listReq())).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('with user_schedule:read: 200', async () => {
    expect((await new ApiTimeSheetController().listCalendars()(listReq())).status).toBe(200);
    expect(state.calls).toEqual(['listCalendars']);
  });

  it('rejects an invalid type filter with 400', async () => {
    const r = new NextRequest('http://localhost/api/v1/calendars?type=bogus', { headers: { 'x-api-key': 'k' } });
    expect((await new ApiTimeSheetController().listCalendars()(r)).status).toBe(400);
  });
});
