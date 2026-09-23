'use server'

/**
 * Shared calendars: manage who can see a personal calendar, manage group
 * calendars, and list the calendars visible to the current user.
 *
 * See ee/docs/plans/2026-09-22-shared-calendars/PRD.md. Access decisions for
 * schedule entries live in lib/calendarAccess.
 */

import type { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type {
  CalendarAccessLevel,
  ICalendar,
  ICalendarShareInput,
  ICalendarShareView,
  IScheduleViewerCapabilities,
  ITeam,
  IUser,
  IVisibleCalendar,
} from '@alga-psa/types';
import {
  GROUP_ACCESS_LEVELS,
  PERSONAL_ACCESS_LEVELS,
  personalCalendarColor,
  resolveCalendarAccess,
} from '../lib/calendarAccess';

export type CalendarSharingResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

interface SharingUser {
  user_id: string;
  user_type?: string;
}

const DEFAULT_GROUP_CALENDAR_COLOR = '#6366f1';

function fail<T>(error: string): CalendarSharingResult<T> {
  return { success: false, error };
}

function displayName(row: { first_name?: string | null; last_name?: string | null; username?: string | null }): string {
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.username || '';
}

/** Every sharing action requires an internal MSP user with user_schedule:read. */
async function checkBaseAccess(
  user: SharingUser,
  db: Knex
): Promise<{ ok: true; canUpdate: boolean } | { ok: false; error: string }> {
  if (user.user_type && user.user_type !== 'internal') {
    return { ok: false, error: 'Permission denied: shared calendars are only available to MSP users.' };
  }
  const canRead = await hasPermission(user as any, 'user_schedule', 'read', db);
  if (!canRead) {
    return { ok: false, error: 'Permission denied to view schedules.' };
  }
  const canUpdate = await hasPermission(user as any, 'user_schedule', 'update', db);
  return { ok: true, canUpdate };
}

/**
 * Validate share inputs: allowed level, grantee exists, user grantees are
 * internal MSP users, no duplicate grantees. Returns an error message or null.
 */
async function validateShares(
  trx: Knex.Transaction,
  tenant: string,
  shares: ICalendarShareInput[],
  allowedLevels: CalendarAccessLevel[],
  ownerUserId: string | null
): Promise<string | null> {
  const seen = new Set<string>();
  for (const share of shares) {
    if (share.grantee_type !== 'user' && share.grantee_type !== 'team') {
      return 'Invalid share recipient.';
    }
    if (!allowedLevels.includes(share.access_level)) {
      return 'Invalid access level for this calendar.';
    }
    if (ownerUserId && share.grantee_type === 'user' && share.grantee_id === ownerUserId) {
      return 'You cannot share a calendar with its owner.';
    }
    const key = `${share.grantee_type}:${share.grantee_id}`;
    if (seen.has(key)) {
      return 'Each user or team can only be listed once.';
    }
    seen.add(key);
  }

  const db = tenantDb(trx, tenant);
  const userIds = shares.filter((s) => s.grantee_type === 'user').map((s) => s.grantee_id);
  if (userIds.length > 0) {
    const users = await db.table('users')
      .whereIn('user_id', userIds)
      .select('user_id', 'user_type');
    const internal = new Set(
      users.filter((u: { user_type: string }) => u.user_type === 'internal').map((u: { user_id: string }) => u.user_id)
    );
    if (userIds.some((id) => !internal.has(id))) {
      return 'Calendars can only be shared with MSP users.';
    }
  }

  const teamIds = shares.filter((s) => s.grantee_type === 'team').map((s) => s.grantee_id);
  if (teamIds.length > 0) {
    const teams = await db.table('teams').whereIn('team_id', teamIds).select('team_id');
    if (teams.length !== new Set(teamIds).size) {
      return 'One or more teams could not be found.';
    }
  }

  return null;
}

/** List shares on a calendar with grantee display names. */
async function loadShareViews(
  trx: Knex.Transaction,
  tenant: string,
  calendarId: string
): Promise<ICalendarShareView[]> {
  const db = tenantDb(trx, tenant);
  const shares = await db.table('calendar_shares')
    .where({ calendar_id: calendarId })
    .select('grantee_type', 'grantee_id', 'access_level')
    .orderBy('created_at', 'asc');

  const userIds = shares.filter((s: any) => s.grantee_type === 'user').map((s: any) => s.grantee_id);
  const teamIds = shares.filter((s: any) => s.grantee_type === 'team').map((s: any) => s.grantee_id);
  const [users, teams] = await Promise.all([
    userIds.length > 0
      ? db.table('users').whereIn('user_id', userIds).select('user_id', 'first_name', 'last_name', 'username')
      : Promise.resolve([]),
    teamIds.length > 0
      ? db.table('teams').whereIn('team_id', teamIds).select('team_id', 'team_name')
      : Promise.resolve([]),
  ]);
  const userNames = new Map<string, string>(users.map((u: any): [string, string] => [u.user_id, displayName(u)]));
  const teamNames = new Map<string, string>(teams.map((t: any): [string, string] => [t.team_id, t.team_name]));

  return shares.map((share: any) => ({
    grantee_type: share.grantee_type,
    grantee_id: share.grantee_id,
    access_level: share.access_level,
    grantee_name:
      (share.grantee_type === 'user' ? userNames.get(share.grantee_id) : teamNames.get(share.grantee_id)) ?? '',
  }));
}

/**
 * Replace the share list on a calendar: upsert every given share and delete
 * the rest. Returns user grantees that were newly added or changed level.
 */
async function replaceShares(
  trx: Knex.Transaction,
  tenant: string,
  calendarId: string,
  shares: ICalendarShareInput[],
  actorUserId: string
): Promise<ICalendarShareInput[]> {
  const db = tenantDb(trx, tenant);
  const existing: ICalendarShareInput[] = await db.table('calendar_shares')
    .where({ calendar_id: calendarId })
    .select('grantee_type', 'grantee_id', 'access_level');
  const existingByKey = new Map(existing.map((s) => [`${s.grantee_type}:${s.grantee_id}`, s]));
  const keep = new Set(shares.map((s) => `${s.grantee_type}:${s.grantee_id}`));

  const removed = existing.filter((s) => !keep.has(`${s.grantee_type}:${s.grantee_id}`));
  for (const share of removed) {
    await db.table('calendar_shares')
      .where({ calendar_id: calendarId, grantee_type: share.grantee_type, grantee_id: share.grantee_id })
      .del();
  }

  const changedUserGrants: ICalendarShareInput[] = [];
  const now = new Date();
  for (const share of shares) {
    const previous = existingByKey.get(`${share.grantee_type}:${share.grantee_id}`);
    if (previous && previous.access_level === share.access_level) continue;

    await db.table('calendar_shares')
      .insert({
        tenant,
        calendar_id: calendarId,
        grantee_type: share.grantee_type,
        grantee_id: share.grantee_id,
        access_level: share.access_level,
        created_by: actorUserId,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'calendar_id', 'grantee_type', 'grantee_id'])
      .merge({ access_level: share.access_level, updated_at: now });

    if (share.grantee_type === 'user') {
      changedUserGrants.push(share);
    }
  }

  return changedUserGrants;
}

async function getOrCreatePersonalCalendar(
  trx: Knex.Transaction,
  tenant: string,
  ownerUserId: string,
  actorUserId: string
): Promise<ICalendar> {
  const db = tenantDb(trx, tenant);
  const existing = await db.table('calendars')
    .where({ calendar_type: 'personal', owner_user_id: ownerUserId })
    .first();
  if (existing) return existing as ICalendar;

  // Personal calendars are created lazily; tolerate a concurrent first share.
  await trx.raw(
    `INSERT INTO calendars (tenant, calendar_type, owner_user_id, created_by)
     VALUES (?, 'personal', ?, ?)
     ON CONFLICT (tenant, owner_user_id) WHERE calendar_type = 'personal' DO NOTHING`,
    [tenant, ownerUserId, actorUserId]
  );

  return (await db.table('calendars')
    .where({ calendar_type: 'personal', owner_user_id: ownerUserId })
    .first()) as ICalendar;
}

async function publishShareGrants(
  tenant: string,
  calendar: Pick<ICalendar, 'calendar_id' | 'calendar_type' | 'owner_user_id' | 'name'>,
  grants: ICalendarShareInput[],
  actorUserId: string
): Promise<void> {
  for (const grant of grants) {
    try {
      await publishEvent({
        eventType: 'CALENDAR_SHARE_GRANTED',
        payload: {
          tenantId: tenant,
          calendarId: calendar.calendar_id,
          calendarType: calendar.calendar_type,
          ownerUserId: calendar.owner_user_id,
          calendarName: calendar.name,
          granteeType: grant.grantee_type,
          granteeId: grant.grantee_id,
          accessLevel: grant.access_level,
          grantedByUserId: actorUserId,
        },
      });
    } catch (error) {
      console.error('[calendarSharingActions] Failed to publish CALENDAR_SHARE_GRANTED', error);
    }
  }
}

/** Only the owner, or a user_schedule:update holder, may manage a personal calendar's shares. */
function resolvePersonalOwner(
  user: SharingUser,
  canUpdate: boolean,
  ownerUserId?: string
): { ok: true; ownerUserId: string } | { ok: false; error: string } {
  const owner = ownerUserId || user.user_id;
  if (owner !== user.user_id && !canUpdate) {
    return { ok: false, error: "Permission denied to manage another user's calendar sharing." };
  }
  return { ok: true, ownerUserId: owner };
}

export const getMyCalendarShares = withAuth(async (
  user,
  { tenant },
  ownerUserId?: string
): Promise<CalendarSharingResult<ICalendarShareView[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);
    const owner = resolvePersonalOwner(user, base.canUpdate, ownerUserId);
    if (!owner.ok) return fail(owner.error);

    const shares = await withTransaction(db, async (trx: Knex.Transaction) => {
      const calendar = await tenantDb(trx, tenant).table('calendars')
        .where({ calendar_type: 'personal', owner_user_id: owner.ownerUserId })
        .first('calendar_id');
      if (!calendar) return [];
      return loadShareViews(trx, tenant, calendar.calendar_id);
    });
    return { success: true, data: shares };
  } catch (error) {
    console.error('Error loading calendar shares:', error);
    return fail('Failed to load calendar sharing.');
  }
});

