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
