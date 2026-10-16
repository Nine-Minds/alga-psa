import { MAINTENANCE_FANOUT_SCHEDULES } from './maintenanceFanoutSchedules';

/**
 * Community Edition maintenance schedules.
 *
 * CE has no Temporal, so each recurring maintenance job gets one global pg-boss
 * cron schedule named `maintenance-fanout:<jobName>` (the same id EE uses for its
 * Temporal schedule). Dependency-free like maintenanceFanoutSchedules.
 *
 * - CE_SHARED_MAINTENANCE_JOBS: jobs EE also schedules; the cron is taken from
 *   MAINTENANCE_FANOUT_SCHEDULES by name so the two editions cannot drift.
 * - CE_ONLY_MAINTENANCE_SCHEDULES: jobs EE runs through other mechanisms
 *   (SLA on Temporal workflows, email webhook maintenance on a workflow).
 *
 * `renew-microsoft-calendar-webhooks` and `verify-google-calendar-pubsub` are
 * deliberately absent: their handlers are no-ops outside Enterprise Edition.
 * Crons are UTC.
 */
export const CE_SHARED_MAINTENANCE_JOBS: ReadonlyArray<string> = [
  'expired-credits',
  'expiring-credits-notification',
  'prepaid-balance-alert-scan',
  'expired-hour-blocks',
  'expiring-hour-blocks-notification',
  'inventory-low-stock-notification',
  'reconcile-bucket-usage',
  'reconcile-hour-block-allocations',
  'auto-close-tickets',
  'search:reconcile',
  'renew-google-gmail-watch',
  'inbound-email-recovery',
  'provider-disconnect-retry',
  'process-renewal-queue',
  'cleanup-temporary-workflow-forms',
  'cleanup-webhook-deliveries',
  'create-client-contract-line-cycles',
  'create-next-time-periods',
];

export const CE_ONLY_MAINTENANCE_SCHEDULES: ReadonlyArray<{ jobName: string; cron: string }> = [
  { jobName: 'sla-timer', cron: '*/5 * * * *' },
  { jobName: 'email-webhook-maintenance', cron: '0 4 * * *' },
];

/** Environment variables that override the cron of a CE schedule. */
export const CE_MAINTENANCE_CRON_ENV_OVERRIDES: Readonly<Record<string, string>> = {
  'inbound-email-recovery': 'UNIFIED_INBOUND_EMAIL_RECOVERY_CRON',
  'provider-disconnect-retry': 'PROVIDER_DISCONNECT_RETRY_CRON',
};

export interface ResolveCeMaintenanceSchedulesOptions {
  /** Validates an environment override; an invalid one falls back to the catalog cron. */
  isValidCron?: (cron: string) => boolean;
  /** Called for each rejected override. */
  onInvalidOverride?: (info: { jobName: string; envVar: string; value: string }) => void;
}

export function resolveCeMaintenanceSchedules(
  env: Record<string, string | undefined>,
  options: ResolveCeMaintenanceSchedulesOptions = {},
): Array<{ jobName: string; cron: string }> {
  const eeCrons = new Map(MAINTENANCE_FANOUT_SCHEDULES.map((s) => [s.jobName, s.cron]));

  const entries = [
    ...CE_SHARED_MAINTENANCE_JOBS.map((jobName) => {
      const cron = eeCrons.get(jobName);
      if (!cron) {
        throw new Error(
          `CE maintenance job '${jobName}' is not in MAINTENANCE_FANOUT_SCHEDULES; cannot resolve its cron.`,
        );
      }
      return { jobName, cron };
    }),
    ...CE_ONLY_MAINTENANCE_SCHEDULES.map((s) => ({ ...s })),
  ];

  return entries.map((entry) => {
    const envVar = CE_MAINTENANCE_CRON_ENV_OVERRIDES[entry.jobName];
    const value = envVar ? env[envVar]?.trim() : undefined;
    if (!envVar || !value) return entry;
    if (options.isValidCron && !options.isValidCron(value)) {
      options.onInvalidOverride?.({ jobName: entry.jobName, envVar, value });
      return entry;
    }
    return { ...entry, cron: value };
  });
}
