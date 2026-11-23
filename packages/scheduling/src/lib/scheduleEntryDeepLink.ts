/**
 * Pure resolution of `/msp/schedule?entryId=…[&occurrence=…]` against an entry the schedule read
 * actions returned: which entry the dialog should open and which date the calendar should move to.
 * Kept free of React so the URL handling is unit-testable.
 */
import type { IScheduleEntry } from '@alga-psa/types';

export interface ScheduleDeepLinkTarget {
  /** The entry for the dialog; a virtual occurrence when the link names one of a series. */
  entry: IScheduleEntry;
  /** Date the calendar should show. */
  date: Date;
}

/** Virtual occurrence ids are `${masterId}_${epochMs}`; entry ids are UUIDs, which never contain `_`. */
export function parseVirtualEntryId(entryId: string): { masterId: string; occurrence: Date } | null {
  const at = entryId.indexOf('_');
  if (at <= 0) return null;
  const epoch = Number(entryId.slice(at + 1));
  if (!Number.isFinite(epoch)) return null;
  const occurrence = new Date(epoch);
  return Number.isNaN(occurrence.getTime()) ? null : { masterId: entryId.slice(0, at), occurrence };
}

/** The id to fetch for a deep link: the master for a virtual id, since only stored rows are readable by id. */
export function deepLinkFetchId(entryId: string): string {
  return parseVirtualEntryId(entryId)?.masterId ?? entryId;
}

/**
 * `entry` is what `getScheduleEntryById` returned for `deepLinkFetchId(entryId)`. For a recurring
 * master plus an occurrence (from `&occurrence=` or a virtual `entryId`), the entry is materialized
 * the way the schedule view builds its virtual occurrences (same id format, same duration, same
 * `original_entry_id`), so the dialog edits and deletes that occurrence rather than the series.
 * Anything else opens the stored entry as is; an `occurrence` on a non-recurring entry is ignored.
 */
export function resolveScheduleDeepLinkTarget(
  entry: IScheduleEntry,
  link: { entryId: string; occurrence?: Date },
): ScheduleDeepLinkTarget {
  const virtual = parseVirtualEntryId(link.entryId);
  const occurrence = link.occurrence ?? virtual?.occurrence;
  const start = new Date(entry.scheduled_start);

  if (entry.is_recurring && !entry.original_entry_id && occurrence && !Number.isNaN(occurrence.getTime())) {
    const duration = new Date(entry.scheduled_end).getTime() - start.getTime();
    return {
      entry: {
        ...entry,
        entry_id: `${entry.entry_id}_${occurrence.getTime()}`,
        scheduled_start: occurrence,
        scheduled_end: new Date(occurrence.getTime() + duration),
        is_recurring: true,
        original_entry_id: entry.entry_id,
      },
      date: occurrence,
    };
  }
  return { entry, date: start };
}
