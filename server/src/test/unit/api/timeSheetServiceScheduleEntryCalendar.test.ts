import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REST schedule entries accept calendar_id (card 7a25a001, D4). Authorization goes through the
 * same resolveCalendarAccess / assertEditableGroupCalendar path as the addScheduleEntry server action.
 */

const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  published: [] as Array<{ eventType: string; payload: any }>,
  created: [] as Array<{ entry: any; options: any }>,
  updates: [] as any[],
  groupLevels: new Map<string, { calendarId: string; level: string; isArchived: boolean }>(),
  userLevels: new Map<string, string>(),
}));

const TENANT = 'tenant-1';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const CAL_EDIT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAL_VIEW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAL_HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAL_OTHER_TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ENTRY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SERVICE_USER = '33333333-3333-4333-8333-333333333333';

function fakeTable(name: string, tenant: string) {
  let filter: Record<string, any> = {};
  const inFilters: Array<[string, any[]]> = [];
  const rows = () =>
    (state.tables[name] ?? []).filter(
      (row) =>
        row.tenant === tenant &&
        Object.entries(filter).every(([k, v]) => row[k] === v) &&
        inFilters.every(([k, values]) => values.includes(row[k])),
    );
  const api: any = {
    where(f: Record<string, any>) {
      filter = { ...filter, ...f };
      return api;
    },
    whereIn(column: string, values: any[]) {
      inFilters.push([column, values]);
      return api;
    },
    first: async () => rows()[0],
    select: async (...columns: string[]) =>
      rows().map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))),
    pluck: async (column: string) => rows().map((row) => row[column]),
    update: async (data: any) => {
      state.updates.push({ table: name, data });
      rows().forEach((row) => Object.assign(row, data));
      return 1;
    },
    del: async () => {
      state.tables[name] = (state.tables[name] ?? []).filter((row) => !rows().includes(row));
      return 1;
    },
    insert: async (data: any) => {
      state.tables[name] = [...(state.tables[name] ?? []), ...[].concat(data as any)];
    },
  };
  return api;
}

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    tenantDb: (_knex: unknown, tenant: string) => ({ table: (name: string) => fakeTable(name, tenant) }),
    withTransaction: async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => cb({}),
  };
});

vi.mock('@alga-psa/scheduling/lib/calendarAccess', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    resolveCalendarAccess: async (_knex: unknown, _tenant: string, viewer: { user_id: string }) => ({
      viewerUserId: viewer.user_id,
      canViewAll: false,
      userLevels: state.userLevels,
      groupLevels: state.groupLevels,
      hiddenCalendarIds: [],
    }),
  };
});

vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => false) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async (event: any) => {
    state.published.push(event);
  }),
}));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishUnregisteredEventType: vi.fn() }));
vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  validateAllDayInterval: vi.fn(),
  default: {
    create: vi.fn(async (_trx: unknown, _tenant: string, entry: any, options: any) => {
      state.created.push({ entry, options });
      return { ...entry, entry_id: ENTRY_ID, assigned_user_ids: options.assignedUserIds };
    }),
  },
}));

import { hasPermission } from '../../../lib/auth/rbac';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';
import { createScheduleEntrySchema, updateScheduleEntrySchema } from '../../../lib/api/schemas/timeSheet';

const context: any = { tenant: TENANT, userId: USER, user: { user_id: USER, tenant: TENANT } };

const baseCreate = {
  title: 'Standup',
  scheduled_start: '2026-10-22T10:00:00.000Z',
  scheduled_end: '2026-10-22T11:00:00.000Z',
  work_item_type: 'meeting' as const,
};

function makeService() {
  const service = new TimeSheetService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
  vi.spyOn(service as any, 'getScheduleEntry').mockResolvedValue({ entry_id: ENTRY_ID });
  return service;
}

