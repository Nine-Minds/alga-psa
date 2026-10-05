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
