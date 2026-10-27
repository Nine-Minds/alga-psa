/**
 * Extension point for maintenance fan-out schedule rows. Empty in the native build;
 * an extension package contributes rows here and `maintenanceFanoutSchedules.ts`
 * spreads them after the native rows.
 */
export const JOB_SCHEDULE_EXTENSIONS: readonly { jobName: string; cron: string }[] = [];
