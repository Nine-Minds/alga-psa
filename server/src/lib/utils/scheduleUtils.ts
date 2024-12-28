import { IScheduleEntry } from '@/interfaces/schedule.interfaces';

export function differentiateRecurringEntries(entries: IScheduleEntry[]): IScheduleEntry[] {
  return entries.map((entry: IScheduleEntry, index): IScheduleEntry => {
    if (entry.is_recurring) {
      return {
        ...entry,
        entry_id: `${entry.original_entry_id || entry.entry_id}_${index}`,
      };
    }
    return entry;
  });
}