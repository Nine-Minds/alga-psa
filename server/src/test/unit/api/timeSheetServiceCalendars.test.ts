import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/v1/calendars (service layer). Visibility comes from the shared loadVisibleCalendars helper
 * (the same one getCalendarsVisibleToMe uses) on top of resolveCalendarAccess; the access resolver is
 * stubbed per scenario, users/calendars rows are served tenant-scoped from an in-memory fake.
 */

const TENANT = 'tenant-1';
const ME = '11111111-1111-4111-8111-111111111111';
const SHARED_READ = '22222222-2222-4222-8222-222222222222';
const SHARED_EDIT = '33333333-3333-4333-8333-333333333333';
const NOT_SHARED = '44444444-4444-4444-8444-444444444444';
const OTHER_TENANT_USER = '55555555-5555-4555-8555-555555555555';
const G_EDIT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G_READ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const G_ARCHIVED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const G_HIDDEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const G_OTHER_TENANT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const state = vi.hoisted(() => ({
  canViewAll: false,
  resolveCalls: [] as boolean[],
  userLevels: new Map<string, string>(),
  groupLevels: new Map<string, any>(),
  tables: {} as Record<string, any[]>,
}));

function fakeTable(name: string, tenant: string) {
  let rows = (state.tables[name] ?? []).filter((r) => r.tenant === tenant);
  const api: any = {
    where(f: Record<string, any>) { rows = rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)); return api; },
    whereNot(k: string, v: any) { rows = rows.filter((r) => r[k] !== v); return api; },
    whereIn(k: string, vs: any[]) { rows = rows.filter((r) => vs.includes(r[k])); return api; },
    select() { return api; },
    orderBy() { return api; },
    first: async () => rows[0],
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return api;
}

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, tenantDb: (_k: unknown, tenant: string) => ({ table: (n: string) => fakeTable(n, tenant) }) };
});
vi.mock('@alga-psa/scheduling/lib/calendarAccess', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveCalendarAccess: async (_k: unknown, _t: string, viewer: { user_id: string }, canViewAll: boolean) => {
      state.resolveCalls.push(canViewAll);
      return {
        viewerUserId: viewer.user_id,
        canViewAll,
        userLevels: canViewAll ? new Map() : state.userLevels,
        groupLevels: state.groupLevels,
        hiddenCalendarIds: [],
      };
    },
  };
});
vi.mock('../../../lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, resource: string, action: string) =>
    resource === 'user_schedule' && action === 'update' ? state.canViewAll : false),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishUnregisteredEventType: vi.fn() }));

import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

const context: any = { tenant: TENANT, userId: ME, user: { user_id: ME, tenant: TENANT } };
const grant = (id: string, level: string, isArchived = false) => [id, { calendarId: id, level, isArchived }] as const;

function makeService() {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
  return service;
}

const user = (id: string, first: string, last: string, extra: Record<string, unknown> = {}) =>
  ({ tenant: TENANT, user_id: id, first_name: first, last_name: last, username: first.toLowerCase(), user_type: 'internal', is_inactive: false, ...extra });
const group = (id: string, name: string, archived = false, tenant = TENANT) =>
  ({ tenant, calendar_id: id, name, description: null, color: null, is_archived: archived, calendar_type: 'group' });

beforeEach(() => {
  state.canViewAll = false;
  state.resolveCalls.length = 0;
  state.userLevels = new Map([[SHARED_READ, 'read'], [SHARED_EDIT, 'edit']]);
  state.groupLevels = new Map([grant(G_EDIT, 'edit'), grant(G_READ, 'read')]);
  state.tables = {
    users: [
      user(ME, 'Me', 'Self'),
      user(SHARED_READ, 'Rita', 'Read'),
      user(SHARED_EDIT, 'Eddie', 'Edit'),
      user(NOT_SHARED, 'Nora', 'Nope'),
      user(OTHER_TENANT_USER, 'Olga', 'Other', { tenant: 'tenant-2' }),
    ],
    calendars: [
      group(G_EDIT, 'Edit group'),
      group(G_READ, 'Read group'),
      group(G_ARCHIVED, 'Archived group', true),
      group(G_HIDDEN, 'Hidden group'),
      group(G_OTHER_TENANT, 'Other tenant group', false, 'tenant-2'),
    ],
  };
});

