import type { TimeSheetReadScope } from './timeSource';

/** A provider's untrusted, unpaged time-sheet collection row. */
export interface TimeSheetReadCollectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant: string;
  readonly user_id: string;
  readonly time_entries: readonly Record<string, unknown>[];
  readonly comments: readonly Record<string, unknown>[];
}

export type TimeSheetReadCollection =
  | Iterable<TimeSheetReadCollectionRow>
  | AsyncIterable<TimeSheetReadCollectionRow>;

/**
 * The only path from a registered source's raw collection to a service read.
 * This adapter owns authorization: it validates row identity and fixes tenant
 * and subject scope before callers can filter, count, page, or aggregate.
 */
export async function collectScopedTimeSheetRows(
  collection: TimeSheetReadCollection,
  scope: TimeSheetReadScope,
): Promise<TimeSheetReadCollectionRow[]> {
  if (!collection || (typeof (collection as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function' &&
      typeof (collection as Iterable<unknown>)[Symbol.iterator] !== 'function')) {
    throw new Error('Registered time source must return an unpaged time-sheet read collection');
  }

  const rows: TimeSheetReadCollectionRow[] = [];
  for await (const candidate of collection as AsyncIterable<unknown>) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Registered time source returned a malformed time-sheet collection row');
    }
    const row = candidate as Partial<TimeSheetReadCollectionRow>;
    if (typeof row.id !== 'string' || typeof row.tenant !== 'string' || typeof row.user_id !== 'string') {
      throw new Error('Registered time source rows must include id, tenant, and user_id');
    }
    if (row.tenant !== scope.tenant) continue;
    if (scope.subjectUserIds !== null && !scope.subjectUserIds.includes(row.user_id)) continue;
    const scopedRow = { ...row } as TimeSheetReadCollectionRow;
    for (const childKey of ['time_entries', 'entries', 'comments'] as const) {
      const children = (row as Record<string, unknown>)[childKey];
      if (childKey === 'entries' && children === undefined) continue;
      if (!Array.isArray(children)) {
        throw new Error(`Registered time source row '${row.id}' must include a ${childKey} collection`);
      }
      const validChildren = children.map((child) => {
        if (!child || typeof child !== 'object' || Array.isArray(child)) {
          throw new Error(`Registered time source row '${row.id}' has a malformed ${childKey} record`);
        }
        const nested = child as Record<string, unknown>;
        if (typeof nested.tenant !== 'string' || typeof nested.time_sheet_id !== 'string') {
          throw new Error(`Registered time source ${childKey} records must include tenant and time_sheet_id`);
        }
        return nested;
      });
      (scopedRow as Record<string, unknown>)[childKey] = validChildren.filter(
        (nested) => nested.tenant === scope.tenant && nested.time_sheet_id === row.id,
      );
    }
    const summary = summarizeTimeSheetEntries(scopedRow.time_entries);
    scopedRow.summary = summary;
    scopedRow.total_hours = summary.total_hours;
    scopedRow.billable_hours = summary.billable_hours;
    scopedRow.entry_count = scopedRow.time_entries.length;
    rows.push(scopedRow);
  }
  return rows;
}

/** Derive aggregates only after the sheet and all nested rows have been scoped. */
export function summarizeTimeSheetEntries(entries: readonly Record<string, unknown>[]) {
  let workedMinutes = 0;
  let billableMinutes = 0;
  const entriesByType: Record<string, number> = {};
  const entriesByDay: Record<string, number> = {};

  for (const entry of entries) {
    const start = entry.start_time == null ? NaN : new Date(String(entry.start_time)).getTime();
    const end = entry.end_time == null ? NaN : new Date(String(entry.end_time)).getTime();
    const worked = Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, (end - start) / 60_000)
      : Number(entry.worked_minutes ?? entry.duration_minutes ?? entry.duration ?? 0);
    const billable = Math.min(Math.max(Number(entry.billable_minutes ?? entry.billable_duration ?? 0), 0), worked);
    workedMinutes += worked;
    billableMinutes += billable;
    const type = String(entry.work_item_type ?? 'unknown');
    const day = String(entry.work_date ?? 'unknown').slice(0, 10);
    entriesByType[type] = (entriesByType[type] ?? 0) + worked / 60;
    entriesByDay[day] = (entriesByDay[day] ?? 0) + worked / 60;
  }

  const totalHours = workedMinutes / 60;
  const billableHours = billableMinutes / 60;
  return {
    total_hours: totalHours,
    billable_hours: billableHours,
    non_billable_hours: totalHours - billableHours,
    entries_by_type: entriesByType,
    entries_by_day: entriesByDay,
    approval_ready: entries.length > 0,
  };
}