export const setMyCalendarShares = withAuth(async (
  user,
  { tenant },
  shares: ICalendarShareInput[],
  ownerUserId?: string
): Promise<CalendarSharingResult<ICalendarShareView[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);
    const owner = resolvePersonalOwner(user, base.canUpdate, ownerUserId);
    if (!owner.ok) return fail(owner.error);

    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const validationError = await validateShares(trx, tenant, shares, PERSONAL_ACCESS_LEVELS, owner.ownerUserId);
      if (validationError) return { error: validationError } as const;

      const calendar = await getOrCreatePersonalCalendar(trx, tenant, owner.ownerUserId, user.user_id);
      const grants = await replaceShares(trx, tenant, calendar.calendar_id, shares, user.user_id);
      const views = await loadShareViews(trx, tenant, calendar.calendar_id);
      return { calendar, grants, views } as const;
    });

    if ('error' in outcome) return fail(outcome.error as string);
    await publishShareGrants(tenant, outcome.calendar, outcome.grants, user.user_id);
    return { success: true, data: outcome.views };
  } catch (error) {
    console.error('Error saving calendar shares:', error);
    return fail('Failed to save calendar sharing.');
  }
});

/**
 * Calendars the current user can see, grouped for the schedule sidebar, plus
 * viewer capabilities. Replaces the client-side `user_schedule:read:all` check.
 */
