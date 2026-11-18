import { Activity, ActivityType, ScheduleActivity } from '@alga-psa/types';

/**
 * Keep only the first occurrence of each recurring schedule series (identified by title,
 * work item id and work item type). Non-recurring and non-schedule activities pass through
 * untouched, and input order is preserved.
 */
export function collapseRecurringSeries(activities: Activity[]): Activity[] {
  const result: Activity[] = [];
  const seenSeries = new Set<string>();

  for (const activity of activities) {
    if (activity.type === ActivityType.SCHEDULE) {
      const scheduleActivity = activity as ScheduleActivity;
      if (scheduleActivity.isRecurring) {
        const seriesIdentifier = `${scheduleActivity.title}-${scheduleActivity.workItemId || 'no-item'}-${scheduleActivity.workItemType || 'no-type'}`;
        if (seenSeries.has(seriesIdentifier)) continue;
        seenSeries.add(seriesIdentifier);
      }
    }
    result.push(activity);
  }

  return result;
}
