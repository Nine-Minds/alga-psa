/**
 * Shared-calendar access resolver.
 *
 * One place decides what a viewer may see and change on the schedule. The
 * schedule page, entry lookups and the REST schedules API all go through it.
 * See ee/docs/plans/2026-09-22-shared-calendars/PRD.md ("Visibility of an
 * entry for a viewer" and "Modify, move and delete").
 *
 * Resolution costs a constant number of queries per request (viewer teams,
 * shares held by the viewer, group calendars) — never one per entry.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CalendarAccessLevel, IScheduleEntry } from '@alga-psa/types';
import type { ScheduleEntryVisibilityFilter } from '@alga-psa/shared/models/scheduleEntry';

const LEVEL_RANK: Record<CalendarAccessLevel, number> = {
  free_busy: 1,
  read: 2,
  edit: 3,
  manage: 4,
};

export const PERSONAL_ACCESS_LEVELS: CalendarAccessLevel[] = ['free_busy', 'read', 'edit'];
export const GROUP_ACCESS_LEVELS: CalendarAccessLevel[] = ['free_busy', 'read', 'edit', 'manage'];

export function isCalendarAccessLevel(value: unknown): value is CalendarAccessLevel {
  return typeof value === 'string' && value in LEVEL_RANK;
}

export function levelAtLeast(
  level: CalendarAccessLevel | undefined | null,
  minimum: CalendarAccessLevel
): boolean {
  return !!level && LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

export function maxLevel(
  a: CalendarAccessLevel | undefined,
  b: CalendarAccessLevel | undefined
): CalendarAccessLevel | undefined {
  if (!a) return b;
  if (!b) return a;
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export interface GroupCalendarAccess {
  calendarId: string;
  level: CalendarAccessLevel;
  isArchived: boolean;
}

export interface CalendarAccess {
  viewerUserId: string;
  /** `user_schedule:update` holder: edit on every personal calendar, manage on every group calendar. */
  canViewAll: boolean;
  /** Effective level on other users' personal calendars (viewer excluded). Empty when canViewAll. */
  userLevels: Map<string, CalendarAccessLevel>;
  /** Effective level on group calendars the viewer can see (archived ones only when the viewer manages them). */
  groupLevels: Map<string, GroupCalendarAccess>;
  /** Archived group calendars the viewer does not manage: their entries are hidden. */
  hiddenCalendarIds: string[];
}

export type EntryAccessKind = 'full' | 'busy' | 'none';

export interface EntryAccessDecision {
  access: EntryAccessKind;
  canEdit: boolean;
}

interface ViewerRef {
  user_id: string;
}

/**
 * Resolve every calendar the viewer can see, with the effective (highest)
 * level across direct and team grants. Team membership is read at call time,
 * so team changes apply without extra writes. Shares on personal calendars of
 * inactive owners are ignored.
 */