export const getCalendarsVisibleToMe = withAuth(async (
  user,
  { tenant }
): Promise<CalendarSharingResult<IScheduleViewerCapabilities>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const capabilities = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scoped = tenantDb(trx, tenant);
      const access = await resolveCalendarAccess(trx, tenant, user, base.canUpdate);

      const peopleQuery = scoped.table('users')
        .where({ user_type: 'internal', is_inactive: false })
        .whereNot('user_id', user.user_id)
        .select('user_id', 'first_name', 'last_name', 'username')
        .orderBy([{ column: 'first_name' }, { column: 'last_name' }]);
      if (!access.canViewAll) {
        peopleQuery.whereIn('user_id', Array.from(access.userLevels.keys()));
      }
      const [selfRow, peopleRows, groupRows] = await Promise.all([
        scoped.table('users').where({ user_id: user.user_id }).first('first_name', 'last_name', 'username'),
        access.canViewAll || access.userLevels.size > 0 ? peopleQuery : Promise.resolve([]),
        access.groupLevels.size > 0
          ? scoped.table('calendars')
              .whereIn('calendar_id', Array.from(access.groupLevels.keys()))
              .select('calendar_id', 'name', 'description', 'color', 'is_archived')
              .orderBy('name', 'asc')
          : Promise.resolve([]),
      ]);

      const me: IVisibleCalendar = {
        key: user.user_id,
        calendar_type: 'personal',
        calendar_id: null,
        owner_user_id: user.user_id,
        name: selfRow ? displayName(selfRow) : '',
        color: personalCalendarColor(user.user_id),
        access_level: 'edit',
      };

      const people: IVisibleCalendar[] = peopleRows.map((row: any): IVisibleCalendar => ({
        key: row.user_id,
        calendar_type: 'personal',
        calendar_id: null,
        owner_user_id: row.user_id,
        name: displayName(row),
        color: personalCalendarColor(row.user_id),
        access_level: access.canViewAll ? 'edit' : access.userLevels.get(row.user_id)!,
      }));

      const groups: IVisibleCalendar[] = groupRows.map((row: any): IVisibleCalendar => ({
        key: row.calendar_id,
        calendar_type: 'group',
        calendar_id: row.calendar_id,
        owner_user_id: null,
        name: row.name,
        description: row.description,
        color: row.color || DEFAULT_GROUP_CALENDAR_COLOR,
        access_level: access.groupLevels.get(row.calendar_id)!.level,
        is_archived: !!row.is_archived,
      }));

      return {
        viewerUserId: user.user_id,
        canViewAll: access.canViewAll,
        me,
        people,
        groups,
      } satisfies IScheduleViewerCapabilities;
    });

    return { success: true, data: capabilities };
  } catch (error) {
    console.error('Error loading visible calendars:', error);
    return fail('Failed to load calendars.');
  }
});