describe('REST schedule entries: calendar_id', () => {
  beforeEach(() => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    state.published.length = 0;
    state.created.length = 0;
    state.updates.length = 0;
    state.userLevels = new Map();
    state.groupLevels = new Map([
      [CAL_EDIT, { calendarId: CAL_EDIT, level: 'edit', isArchived: false }],
      [CAL_VIEW, { calendarId: CAL_VIEW, level: 'view', isArchived: false }],
    ]);
    state.tables = {
      calendars: [
        { tenant: TENANT, calendar_id: CAL_EDIT, calendar_type: 'group', is_archived: false },
        { tenant: TENANT, calendar_id: CAL_VIEW, calendar_type: 'group', is_archived: false },
        { tenant: TENANT, calendar_id: CAL_HIDDEN, calendar_type: 'group', is_archived: false },
        { tenant: 'tenant-2', calendar_id: CAL_OTHER_TENANT, calendar_type: 'group', is_archived: false },
      ],
      schedule_entries: [
        { tenant: TENANT, entry_id: ENTRY_ID, title: 'Standup', created_by: USER, calendar_id: null, is_private: false,
          is_all_day: false, scheduled_start: new Date('2026-10-22T10:00:00Z'), scheduled_end: new Date('2026-10-22T11:00:00Z') },
      ],
      schedule_entry_assignees: [{ tenant: TENANT, entry_id: ENTRY_ID, user_id: USER }],
      users: [
        { tenant: TENANT, user_id: USER, user_type: 'internal', is_inactive: false },
        { tenant: TENANT, user_id: OTHER_USER, user_type: 'internal', is_inactive: false },
        { tenant: TENANT, user_id: SERVICE_USER, user_type: 'service', is_inactive: false },
      ],
    };
  });

  describe('schemas', () => {
    it('accepts calendar_id on create and update and rejects non-uuid values', () => {
      expect(createScheduleEntrySchema.parse({ ...baseCreate, calendar_id: CAL_EDIT }).calendar_id).toBe(CAL_EDIT);
      expect(updateScheduleEntrySchema.parse({ calendar_id: CAL_EDIT }).calendar_id).toBe(CAL_EDIT);
      expect(() => createScheduleEntrySchema.parse({ ...baseCreate, calendar_id: 'nope' })).toThrow();
    });

    it('accepts calendar_id null (move to personal) on update and create; omitted stays undefined', () => {
      expect(updateScheduleEntrySchema.parse({ calendar_id: null }).calendar_id).toBeNull();
      expect(updateScheduleEntrySchema.parse({ title: 'x' }).calendar_id).toBeUndefined();
      expect(createScheduleEntrySchema.parse({ ...baseCreate, calendar_id: null }).calendar_id).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a group-calendar entry with no assignees (does not default to the caller)', async () => {
      await makeService().createScheduleEntry({ ...baseCreate, calendar_id: CAL_EDIT } as any, context);

      expect(state.created).toHaveLength(1);
      expect(state.created[0].entry.calendar_id).toBe(CAL_EDIT);
      expect(state.created[0].options.assignedUserIds).toEqual([]);
      expect(state.published[0].eventType).toBe('SCHEDULE_ENTRY_CREATED');
    });

    it('uses exactly assigned_user_ids on a group calendar', async () => {
      await makeService().createScheduleEntry(
        { ...baseCreate, calendar_id: CAL_EDIT, assigned_user_ids: [USER] } as any,
        context,
      );
      expect(state.created[0].options.assignedUserIds).toEqual([USER]);
    });

    it('rejects assigning other users without the right to (403)', async () => {
      await expect(
        makeService().createScheduleEntry(
          { ...baseCreate, calendar_id: CAL_EDIT, assigned_user_ids: [OTHER_USER] } as any,
          context,
        ),
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(state.created).toHaveLength(0);
    });

    it('returns 404 for a calendar in another tenant and never creates a personal entry', async () => {
      await expect(
        makeService().createScheduleEntry({ ...baseCreate, calendar_id: CAL_OTHER_TENANT } as any, context),
      ).rejects.toMatchObject({ name: 'NotFoundError' });
      expect(state.created).toHaveLength(0);
    });

    it('returns 404 for a group calendar the caller cannot see', async () => {
      await expect(
        makeService().createScheduleEntry({ ...baseCreate, calendar_id: CAL_HIDDEN } as any, context),
      ).rejects.toMatchObject({ name: 'NotFoundError' });
      expect(state.created).toHaveLength(0);
    });

    it('returns 403 for a calendar the caller can see but not write', async () => {
      await expect(
        makeService().createScheduleEntry({ ...baseCreate, calendar_id: CAL_VIEW } as any, context),
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(state.created).toHaveLength(0);
    });

    it('treats calendar_id null exactly like absent', async () => {
      await makeService().createScheduleEntry({ ...baseCreate, calendar_id: null, assigned_user_ids: [USER] } as any, context);
      expect(state.created[0].entry.calendar_id).toBeNull();
      expect(state.created[0].options.assignedUserIds).toEqual([USER]);
    });

    it('keeps the old behaviour when calendar_id is absent (null calendar, assignees as given)', async () => {
      await makeService().createScheduleEntry({ ...baseCreate, assigned_user_ids: [USER] } as any, context);
      expect(state.created[0].entry.calendar_id).toBeNull();
      expect(state.created[0].options.assignedUserIds).toEqual([USER]);

      state.created.length = 0;
      await makeService().createScheduleEntry({ ...baseCreate } as any, context);
      expect(state.created[0].entry.calendar_id).toBeNull();
      expect(state.created[0].options.assignedUserIds).toEqual([]);
    });
  });

  describe('update', () => {
    it('moves an entry onto an editable group calendar', async () => {
      await makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: CAL_EDIT } as any, context);

      const rowUpdate = state.updates.find((u) => u.table === 'schedule_entries');
      expect(rowUpdate.data.calendar_id).toBe(CAL_EDIT);
      expect(rowUpdate.data.is_private).toBe(false);
    });

    it('rejects a move to a cross-tenant (404), hidden (404) or read-only (403) calendar and writes nothing', async () => {
      const service = makeService();
      await expect(service.updateScheduleEntry(ENTRY_ID, { calendar_id: CAL_OTHER_TENANT } as any, context))
        .rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(service.updateScheduleEntry(ENTRY_ID, { calendar_id: CAL_HIDDEN } as any, context))
        .rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(service.updateScheduleEntry(ENTRY_ID, { calendar_id: CAL_VIEW } as any, context))
        .rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(state.updates).toHaveLength(0);
      expect(state.published).toHaveLength(0);
    });

    it('publishes SCHEDULE_ENTRY_UPDATED with before/after assignedUserIds so external sync runs', async () => {
      // Clearing the assignee needs schedule-manage rights (existing rule, unchanged).
      vi.mocked(hasPermission).mockResolvedValue(true);
      await makeService().updateScheduleEntry(
        ENTRY_ID,
        { calendar_id: CAL_EDIT, assigned_user_ids: [] } as any,
        context,
      );

      const event = state.published.find((e) => e.eventType === 'SCHEDULE_ENTRY_UPDATED');
      expect(event).toBeDefined();
      expect(event!.payload.changes.before.assignedUserIds).toEqual([USER]);
      expect(event!.payload.changes.after.assignedUserIds).toEqual([]);
      expect(event!.payload.entryId).toBe(ENTRY_ID);
    });

    // The caller holds edit on these users' calendars, so the assignment right is not what blocks.
    const grantAssign = (...userIds: string[]) => userIds.forEach((userId) => state.userLevels.set(userId, 'edit'));

    it('replaces assignees when every added assignee is an active internal user', async () => {
      grantAssign(OTHER_USER);
      await makeService().updateScheduleEntry(ENTRY_ID, { assigned_user_ids: [USER, OTHER_USER] } as any, context);

      expect(state.tables.schedule_entry_assignees.map((a) => a.user_id)).toEqual([USER, OTHER_USER]);
      const event = state.published.find((e) => e.eventType === 'SCHEDULE_ENTRY_UPDATED');
      expect(event!.payload.changes.after.assignedUserIds).toEqual([USER, OTHER_USER]);
    });

    it('rejects adding a service user as assignee and leaves the existing assignees in place', async () => {
      grantAssign(SERVICE_USER);
      await expect(
        makeService().updateScheduleEntry(ENTRY_ID, { assigned_user_ids: [USER, SERVICE_USER] } as any, context),
      ).rejects.toMatchObject({ name: 'HumanWorkAssigneeInvalidError' });

      expect(state.tables.schedule_entry_assignees.map((a) => a.user_id)).toEqual([USER]);
      expect(state.published).toHaveLength(0);
    });

    it('keeps a legacy non-human assignee without blocking the edit (only added ids are validated)', async () => {
      grantAssign(OTHER_USER);
      state.tables.schedule_entries[0].calendar_id = CAL_EDIT;
      state.tables.schedule_entry_assignees = [
        { tenant: TENANT, entry_id: ENTRY_ID, user_id: USER },
        { tenant: TENANT, entry_id: ENTRY_ID, user_id: SERVICE_USER },
      ];
      await makeService().updateScheduleEntry(
        ENTRY_ID,
        { assigned_user_ids: [USER, SERVICE_USER, OTHER_USER] } as any,
        context,
      );

      expect(state.tables.schedule_entry_assignees.map((a) => a.user_id)).toEqual([USER, SERVICE_USER, OTHER_USER]);
    });

    it('carries the existing assignees into the event when assigned_user_ids is not supplied', async () => {
      await makeService().updateScheduleEntry(ENTRY_ID, { title: 'Renamed' } as any, context);

      const event = state.published.find((e) => e.eventType === 'SCHEDULE_ENTRY_UPDATED');
      expect(event!.payload.changes.before.assignedUserIds).toEqual([USER]);
      expect(event!.payload.changes.after.assignedUserIds).toEqual([USER]);
    });
  });
  describe('update with calendar_id null / omitted', () => {
    const onGroup = (calendarId = CAL_EDIT, isPrivate = false) => {
      state.tables.schedule_entries[0] = { ...state.tables.schedule_entries[0], calendar_id: calendarId, is_private: isPrivate };
    };

    it('group entry -> null persists null, keeps assignees and does not touch is_private (as the action does)', async () => {
      onGroup();
      await makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: null } as any, context);

      const rowUpdate = state.updates.find((u) => u.table === 'schedule_entries');
      expect(rowUpdate.data.calendar_id).toBeNull();
      expect('is_private' in rowUpdate.data).toBe(false);
      expect(state.tables.schedule_entries[0].calendar_id).toBeNull();
      expect(state.tables.schedule_entry_assignees.map((a) => a.user_id)).toEqual([USER]);
    });

    it('group entry -> null with is_private: true makes it a private personal entry', async () => {
      onGroup();
      await makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: null, is_private: true } as any, context);
      const rowUpdate = state.updates.find((u) => u.table === 'schedule_entries');
      expect(rowUpdate.data.calendar_id).toBeNull();
      expect(rowUpdate.data.is_private).toBe(true);
    });

    it('publishes before/after assignedUserIds after a group -> personal move', async () => {
      onGroup();
      await makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: null } as any, context);
      const event = state.published.find((e) => e.eventType === 'SCHEDULE_ENTRY_UPDATED');
      expect(event!.payload.changes.before.assignedUserIds).toEqual([USER]);
      expect(event!.payload.changes.after.assignedUserIds).toEqual([USER]);
    });

    it('omitted calendar_id leaves the calendar unchanged and keeps a group entry non-private', async () => {
      onGroup();
      await makeService().updateScheduleEntry(ENTRY_ID, { title: 'Renamed' } as any, context);
      const rowUpdate = state.updates.find((u) => u.table === 'schedule_entries');
      expect('calendar_id' in rowUpdate.data).toBe(false);
      expect(rowUpdate.data.is_private).toBe(false);
      expect(state.tables.schedule_entries[0].calendar_id).toBe(CAL_EDIT);
    });

    it('null on an entry the caller can only read: 403; no access: 404; nothing written', async () => {
      onGroup(CAL_VIEW);
      // Assigned to someone else, so the caller's access comes only from the calendar share.
      state.tables.schedule_entry_assignees = [{ tenant: TENANT, entry_id: ENTRY_ID, user_id: OTHER_USER }];
      state.groupLevels.set(CAL_VIEW, { calendarId: CAL_VIEW, level: 'read', isArchived: false });
      await expect(makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: null } as any, context))
        .rejects.toMatchObject({ name: 'ForbiddenError' });
      onGroup(CAL_HIDDEN);
      await expect(makeService().updateScheduleEntry(ENTRY_ID, { calendar_id: null } as any, context))
        .rejects.toMatchObject({ name: 'NotFoundError' });
      expect(state.updates).toHaveLength(0);
      expect(state.published).toHaveLength(0);
    });
  });

  describe('update/delete follow the shared-calendar rule (same as the controller)', () => {
    const groupEntry = () => {
      state.tables.schedule_entries[0] = { ...state.tables.schedule_entries[0], created_by: OTHER_USER, calendar_id: CAL_EDIT };
      state.tables.schedule_entry_assignees = [{ tenant: TENANT, entry_id: ENTRY_ID, user_id: OTHER_USER }];
    };

    it('edit share on the group calendar may update and delete', async () => {
      groupEntry();
      const service = makeService();
      await service.updateScheduleEntry(ENTRY_ID, { notes: 'x' } as any, context);
      await service.deleteScheduleEntry(ENTRY_ID, context);
      expect(state.tables.schedule_entries).toHaveLength(0);
    });

    it('read-only share gets 403; no visibility gets 404', async () => {
      groupEntry();
      state.tables.schedule_entries[0].calendar_id = CAL_VIEW;
      state.groupLevels.set(CAL_VIEW, { calendarId: CAL_VIEW, level: 'read', isArchived: false });
      await expect(makeService().updateScheduleEntry(ENTRY_ID, { notes: 'x' } as any, context))
        .rejects.toMatchObject({ name: 'ForbiddenError' });
      await expect(makeService().deleteScheduleEntry(ENTRY_ID, context))
        .rejects.toMatchObject({ name: 'ForbiddenError' });
      state.tables.schedule_entries[0].calendar_id = CAL_HIDDEN;
      await expect(makeService().updateScheduleEntry(ENTRY_ID, { notes: 'x' } as any, context))
        .rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });
});