export async function resolveCalendarAccess(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  viewer: ViewerRef,
  canViewAll: boolean
): Promise<CalendarAccess> {
  const db = tenantDb(knexOrTrx, tenant);
  const userLevels = new Map<string, CalendarAccessLevel>();
  const groupLevels = new Map<string, GroupCalendarAccess>();

  const groupCalendars: Array<{ calendar_id: string; is_archived: boolean }> = await db
    .table('calendars')
    .where('calendar_type', 'group')
    .select('calendar_id', 'is_archived');

  if (canViewAll) {
    for (const calendar of groupCalendars) {
      groupLevels.set(calendar.calendar_id, {
        calendarId: calendar.calendar_id,
        level: 'manage',
        isArchived: !!calendar.is_archived,
      });
    }
    return {
      viewerUserId: viewer.user_id,
      canViewAll: true,
      userLevels,
      groupLevels,
      hiddenCalendarIds: [],
    };
  }

  const teamIds = await getViewerTeamIds(knexOrTrx, tenant, viewer.user_id);

  const sharesQuery = db
    .table('calendar_shares')
    .where(function () {
      this.where(function () {
        this.where('calendar_shares.grantee_type', 'user')
          .where('calendar_shares.grantee_id', viewer.user_id);
      });
      if (teamIds.length > 0) {
        this.orWhere(function () {
          this.where('calendar_shares.grantee_type', 'team')
            .whereIn('calendar_shares.grantee_id', teamIds);
        });
      }
    });
  db.tenantJoin(sharesQuery, 'calendars', 'calendar_shares.calendar_id', 'calendars.calendar_id');
  db.tenantJoin(sharesQuery, 'users as owner', 'calendars.owner_user_id', 'owner.user_id', { type: 'left' });
  const shares: Array<{
    calendar_id: string;
    calendar_type: 'personal' | 'group';
    owner_user_id: string | null;
    owner_is_inactive: boolean | null;
    owner_user_type: string | null;
    is_archived: boolean;
    access_level: CalendarAccessLevel;
  }> = await sharesQuery.select(
    'calendars.calendar_id',
    'calendars.calendar_type',
    'calendars.owner_user_id',
    'calendars.is_archived',
    'calendar_shares.access_level',
    { owner_is_inactive: 'owner.is_inactive', owner_user_type: 'owner.user_type' }
  );

  for (const share of shares) {
    if (!isCalendarAccessLevel(share.access_level)) continue;

    if (share.calendar_type === 'personal') {
      if (!share.owner_user_id || share.owner_user_id === viewer.user_id) continue;
      if (share.owner_is_inactive || share.owner_user_type !== 'internal') continue;
      // `manage` is not a personal level; clamp defensively.
      const level: CalendarAccessLevel = share.access_level === 'manage' ? 'edit' : share.access_level;
      userLevels.set(share.owner_user_id, maxLevel(userLevels.get(share.owner_user_id), level)!);
      continue;
    }

    const existing = groupLevels.get(share.calendar_id);
    groupLevels.set(share.calendar_id, {
      calendarId: share.calendar_id,
      level: maxLevel(existing?.level, share.access_level)!,
      isArchived: !!share.is_archived,
    });
  }

  // Archived calendars are visible to their managers only.
  for (const [calendarId, grant] of groupLevels) {
    if (grant.isArchived && grant.level !== 'manage') {
      groupLevels.delete(calendarId);
    }
  }

  const hiddenCalendarIds = groupCalendars
    .filter((calendar) => calendar.is_archived && !groupLevels.has(calendar.calendar_id))
    .map((calendar) => calendar.calendar_id);

  return {
    viewerUserId: viewer.user_id,
    canViewAll: false,
    userLevels,
    groupLevels,
    hiddenCalendarIds,
  };
}

/** Teams the user belongs to, as a member or as the team manager. */
export async function getViewerTeamIds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string[]> {
  const db = tenantDb(knexOrTrx, tenant);
  const [memberRows, managedRows] = await Promise.all([
    db.table('team_members').where('user_id', userId).select('team_id'),
    db.table('teams').where('manager_id', userId).select('team_id'),
  ]);
  return Array.from(
    new Set([...memberRows, ...managedRows].map((row: { team_id: string }) => row.team_id))
  );
}

/**
 * SQL filter matching every entry the viewer could possibly see. Applied before
 * recurrence expansion; `evaluateEntryAccess` then decides full/busy per entry.
 * Returns undefined for canViewAll viewers (no narrowing), which keeps today's
 * admin behaviour.
 */
export function buildVisibilityFilter(
  access: CalendarAccess
): ScheduleEntryVisibilityFilter | undefined {
  if (access.canViewAll) return undefined;
  return {
    userIds: [access.viewerUserId, ...access.userLevels.keys()],
    calendarIds: Array.from(access.groupLevels.keys()),
    includeUnassignedAppointmentRequests: false,
    excludeCalendarIds: access.hiddenCalendarIds,
  };
}

/** Effective level on the personal calendars of an entry's assignees (viewer excluded). */
export function personalLevelFor(
  assigneeIds: string[],
  access: CalendarAccess
): CalendarAccessLevel | undefined {
  let best: CalendarAccessLevel | undefined;
  for (const assigneeId of assigneeIds) {
    if (assigneeId === access.viewerUserId) continue;
    const level = access.canViewAll ? 'edit' : access.userLevels.get(assigneeId);
    best = maxLevel(best, level);
  }
  return best;
}