interface GroupCalendarInput {
  name: string;
  color?: string | null;
  description?: string | null;
}

function normalizeGroupInput(input: GroupCalendarInput): { name: string; color: string; description: string | null } | null {
  const name = (input.name ?? '').trim();
  if (!name) return null;
  return {
    name,
    color: input.color || DEFAULT_GROUP_CALENDAR_COLOR,
    description: input.description?.trim() || null,
  };
}

/** Load a group calendar and check the viewer may manage it (manage share or user_schedule:update). */
async function loadManagedGroupCalendar(
  trx: Knex.Transaction,
  tenant: string,
  user: SharingUser,
  canUpdate: boolean,
  calendarId: string
): Promise<{ calendar: ICalendar } | { error: string }> {
  const calendar = await tenantDb(trx, tenant).table('calendars')
    .where({ calendar_id: calendarId, calendar_type: 'group' })
    .first();
  if (!calendar) return { error: 'Calendar not found.' };
  if (canUpdate) return { calendar };

  const access = await resolveCalendarAccess(trx, tenant, user, false);
  if (access.groupLevels.get(calendarId)?.level !== 'manage') {
    return { error: 'Permission denied to manage this calendar.' };
  }
  return { calendar };
}

export const createGroupCalendar = withAuth(async (
  user,
  { tenant },
  input: GroupCalendarInput & { members?: ICalendarShareInput[] }
): Promise<CalendarSharingResult<IVisibleCalendar>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const fields = normalizeGroupInput(input);
    if (!fields) return fail('Calendar name is required.');

    // The creator always manages the calendar they create.
    const members = (input.members ?? []).filter(
      (m) => !(m.grantee_type === 'user' && m.grantee_id === user.user_id)
    );
    members.push({ grantee_type: 'user', grantee_id: user.user_id, access_level: 'manage' });

    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const validationError = await validateShares(trx, tenant, members, GROUP_ACCESS_LEVELS, null);
      if (validationError) return { error: validationError } as const;

      const [calendar] = await tenantDb(trx, tenant).table('calendars')
        .insert({
          tenant,
          calendar_type: 'group',
          name: fields.name,
          color: fields.color,
          description: fields.description,
          created_by: user.user_id,
        })
        .returning('*');
      const grants = await replaceShares(trx, tenant, calendar.calendar_id, members, user.user_id);
      return { calendar: calendar as ICalendar, grants } as const;
    });

    if ('error' in outcome) return fail(outcome.error as string);
    await publishShareGrants(
      tenant,
      outcome.calendar,
      outcome.grants.filter((g) => g.grantee_id !== user.user_id),
      user.user_id
    );
    const calendar = outcome.calendar;
    return {
      success: true,
      data: {
        key: calendar.calendar_id,
        calendar_type: 'group',
        calendar_id: calendar.calendar_id,
        owner_user_id: null,
        name: calendar.name ?? fields.name,
        description: calendar.description,
        color: calendar.color ?? fields.color,
        access_level: 'manage',
        is_archived: false,
      },
    };
  } catch (error) {
    console.error('Error creating group calendar:', error);
    return fail('Failed to create calendar.');
  }
});

