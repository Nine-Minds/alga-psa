import { ActivityType } from '@alga-psa/types';

/**
 * Default activity types shown in the table/list view.
 * Excludes TIME_ENTRY and NOTIFICATION which are noise for daily task work.
 */
export const DEFAULT_TABLE_TYPES: ActivityType[] = [
  ActivityType.SCHEDULE,
  ActivityType.PROJECT_TASK,
  ActivityType.TICKET,
  ActivityType.WORKFLOW_TASK,
];

/**
 * Left-edge accent color per activity type (matches the type-icon colors). Shared by
 * the flat table and grouped list so both views use the same colored indicator.
 */
export function getActivityTypeColor(type: ActivityType): string {
  switch (type) {
    case ActivityType.SCHEDULE:
      return '#22c55e'; // green (matches schedule icon "text-success")
    case ActivityType.PROJECT_TASK:
      return 'rgb(var(--color-secondary-500))';
    case ActivityType.TICKET:
      return 'rgb(var(--color-primary-500))';
    case ActivityType.TIME_ENTRY:
      return '#f97316'; // orange-500
    case ActivityType.WORKFLOW_TASK:
      return '#ef4444'; // red (destructive)
    case ActivityType.NOTIFICATION:
      return '#6366f1'; // indigo-500
    default:
      return 'rgb(var(--color-border-300))';
  }
}
