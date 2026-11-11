import type { Knex } from 'knex';
import type { IScheduleEntry } from '@alga-psa/types';
import {
  unreadableScheduleEntryIds,
  type ScheduleEntryReadScope,
} from '@alga-psa/authorization/scheduleEntryReadAuthorization';
import { maskEntry, type CalendarAccess } from './calendarAccess';

/**
 * The one place a schedule entry is reduced to busy time because the viewer may not read its work item.
 *
 * Every schedule and dispatch read (`getScheduleEntries`, `getScheduleEntryById`, native or delegated) passes its
 * entries through here after the visibility decision. An entry the viewer cannot read stays on the calendar as the
 * same busy block the calendar-sharing busy level produces (`maskEntry`): times, status and the assignees the
 * viewer can see are kept; title, notes, work item type and id, and recurrence are removed.
 *
 * The decision is made on the work item STORED for the entry, never on the view the caller holds (a delegated or
 * already-projected view may carry no work item). A viewer whose policy does not restrict schedule entries costs
 * no query and gets the entries back unchanged.
 */
export async function maskEntriesOutsideReadScope(
  trx: Knex | Knex.Transaction,
  scope: ScheduleEntryReadScope,
  entries: IScheduleEntry[],
  access: CalendarAccess
): Promise<IScheduleEntry[]> {
  if (!scope.restricted) return entries;

  // Already-busy entries carry no work item. A virtual recurrence occurrence is decided by its master row.
  const sourceIdOf = (entry: IScheduleEntry) => entry.original_entry_id ?? entry.entry_id;
  const unreadable = await unreadableScheduleEntryIds(
    trx,
    scope,
    entries.filter((entry) => entry.access !== 'busy').map(sourceIdOf)
  );
  if (unreadable.size === 0) return entries;

  return entries.map((entry) =>
    entry.access !== 'busy' && unreadable.has(sourceIdOf(entry)) ? maskEntry(entry, access) : entry
  );
}

/**
 * The CalendarAccess `maskEntry` needs for entries a delegated reader (co-managed) already admitted for this
 * viewer. That reader decided which entries and assignees the viewer may see, so nothing is narrowed further:
 * every assignee in the delegated view is kept.
 */
export function delegatedViewAccess(viewerUserId: string): CalendarAccess {
  return { viewerUserId, canViewAll: true, userLevels: new Map(), groupLevels: new Map(), hiddenCalendarIds: [] };
}