describe('TimeSheetService.listCalendars', () => {
  it('returns own personal + shared personal + visible group calendars, and nothing else', async () => {
    const list = await makeService().listCalendars(context);

    expect(list.map((c) => [c.calendar_type, c.owner_user_id ?? c.calendar_id])).toEqual([
      ['personal', ME],
      ['personal', SHARED_READ],
      ['personal', SHARED_EDIT],
      ['group', G_EDIT],
      ['group', G_READ],
    ]);
    const ids = JSON.stringify(list);
    for (const hidden of [NOT_SHARED, OTHER_TENANT_USER, G_HIDDEN, G_OTHER_TENANT, G_ARCHIVED]) {
      expect(ids).not.toContain(hidden);
    }
    expect(state.resolveCalls).toEqual([false]);
  });

  it('personal calendars use null calendar_id, owner id as identity and the owner display name', async () => {
    const list = await makeService().listCalendars(context, { type: 'personal' });
    const me = list.find((c) => c.owner_user_id === ME)!;
    expect(me).toEqual({
      calendar_id: null, name: 'Me Self', calendar_type: 'personal', owner_user_id: ME,
      access_level: 'edit', can_edit: true, is_archived: false,
    });
    expect(list.every((c) => c.calendar_type === 'personal' && c.calendar_id === null)).toBe(true);
  });

  it('read share -> access_level read / can_edit false; edit share -> can_edit true', async () => {
    const list = await makeService().listCalendars(context);
    const byKey = (k: string) => list.find((c) => (c.owner_user_id ?? c.calendar_id) === k)!;
    expect(byKey(SHARED_READ)).toMatchObject({ access_level: 'read', can_edit: false });
    expect(byKey(SHARED_EDIT)).toMatchObject({ access_level: 'edit', can_edit: true });
    expect(byKey(G_READ)).toMatchObject({ access_level: 'read', can_edit: false, name: 'Read group', owner_user_id: null });
    expect(byKey(G_EDIT)).toMatchObject({ access_level: 'edit', can_edit: true });
  });

  it('manage level can edit', async () => {
    state.groupLevels = new Map([grant(G_EDIT, 'manage')]);
    const [group_] = await makeService().listCalendars(context, { type: 'group' });
    expect(group_).toMatchObject({ access_level: 'manage', can_edit: true });
  });

  it('type filter restricts to personal or group', async () => {
    const groups = await makeService().listCalendars(context, { type: 'group' });
    expect(groups.map((c) => c.calendar_id)).toEqual([G_EDIT, G_READ]);
  });

  it('archived groups are excluded by default and included with include_archived', async () => {
    state.groupLevels = new Map([grant(G_EDIT, 'manage'), grant(G_ARCHIVED, 'manage', true)]);
    const def = await makeService().listCalendars(context, { type: 'group' });
    expect(def.map((c) => c.calendar_id)).toEqual([G_EDIT]);
    const all = await makeService().listCalendars(context, { type: 'group', include_archived: true });
    expect(all.map((c) => c.calendar_id).sort()).toEqual([G_ARCHIVED, G_EDIT].sort());
    expect(all.find((c) => c.calendar_id === G_ARCHIVED)!.is_archived).toBe(true);
  });

  it('canViewAll (user_schedule:update) sees every group and every active internal user in the tenant', async () => {
    state.canViewAll = true;
    state.groupLevels = new Map([grant(G_EDIT, 'manage'), grant(G_READ, 'manage'), grant(G_HIDDEN, 'manage'), grant(G_ARCHIVED, 'manage', true)]);
    const list = await makeService().listCalendars(context, { include_archived: true });

    expect(state.resolveCalls).toEqual([true]);
    expect(list.filter((c) => c.calendar_type === 'group').map((c) => c.calendar_id).sort())
      .toEqual([G_ARCHIVED, G_EDIT, G_HIDDEN, G_READ].sort());
    const personal = list.filter((c) => c.calendar_type === 'personal').map((c) => c.owner_user_id).sort();
    expect(personal).toEqual([ME, NOT_SHARED, SHARED_EDIT, SHARED_READ].sort());
    expect(JSON.stringify(list)).not.toContain(OTHER_TENANT_USER);
    expect(JSON.stringify(list)).not.toContain(G_OTHER_TENANT);
    expect(list.filter((c) => c.owner_user_id !== ME && c.calendar_type === 'personal').every((c) => c.can_edit)).toBe(true);
  });
});
