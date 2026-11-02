/**
 * Calendars a viewer can see, with their effective access level.
 *
 * Shared by the getCalendarsVisibleToMe server action and the REST
 * GET /api/v1/calendars endpoint so both resolve visibility identically
 * (resolveCalendarAccess is the single source of truth).
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IScheduleViewerCapabilities, IVisibleCalendar } from '@alga-psa/types';
import { personalCalendarColor, resolveCalendarAccess } from './calendarAccess';

export const DEFAULT_GROUP_CALENDAR_COLOR = '#6366f1';

export function displayName(row: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.username || '';
}

export async function loadVisibleCalendars(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: { user_id: string },
  canViewAll: boolean
): Promise<IScheduleViewerCapabilities> {
  const scoped = tenantDb(trx, tenant);
  const access = await resolveCalendarAccess(trx, tenant, user, canViewAll);

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
  };
}