export const updateGroupCalendar = withAuth(async (
  user,
  { tenant },
  calendarId: string,
  input: GroupCalendarInput
): Promise<CalendarSharingResult<null>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);
    const fields = normalizeGroupInput(input);
    if (!fields) return fail('Calendar name is required.');

    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const loaded = await loadManagedGroupCalendar(trx, tenant, user, base.canUpdate, calendarId);
      if ('error' in loaded) return loaded;
      await tenantDb(trx, tenant).table('calendars')
        .where({ calendar_id: calendarId })
        .update({ ...fields, updated_at: new Date() });
      return {};
    });
    if ('error' in outcome) return fail(outcome.error as string);
    return { success: true, data: null };
  } catch (error) {
    console.error('Error updating group calendar:', error);
    return fail('Failed to update calendar.');
  }
});

export const getGroupCalendarShares = withAuth(async (
  user,
  { tenant },
  calendarId: string
): Promise<CalendarSharingResult<ICalendarShareView[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const loaded = await loadManagedGroupCalendar(trx, tenant, user, base.canUpdate, calendarId);
      if ('error' in loaded) return loaded;
      return { shares: await loadShareViews(trx, tenant, calendarId) };
    });
    if ('error' in outcome) return fail(outcome.error as string);
    return { success: true, data: outcome.shares };
  } catch (error) {
    console.error('Error loading group calendar members:', error);
    return fail('Failed to load calendar members.');
  }
});

export const setGroupCalendarShares = withAuth(async (
  user,
  { tenant },
  calendarId: string,
  shares: ICalendarShareInput[]
): Promise<CalendarSharingResult<ICalendarShareView[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
      const loaded = await loadManagedGroupCalendar(trx, tenant, user, base.canUpdate, calendarId);
      if ('error' in loaded) return loaded;

      const validationError = await validateShares(trx, tenant, shares, GROUP_ACCESS_LEVELS, null);
      if (validationError) return { error: validationError };
      if (!loaded.calendar.is_archived && !shares.some((s) => s.access_level === 'manage')) {
        return { error: 'A calendar needs at least one member who can manage it.' };
      }

      const grants = await replaceShares(trx, tenant, calendarId, shares, user.user_id);
      const views = await loadShareViews(trx, tenant, calendarId);
      return { calendar: loaded.calendar, grants, views };
    });

    if ('error' in outcome) return fail(outcome.error as string);
    await publishShareGrants(tenant, outcome.calendar, outcome.grants, user.user_id);
    return { success: true, data: outcome.views };
  } catch (error) {
    console.error('Error saving group calendar members:', error);
    return fail('Failed to save calendar members.');
  }
});

async function setGroupCalendarArchived(
  user: SharingUser,
  tenant: string,
  calendarId: string,
  isArchived: boolean
): Promise<CalendarSharingResult<null>> {
  const { knex: db } = await createTenantKnex();
  const base = await checkBaseAccess(user, db);
  if (!base.ok) return fail(base.error);

  const outcome = await withTransaction(db, async (trx: Knex.Transaction) => {
    const loaded = await loadManagedGroupCalendar(trx, tenant, user, base.canUpdate, calendarId);
    if ('error' in loaded) return loaded;
    await tenantDb(trx, tenant).table('calendars')
      .where({ calendar_id: calendarId })
      .update({ is_archived: isArchived, updated_at: new Date() });
    return {};
  });
  if ('error' in outcome) return fail(outcome.error as string);
  return { success: true, data: null };
}

