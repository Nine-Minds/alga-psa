// Names of the maintenance jobs the server registers into the fan-out registry
// (registerServerMaintenanceJobs.ts). Kept free of handler imports so the
// schedule/registry parity test can load it without the domain graph.
export const SERVER_MAINTENANCE_JOBS = {
  lowStockNotification: 'inventory-low-stock-notification',
  opportunityDiscipline: 'opportunity-discipline',
  opportunityGenerators: 'opportunity-generators',
  opportunityWeeklyDigest: 'opportunity-weekly-digest',
  projectDateReadiness: 'project-date-readiness',
  accountingSyncCycle: 'accounting-sync-cycle',
  huduAutoSync: 'hudu-auto-sync',
  recoverCommentPublications: 'recover-comment-publications',
  createNextTimePeriods: 'create-next-time-periods',
  createClientContractLineCycles: 'create-client-contract-line-cycles',
  rmmPollingReconcile: 'rmm-polling-reconcile',
  generateRecurringTickets: 'generate-recurring-tickets',
} as const;

// CE-only fan-out definitions (registerCeMaintenanceJobs.ts). Kept apart from
// SERVER_MAINTENANCE_JOBS: EE runs these through other mechanisms and has no
// Temporal maintenance-fanout schedule for them, so the schedule/registry
// parity test must not expect one.
export const CE_MAINTENANCE_JOBS = {
  slaTimer: 'sla-timer',
  emailWebhookMaintenance: 'email-webhook-maintenance',
} as const;

// Base pg-boss job the CE maintenance schedules fire: one schedule/queue per job,
// named `maintenance-fanout:<jobName>`, each carrying `{ jobName }`.
export const MAINTENANCE_FANOUT_JOB = 'maintenance-fanout';
export const MAINTENANCE_FANOUT_SCHEDULE_PREFIX = 'maintenance-fanout:';
