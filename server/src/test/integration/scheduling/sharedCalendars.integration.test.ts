import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from 'server/test-utils/testContext';
import { createUser } from 'server/test-utils/testDataFactory';

import {
  getScheduleEntries,
  getScheduleEntryById,
  addScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
} from '@alga-psa/scheduling/actions/scheduleActions';
import {
  setMyCalendarShares,
  getMyCalendarShares,
  getCalendarsVisibleToMe,
  getShareableTeams,
  getShareableUsers,
  createGroupCalendar,
  setGroupCalendarShares,
  archiveGroupCalendar,
  restoreGroupCalendar,
} from '@alga-psa/scheduling/actions/calendarSharingActions';
import { resolveCalendarAccess } from '@alga-psa/scheduling/lib/calendarAccess';
import type { IScheduleEntry } from '@alga-psa/types';
import { publishEvent } from '@alga-psa/event-bus/publishers';

// testMocks already stubs the event-bus publishers (no Redis in tests).
const publishEventMock = vi.mocked(publishEvent);

const dbRef = vi.hoisted(() => ({ knex: null as any, tenant: '' as string }));
const userRef = vi.hoisted(() => ({ user: null as any }));
// Permissions per user id; everyone gets user_schedule:read unless overridden.
const permsRef = vi.hoisted(() => ({ byUser: new Map<string, Set<string>>() }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  // The notification subscriber resolves its own connection; route it to the
  // same transaction so rows inserted by the test are visible to it.
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/auth', () => {
  const wrap = (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args);
  return {
    withAuth: wrap,
    withOptionalAuth: wrap,
    withAuthCheck: wrap,
    hasPermission: vi.fn(async (user: any, resource: string, action: string) => {
      const perms = permsRef.byUser.get(user.user_id) ?? new Set(['user_schedule:read']);
      return perms.has(`${resource}:${action}`);
    }),
    getCurrentUser: vi.fn(async () => userRef.user),
    getSession: vi.fn(async () => (userRef.user ? { user: { id: userRef.user.user_id, tenant: dbRef.tenant } } : null)),
  };
});

const HOOK_TIMEOUT = 240_000;
const helpers = TestContext.createHelpers();

const RANGE_START = new Date('2031-03-01T00:00:00Z');
const RANGE_END = new Date('2031-03-08T00:00:00Z');