export const archiveGroupCalendar = withAuth(async (
  user,
  { tenant },
  calendarId: string
): Promise<CalendarSharingResult<null>> => {
  try {
    return await setGroupCalendarArchived(user, tenant, calendarId, true);
  } catch (error) {
    console.error('Error archiving group calendar:', error);
    return fail('Failed to archive calendar.');
  }
});

export const restoreGroupCalendar = withAuth(async (
  user,
  { tenant },
  calendarId: string
): Promise<CalendarSharingResult<null>> => {
  try {
    return await setGroupCalendarArchived(user, tenant, calendarId, false);
  } catch (error) {
    console.error('Error restoring group calendar:', error);
    return fail('Failed to restore calendar.');
  }
});

/**
 * Active internal users that can receive a calendar share. Gated by
 * `user_schedule:read`, not `user:read`: a Technician can pick colleagues to
 * share with without holding the broader user-read permission.
 */
export const getShareableUsers = withAuth(async (
  user,
  { tenant }
): Promise<CalendarSharingResult<IUser[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const users = await withTransaction(db, async (trx: Knex.Transaction) => {
      return tenantDb(trx, tenant).table('users')
        .where({ user_type: 'internal', is_inactive: false })
        .select('user_id', 'first_name', 'last_name', 'email', 'user_type', 'is_inactive')
        .orderBy([{ column: 'first_name' }, { column: 'last_name' }]);
    });
    return { success: true, data: users as IUser[] };
  } catch (error) {
    console.error('Error loading users for sharing:', error);
    return fail('Failed to load users.');
  }
});

/** Teams that can receive a calendar share (for the share pickers). */
export const getShareableTeams = withAuth(async (
  user,
  { tenant }
): Promise<CalendarSharingResult<ITeam[]>> => {
  try {
    const { knex: db } = await createTenantKnex();
    const base = await checkBaseAccess(user, db);
    if (!base.ok) return fail(base.error);

    const teams = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scoped = tenantDb(trx, tenant);
      const [teamRows, memberRows] = await Promise.all([
        scoped.table('teams').select('team_id', 'team_name', 'manager_id').orderBy('team_name', 'asc'),
        scoped.table('team_members').select('team_id', 'user_id', 'role'),
      ]);
      const typedMemberRows = memberRows as Array<{ team_id: string; user_id: string; role: string | null }>;
      const memberUserIds = Array.from(new Set(typedMemberRows.map((row) => row.user_id)));
      // Join names server-side under the same user_schedule:read gate so the
      // picker can show the team lead without the caller holding user:read.
      const memberUserRows = memberUserIds.length > 0
        ? await scoped.table('users')
            .whereIn('user_id', memberUserIds)
            .select('user_id', 'first_name', 'last_name')
        : [];
      const namesById = new Map(
        (memberUserRows as Array<{ user_id: string; first_name: string | null; last_name: string | null }>)
          .map((row) => [row.user_id, row])
      );

      const membersByTeam = new Map<string, ITeam['members']>();
      for (const row of typedMemberRows) {
        const names = namesById.get(row.user_id);
        const members = membersByTeam.get(row.team_id) ?? [];
        members.push({
          user_id: row.user_id,
          first_name: names?.first_name ?? '',
          last_name: names?.last_name ?? '',
          role: row.role === 'lead' ? 'lead' : 'member',
        } as ITeam['members'][number]);
        membersByTeam.set(row.team_id, members);
      }
      return (teamRows as Array<{ team_id: string; team_name: string; manager_id: string | null }>).map(
        (team): ITeam => ({
          tenant,
          team_id: team.team_id,
          team_name: team.team_name,
          manager_id: team.manager_id,
          members: membersByTeam.get(team.team_id) ?? [],
        })
      );
    });
    return { success: true, data: teams };
  } catch (error) {
    console.error('Error loading teams for sharing:', error);
    return fail('Failed to load teams.');
  }
});