export function groupLevelFor(
  calendarId: string | null | undefined,
  access: CalendarAccess
): CalendarAccessLevel | undefined {
  if (!calendarId) return undefined;
  return access.groupLevels.get(calendarId)?.level;
}

/** Whether the viewer may set this user as an assignee (self, admin, or edit on their calendar). */
export function canAssignUser(userId: string, access: CalendarAccess): boolean {
  return (
    userId === access.viewerUserId ||
    access.canViewAll ||
    levelAtLeast(access.userLevels.get(userId), 'edit')
  );
}

/**
 * Decide what the viewer sees of an entry and whether they may change it,
 * following the ordered PRD rules.
 */
export function evaluateEntryAccess(
  entry: Pick<IScheduleEntry, 'assigned_user_ids' | 'is_private' | 'calendar_id' | 'work_item_type'>,
  access: CalendarAccess
): EntryAccessDecision {
  const assignees = entry.assigned_user_ids ?? [];
  const isAssignee = assignees.includes(access.viewerUserId);
  const isSoleAssignee = assignees.length === 1 && isAssignee;
  const isPrivate = !!entry.is_private && !entry.calendar_id;

  if (entry.calendar_id && access.hiddenCalendarIds.includes(entry.calendar_id)) {
    return { access: 'none', canEdit: false };
  }

  const groupLevel = groupLevelFor(entry.calendar_id, access);
  const personalLevel = personalLevelFor(assignees, access);

  let visibility: EntryAccessKind = 'none';
  if (isAssignee) {
    visibility = 'full';
  } else if (levelAtLeast(groupLevel, 'read')) {
    visibility = 'full';
  } else if (levelAtLeast(personalLevel, 'read')) {
    visibility = isPrivate ? 'busy' : 'full';
  } else if (groupLevel === 'free_busy' || personalLevel === 'free_busy') {
    visibility = 'busy';
  } else if (access.canViewAll) {
    // Unassigned entries (e.g. pending appointment requests) stay visible to admins.
    visibility = isPrivate ? 'busy' : 'full';
  }

  if (visibility === 'none') {
    return { access: 'none', canEdit: false };
  }

  let canEdit: boolean;
  if (isPrivate) {
    // Private entries can only be changed by their sole assignee.
    canEdit = isSoleAssignee;
  } else {
    canEdit =
      isSoleAssignee ||
      access.canViewAll ||
      levelAtLeast(personalLevel, 'edit') ||
      levelAtLeast(groupLevel, 'edit');
  }

  return { access: visibility, canEdit };
}

/**
 * Strip everything but timing from an entry the viewer may only see as Busy.
 * Assignees are narrowed to calendars the viewer can see so the block still
 * lands on the right overlay. The client renders the translated "Busy" label.
 */
export function maskEntry(entry: IScheduleEntry, access: CalendarAccess): IScheduleEntry {
  const visibleAssignees = (entry.assigned_user_ids ?? []).filter(
    (userId) => userId === access.viewerUserId || access.canViewAll || access.userLevels.has(userId)
  );
  return {
    ...entry,
    title: 'Busy',
    notes: '',
    work_item_id: null,
    work_item_type: 'ad_hoc',
    recurrence_pattern: null,
    assigned_user_ids: visibleAssignees,
    access: 'busy',
    can_edit: false,
  };
}

/**
 * Apply evaluate + mask to a list, dropping entries the viewer may not see and
 * annotating the rest with `access` / `can_edit`.
 */
export function applyEntryAccess(entries: IScheduleEntry[], access: CalendarAccess): IScheduleEntry[] {
  const result: IScheduleEntry[] = [];
  for (const entry of entries) {
    const decision = evaluateEntryAccess(entry, access);
    if (decision.access === 'none') continue;
    if (decision.access === 'busy') {
      result.push(maskEntry(entry, access));
    } else {
      result.push({ ...entry, access: 'full', can_edit: decision.canEdit });
    }
  }
  return result;
}

export { personalCalendarColor } from './calendarColors';