describe('Shared calendars integration', () => {
  let ctx: TestContext;
  let ownerA: string;
  let viewerB: string;
  let teamMemberC: string;
  let outsiderE: string;
  let inactiveD: string;
  let clientUser: string;
  let teamId: string;

  const table = (name: string) => tenantDb(ctx.db, ctx.tenantId).table(name);

  function actAs(userId: string, perms: string[] = ['user_schedule:read']) {
    userRef.user = { user_id: userId, tenant: ctx.tenantId, user_type: 'internal', roles: [] };
    permsRef.byUser.set(userId, new Set(perms));
  }

  async function insertEntry(assignees: string[], overrides: Partial<IScheduleEntry> & Record<string, unknown> = {}) {
    const entryId = uuidv4();
    await table('schedule_entries').insert({
      tenant: ctx.tenantId,
      entry_id: entryId,
      title: 'Customer visit',
      notes: 'secret notes',
      scheduled_start: new Date('2031-03-03T10:00:00Z'),
      scheduled_end: new Date('2031-03-03T11:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      is_recurring: false,
      is_private: false,
      ...overrides,
    });
    if (assignees.length > 0) {
      await table('schedule_entry_assignees').insert(
        assignees.map((user_id) => ({ tenant: ctx.tenantId, entry_id: entryId, user_id }))
      );
    }
    return entryId;
  }

  async function entriesFor(userId: string, perms?: string[]) {
    actAs(userId, perms);
    const result = await getScheduleEntries(RANGE_START, RANGE_END);
    if (!result.success) throw new Error(result.error);
    return result.entries;
  }

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['calendar_shares', 'calendars'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    dbRef.knex = ctx.db;
    dbRef.tenant = ctx.tenantId;
    permsRef.byUser.clear();
    publishEventMock.mockClear();

    ownerA = await createUser(ctx.db, ctx.tenantId, { first_name: 'Alice', last_name: 'Owner' });
    viewerB = await createUser(ctx.db, ctx.tenantId, { first_name: 'Bob', last_name: 'Viewer' });
    teamMemberC = await createUser(ctx.db, ctx.tenantId, { first_name: 'Cara', last_name: 'Member' });
    outsiderE = await createUser(ctx.db, ctx.tenantId, { first_name: 'Eve', last_name: 'Outsider' });
    inactiveD = await createUser(ctx.db, ctx.tenantId, { first_name: 'Dave', last_name: 'Dormant', is_inactive: true });
    clientUser = await createUser(ctx.db, ctx.tenantId, { user_type: 'client' });

    teamId = uuidv4();
    await table('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'Field techs', manager_id: outsiderE });
    await table('team_members').insert({ tenant: ctx.tenantId, team_id: teamId, user_id: teamMemberC, role: 'lead' });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  // T001
  it('persists calendars and shares with upsert and shape constraints', async () => {
    actAs(ownerA);
    const first = await setMyCalendarShares([{ grantee_type: 'user', grantee_id: viewerB, access_level: 'read' }]);
    expect(first.success).toBe(true);
    const second = await setMyCalendarShares([{ grantee_type: 'user', grantee_id: viewerB, access_level: 'edit' }]);
    expect(second.success).toBe(true);

    const personal = await table('calendars').where({ calendar_type: 'personal', owner_user_id: ownerA });
    expect(personal).toHaveLength(1);
    const shares = await table('calendar_shares').where({ calendar_id: personal[0].calendar_id });
    expect(shares).toHaveLength(1);
    expect(shares[0].access_level).toBe('edit');

    await expect(
      ctx.db.transaction(async (trx) =>
        tenantDb(trx, ctx.tenantId).table('calendars').insert({
          tenant: ctx.tenantId,
          calendar_type: 'personal',
          owner_user_id: ownerA,
        })
      )
    ).rejects.toThrow();
    await expect(
      ctx.db.transaction(async (trx) =>
        tenantDb(trx, ctx.tenantId).table('calendars').insert({ tenant: ctx.tenantId, calendar_type: 'group' })
      )
    ).rejects.toThrow();
  });

  // T002
  it('resolves the highest level across direct and team grants, ignoring inactive owners', async () => {
    actAs(ownerA);
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: teamMemberC, access_level: 'free_busy' },
      { grantee_type: 'team', grantee_id: teamId, access_level: 'read' },
    ]);
    actAs(outsiderE);
    await setMyCalendarShares([{ grantee_type: 'team', grantee_id: teamId, access_level: 'free_busy' }]);

    const accessC = await resolveCalendarAccess(ctx.db, ctx.tenantId, { user_id: teamMemberC }, false);
    expect(accessC.userLevels.get(ownerA)).toBe('read');
    expect(accessC.userLevels.get(outsiderE)).toBe('free_busy');

    await table('users').where({ user_id: ownerA }).update({ is_inactive: true });
    const afterInactive = await resolveCalendarAccess(ctx.db, ctx.tenantId, { user_id: teamMemberC }, false);
    expect(afterInactive.userLevels.has(ownerA)).toBe(false);

    const none = await resolveCalendarAccess(ctx.db, ctx.tenantId, { user_id: viewerB }, false);
    expect(none.userLevels.size).toBe(0);

    const admin = await resolveCalendarAccess(ctx.db, ctx.tenantId, { user_id: viewerB }, true);
    expect(admin.canViewAll).toBe(true);
  });

  // T003
  it('returns own, shared (masked when private or free/busy) and hides unshared entries', async () => {
    const publicEntry = await insertEntry([ownerA]);
    const privateEntry = await insertEntry([ownerA], { is_private: true, title: 'Doctor' });
    const outsiderEntry = await insertEntry([outsiderE]);
    const ownEntry = await insertEntry([viewerB]);

    actAs(ownerA);
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'read' },
      { grantee_type: 'team', grantee_id: teamId, access_level: 'free_busy' },
    ]);

    const forB = await entriesFor(viewerB);
    const byId = new Map(forB.map((e) => [e.entry_id, e]));
    expect(byId.get(ownEntry)?.access).toBe('full');
    expect(byId.get(publicEntry)?.title).toBe('Customer visit');
    expect(byId.get(publicEntry)?.can_edit).toBe(false);
    const masked = byId.get(privateEntry)!;
    expect(masked.access).toBe('busy');
    expect(masked.title).toBe('Busy');
    expect(masked.notes).toBe('');
    expect(masked.work_item_id).toBeNull();
    expect(byId.has(outsiderEntry)).toBe(false);

    const forC = await entriesFor(teamMemberC);
    expect(forC.map((e) => e.entry_id).sort()).toEqual([privateEntry, publicEntry].sort());
    expect(forC.every((e) => e.access === 'busy' && e.title === 'Busy')).toBe(true);

    // user_schedule:update keeps seeing everything; private entries stay Busy.
    const forAdmin = await entriesFor(outsiderE, ['user_schedule:read', 'user_schedule:update']);
    const adminIds = forAdmin.map((e) => e.entry_id);
    expect(adminIds).toEqual(expect.arrayContaining([publicEntry, privateEntry, outsiderEntry, ownEntry]));
    expect(forAdmin.find((e) => e.entry_id === privateEntry)?.title).toBe('Busy');
  });

  // T004
  it('getScheduleEntryById enforces read permission and the resolver', async () => {
    const entryId = await insertEntry([ownerA]);

    actAs(viewerB, []);
    const denied = await getScheduleEntryById(entryId);
    expect(denied).toMatchObject({ permissionError: expect.any(String) });

    actAs(viewerB);
    expect(await getScheduleEntryById(entryId)).toBeNull();

    actAs(ownerA);
    await setMyCalendarShares([{ grantee_type: 'user', grantee_id: viewerB, access_level: 'free_busy' }]);
    actAs(viewerB);
    const busy = (await getScheduleEntryById(entryId)) as IScheduleEntry;
    expect(busy.access).toBe('busy');
    expect(busy.title).toBe('Busy');
    expect(busy.notes).toBe('');
  });

  // T005
  it('lets an edit delegate create and move entries for the owner, and rejects read-only delegates', async () => {
    const ownerEntry = await insertEntry([ownerA]);
    const privateEntry = await insertEntry([ownerA], { is_private: true });

    actAs(ownerA);
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'edit' },
      { grantee_type: 'user', grantee_id: teamMemberC, access_level: 'read' },
    ]);

    actAs(viewerB);
    const created = await addScheduleEntry({
      title: 'Booked by delegate',
      scheduled_start: new Date('2031-03-04T09:00:00Z'),
      scheduled_end: new Date('2031-03-04T10:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      assigned_user_ids: [ownerA],
    } as any);
    expect(created.success).toBe(true);

    const moved = await updateScheduleEntry(ownerEntry, {
      scheduled_start: new Date('2031-03-05T10:00:00Z'),
      scheduled_end: new Date('2031-03-05T11:00:00Z'),
    });
    expect(moved.success).toBe(true);

    const privateUpdate = await updateScheduleEntry(privateEntry, { title: 'x' });
    expect(privateUpdate.success).toBe(false);

    const assignOutsider = await addScheduleEntry({
      title: 'Nope',
      scheduled_start: new Date('2031-03-04T09:00:00Z'),
      scheduled_end: new Date('2031-03-04T10:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      assigned_user_ids: [outsiderE],
    } as any);
    expect(assignOutsider.success).toBe(false);

    actAs(teamMemberC);
    const readCreate = await addScheduleEntry({
      title: 'Not allowed',
      scheduled_start: new Date('2031-03-04T09:00:00Z'),
      scheduled_end: new Date('2031-03-04T10:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      assigned_user_ids: [ownerA],
    } as any);
    expect(readCreate.success).toBe(false);
    expect((await updateScheduleEntry(ownerEntry, { title: 'changed' })).success).toBe(false);
    expect((await deleteScheduleEntry(ownerEntry)).success).toBe(false);
  });

  // T006
  it('supports group calendars with edit/read members, last-manager guard and archiving', async () => {
    actAs(ownerA);
    const created = await createGroupCalendar({
      name: 'On-call rotation',
      color: '#ff0000',
      members: [
        { grantee_type: 'user', grantee_id: viewerB, access_level: 'edit' },
        { grantee_type: 'user', grantee_id: teamMemberC, access_level: 'read' },
      ],
    });
    expect(created.success).toBe(true);
    const calendarId = (created as any).data.calendar_id as string;

    actAs(viewerB);
    const groupEntry = await addScheduleEntry({
      title: 'On call',
      scheduled_start: new Date('2031-03-02T00:00:00Z'),
      scheduled_end: new Date('2031-03-02T08:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      is_private: true,
      calendar_id: calendarId,
      assigned_user_ids: [],
    } as any);
    expect(groupEntry.success).toBe(true);
    const stored = await table('schedule_entries').where({ entry_id: (groupEntry as any).entry.entry_id }).first();
    expect(stored.is_private).toBe(false);
    expect(stored.calendar_id).toBe(calendarId);

    actAs(teamMemberC);
    const readerCreate = await addScheduleEntry({
      title: 'Nope',
      scheduled_start: new Date('2031-03-02T00:00:00Z'),
      scheduled_end: new Date('2031-03-02T08:00:00Z'),
      status: 'scheduled',
      work_item_type: 'ad_hoc',
      work_item_id: null,
      calendar_id: calendarId,
    } as any);
    expect(readerCreate.success).toBe(false);
    const readerView = await entriesFor(teamMemberC);
    expect(readerView.find((e) => e.calendar_id === calendarId)?.access).toBe('full');

    actAs(ownerA);
    const removeLastManager = await setGroupCalendarShares(calendarId, [
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'edit' },
    ]);
    expect(removeLastManager.success).toBe(false);

    actAs(viewerB);
    expect((await archiveGroupCalendar(calendarId)).success).toBe(false);

    actAs(ownerA);
    expect((await archiveGroupCalendar(calendarId)).success).toBe(true);
    expect((await entriesFor(teamMemberC)).some((e) => e.calendar_id === calendarId)).toBe(false);
    expect((await entriesFor(ownerA)).some((e) => e.calendar_id === calendarId)).toBe(true);
    actAs(teamMemberC);
    const visibleToC = await getCalendarsVisibleToMe();
    expect(visibleToC.success && visibleToC.data.groups.some((g) => g.calendar_id === calendarId)).toBe(false);

    actAs(ownerA);
    expect((await restoreGroupCalendar(calendarId)).success).toBe(true);
    expect((await entriesFor(teamMemberC)).some((e) => e.calendar_id === calendarId)).toBe(true);
  });

  // T007
  it('revokes visibility when a share, a team membership or a team is removed', async () => {
    const entryId = await insertEntry([ownerA]);
    actAs(ownerA);
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'read' },
      { grantee_type: 'team', grantee_id: teamId, access_level: 'read' },
    ]);
    expect((await entriesFor(viewerB)).some((e) => e.entry_id === entryId)).toBe(true);
    expect((await entriesFor(teamMemberC)).some((e) => e.entry_id === entryId)).toBe(true);

    actAs(ownerA);
    await setMyCalendarShares([{ grantee_type: 'team', grantee_id: teamId, access_level: 'read' }]);
    expect((await entriesFor(viewerB)).some((e) => e.entry_id === entryId)).toBe(false);

    await table('team_members').where({ team_id: teamId, user_id: teamMemberC }).del();
    expect((await entriesFor(teamMemberC)).some((e) => e.entry_id === entryId)).toBe(false);

    // Team deletion path removes team grants (teamActions.deleteTeam does the same delete).
    await table('team_members').insert({ tenant: ctx.tenantId, team_id: teamId, user_id: teamMemberC, role: 'member' });
    expect((await entriesFor(teamMemberC)).some((e) => e.entry_id === entryId)).toBe(true);
    await table('calendar_shares').where({ grantee_type: 'team', grantee_id: teamId }).del();
    expect((await entriesFor(teamMemberC)).some((e) => e.entry_id === entryId)).toBe(false);
  });

  // T008
  it('guards share actions', async () => {
    actAs(ownerA);
    expect((await setMyCalendarShares([{ grantee_type: 'user', grantee_id: ownerA, access_level: 'read' }])).success).toBe(false);
    expect((await setMyCalendarShares([{ grantee_type: 'user', grantee_id: clientUser, access_level: 'read' }])).success).toBe(false);
    expect((await setMyCalendarShares([{ grantee_type: 'user', grantee_id: viewerB, access_level: 'manage' }])).success).toBe(false);

    actAs(viewerB);
    expect((await setMyCalendarShares([{ grantee_type: 'user', grantee_id: teamMemberC, access_level: 'read' }], ownerA)).success).toBe(false);
    expect((await getMyCalendarShares(ownerA)).success).toBe(false);

    actAs(viewerB, ['user_schedule:read', 'user_schedule:update']);
    expect((await setMyCalendarShares([{ grantee_type: 'user', grantee_id: teamMemberC, access_level: 'read' }], ownerA)).success).toBe(true);
  });

  // T009
  it('publishes CALENDAR_SHARE_GRANTED for new or changed user grants only and notifies the grantee', async () => {
    actAs(ownerA);
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'read' },
      { grantee_type: 'team', grantee_id: teamId, access_level: 'read' },
    ]);
    const grantEvents = () =>
      publishEventMock.mock.calls
        .map((call: any[]) => call[0])
        .filter((event: any) => event.eventType === 'CALENDAR_SHARE_GRANTED');
    expect(grantEvents()).toHaveLength(1);
    expect(grantEvents()[0].payload).toMatchObject({ granteeType: 'user', granteeId: viewerB, accessLevel: 'read' });

    // The real event bus is stubbed in tests, so drive the notification
    // subscriber directly with the published event. `getConnection` is mocked
    // above to the test transaction, so the subscriber and this assertion see
    // the same rows. This is what proves CALENDAR_SHARE_GRANTED routes to
    // internal-notifications (see the INTERNAL_NOTIFICATION_EVENT_TYPES sets).
    const { internalNotificationSubscriberTestHarness } = await import(
      'server/src/lib/eventBus/subscribers/internalNotificationSubscriber'
    );
    await internalNotificationSubscriberTestHarness.handleCalendarShareGranted(grantEvents()[0] as any);

    const notification = await table('internal_notifications')
      .where({ user_id: viewerB, template_name: 'calendar-share-granted' })
      .first();
    expect(notification).toBeTruthy();
    expect(notification.title).toBe('Alice Owner shared their calendar with you');
    expect(notification.message).toContain('Alice Owner');

    publishEventMock.mockClear();
    await setMyCalendarShares([
      { grantee_type: 'user', grantee_id: viewerB, access_level: 'read' },
      { grantee_type: 'team', grantee_id: teamId, access_level: 'read' },
    ]);
    expect(grantEvents()).toHaveLength(0);
  });

  // T017
  it('lists active internal users for the share picker without requiring user:read', async () => {
    actAs(viewerB, ['user_schedule:read']);

    const usersResult = await getShareableUsers();
    expect(usersResult.success).toBe(true);
    if (!usersResult.success) throw new Error(usersResult.error);
    const returnedIds = usersResult.data.map((u) => u.user_id);
    expect(returnedIds).toContain(ownerA);
    expect(returnedIds).toContain(teamMemberC);
    expect(returnedIds).not.toContain(inactiveD);
    expect(returnedIds).not.toContain(clientUser);
    expect(usersResult.data.every((u) => u.user_type === 'internal' && u.is_inactive === false)).toBe(true);

    const teamsResult = await getShareableTeams();
    expect(teamsResult.success).toBe(true);
    if (!teamsResult.success) throw new Error(teamsResult.error);
    const field = teamsResult.data.find((team) => team.team_id === teamId);
    expect(field).toBeTruthy();
    const lead = field!.members.find((member) => member.role === 'lead');
    expect(lead).toMatchObject({ user_id: teamMemberC, first_name: 'Cara', last_name: 'Member' });
  });
});
