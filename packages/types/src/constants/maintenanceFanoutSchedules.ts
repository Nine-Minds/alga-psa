import { CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME } from './billingJobNames';

/**
 * Dependency-free like billingJobNames: the Temporal worker's setupSchedules
 * creates these schedules, and the server suite checks them against the fan-out
 * registry, so neither side has to import the other.
 *
 * Every recurring server-side job in EE/appliance, as one global Temporal
 * Schedule each (`maintenance-fanout:<jobName>`). The schedule fires
 * maintenanceJobWorkflow, whose activity publishes MAINTENANCE_JOB_REQUESTED;
 * the server's maintenanceJobSubscriber runs the job across tenants. Each
 * jobName must resolve to a fan-out definition — either in @alga-psa/jobs
 * (maintenanceJobFanout.ts) or registered server-side
 * (server/src/lib/jobs/registerServerMaintenanceJobs.ts). A parity test in the
 * server suite holds the two sides together.
 *
 * Crons are UTC and keep the cadence the CE pg-boss schedules use.
 */
export const MAINTENANCE_FANOUT_SCHEDULES: ReadonlyArray<{ jobName: string; cron: string }> = [
  { jobName: 'expired-credits', cron: '0 1 * * *' },
  { jobName: 'expired-hour-blocks', cron: '30 1 * * *' },
  { jobName: 'cleanup-temporary-workflow-forms', cron: '0 2 * * *' },
  { jobName: 'reconcile-bucket-usage', cron: '0 3 * * *' },
  { jobName: 'reconcile-hour-block-allocations', cron: '15 3 * * *' },
  { jobName: 'process-renewal-queue', cron: '0 5 * * *' },
  { jobName: 'date-trigger-scan', cron: '5 * * * *' },
  { jobName: 'search:reconcile', cron: '0 6 * * *' },
  { jobName: 'expiring-credits-notification', cron: '0 9 * * *' },
  { jobName: 'expiring-hour-blocks-notification', cron: '15 9 * * *' },
  { jobName: 'prepaid-balance-alert-scan', cron: '0 9 * * *' },
  { jobName: 'auto-close-tickets', cron: '*/15 * * * *' },
  { jobName: 'cleanup-webhook-deliveries', cron: '*/15 * * * *' },
  { jobName: 'verify-google-calendar-pubsub', cron: '15 * * * *' },
  { jobName: 'renew-google-gmail-watch', cron: '*/30 * * * *' },
  { jobName: 'renew-teams-meeting-artifact-subscriptions', cron: '*/30 * * * *' },
  { jobName: 'renew-telephony-call-subscriptions', cron: '*/30 * * * *' },
  { jobName: 'sweep-telephony-call-artifacts', cron: '*/10 * * * *' },
  { jobName: 'reconcile-threecx-call-control', cron: '*/5 * * * *' },
  { jobName: 'backfill-threecx-cdr', cron: '5 * * * *' },
  { jobName: 'reconcile-threecx-phonebook', cron: '10 * * * *' },
  { jobName: 'sweep-teams-online-meetings', cron: '*/10 * * * *' },
  { jobName: 'cleanup-ai-session-keys', cron: '*/10 * * * *' },
  { jobName: 'workflow-quota-resume-scan', cron: '*/5 * * * *' },
  { jobName: 'inbound-email-recovery', cron: '*/1 * * * *' },
  { jobName: 'provider-disconnect-retry', cron: '*/5 * * * *' },
  // Nightly contract-cadence service-period replenishment. Runs on the
  // durable Temporal schedule for Essentials/Solo/Pro; the handler is
  // executed server-side via the maintenance subscriber because the worker
  // cannot load the billing domain graph.
  { jobName: CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME, cron: '0 4 * * *' },

  // Server-registered jobs (registerServerMaintenanceJobs.ts).
  { jobName: 'create-client-contract-line-cycles', cron: '0 0 * * *' },
  { jobName: 'project-date-readiness', cron: '15 0 * * *' },
  { jobName: 'create-next-time-periods', cron: '30 0 * * *' },
  { jobName: 'hudu-auto-sync', cron: '0 2 * * *' },
  { jobName: 'opportunity-generators', cron: '0 6 * * *' },
  { jobName: 'opportunity-discipline', cron: '0 7 * * *' },
  { jobName: 'inventory-low-stock-notification', cron: '30 7 * * *' },
  { jobName: 'opportunity-weekly-digest', cron: '0 8 * * 1' },
  { jobName: 'accounting-sync-cycle', cron: '*/15 * * * *' },
  { jobName: 'rmm-polling-reconcile', cron: '*/5 * * * *' },
  { jobName: 'recover-comment-publications', cron: '* * * * *' },
  { jobName: 'generate-recurring-tickets', cron: '*/15 * * * *' },
];

/**
 * Prefixes of the per-tenant Temporal schedules the server used to upsert at
 * boot (TemporalJobRunner names a recurring schedule by its singletonKey,
 * `<jobName>:<tenant>`). The global maintenance-fanout:* schedules above replace
 * them; setupSchedules deletes these once those have converged.
 */
export const LEGACY_PER_TENANT_SCHEDULE_PREFIXES: ReadonlyArray<string> = [
  'opportunity-discipline:',
  'opportunity-generators:',
  'opportunity-weekly-digest:',
  'project-date-readiness:',
  'accounting-sync-cycle:',
  'hudu-auto-sync:',
  'recover-comment-publications:',
  'date-trigger-scan:',
];
