import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

// Sibling handlers live in this same package; imported relatively so the
// wildcard './handlers/*' export-map entry is not self-referenced (which would
// otherwise require a rootDir to disambiguate the type build). Consumers
// outside the package use '@alga-psa/jobs/handlers/<name>'.
import { expiredCreditsHandler } from './handlers/expiredCreditsHandler';
import { expiringCreditsNotificationHandler } from './handlers/expiringCreditsNotificationHandler';
import {
  PREPAID_BALANCE_ALERT_SCAN_JOB,
  prepaidBalanceAlertScanHandler,
} from './handlers/prepaidBalanceAlertScanHandler';
import { expiredHourBlocksHandler } from './handlers/expiredHourBlocksHandler';
import { expiringHourBlocksNotificationHandler } from './handlers/expiringHourBlocksNotificationHandler';
import { handleReconcileBucketUsage } from './handlers/reconcileBucketUsageHandler';
import { handleReconcileHourBlockAllocations } from './handlers/reconcileHourBlockAllocationsHandler';
import { processRenewalQueueHandler } from './handlers/processRenewalQueueHandler';
import { autoCloseTicketsHandler } from './handlers/autoCloseTicketsHandler';
import { SEARCH_RECONCILE_JOB_NAME, searchReconcileHandler } from './handlers/searchReconcileHandler';
import { verifyGoogleCalendarProvisioning } from './handlers/calendarWebhookMaintenanceHandler';
import { renewGoogleGmailWatchSubscriptions } from './handlers/googleGmailWatchRenewalHandler';
import { renewTeamsMeetingArtifactSubscriptions } from './handlers/teamsMeetingArtifactWebhookHandler';
import { renewTelephonyCallSubscriptions } from './handlers/telephonyCallNotificationHandler';
import {
  TELEPHONY_CALL_ARTIFACT_SWEEP_JOB,
  telephonyCallArtifactSweepHandler,
} from './handlers/telephonyCallArtifactHandler';
import { teamsMeetingSweepHandler, TEAMS_MEETING_SWEEP_JOB } from './handlers/teamsMeetingSweepHandler';
import { workflowQuotaResumeScanHandler } from './handlers/workflowQuotaResumeScanHandler';
import { cleanupAiSessionKeysHandler } from './handlers/cleanupAiSessionKeysHandler';
import { cleanupTemporaryFormsJob } from './handlers/cleanupTemporaryFormsJob';
import { cleanupWebhookDeliveriesJob } from './handlers/cleanupWebhookDeliveriesJob';
import { inboundEmailRecoveryHandler } from './handlers/inboundEmailRecoveryHandler';
import { providerDisconnectRetryHandler } from './handlers/providerDisconnectRetryHandler';

const RENEWAL_HORIZON_DAYS = 90;
const WORKFLOW_QUOTA_RESUME_BATCH_SIZE = 100;

type MaintenanceJobDef =
  | { scope: 'tenant'; run: (tenantId: string) => Promise<unknown> }
  | { scope: 'system'; run: () => Promise<unknown> };

// The per-tenant handlers are the same functions the CE pg-boss runner invokes
// per tenant; here a single global run fans them out across all tenants. System
// jobs run once. Edition gating lives in the schedule wiring, not here.
const MAINTENANCE_JOBS: Record<string, MaintenanceJobDef> = {
  'expired-credits': { scope: 'tenant', run: (tenantId) => expiredCreditsHandler({ tenantId }) },
  'expiring-credits-notification': { scope: 'tenant', run: (tenantId) => expiringCreditsNotificationHandler({ tenantId }) },
  [PREPAID_BALANCE_ALERT_SCAN_JOB]: { scope: 'tenant', run: (tenantId) => prepaidBalanceAlertScanHandler({ tenantId }) },
  'expired-hour-blocks': { scope: 'tenant', run: (tenantId) => expiredHourBlocksHandler({ tenantId }) },
  'expiring-hour-blocks-notification': { scope: 'tenant', run: (tenantId) => expiringHourBlocksNotificationHandler({ tenantId }) },
  'reconcile-bucket-usage': { scope: 'tenant', run: (tenantId) => handleReconcileBucketUsage({ id: `fanout:${tenantId}`, data: { tenantId } } as any) },
  'reconcile-hour-block-allocations': { scope: 'tenant', run: (tenantId) => handleReconcileHourBlockAllocations({ id: `fanout:${tenantId}`, data: { tenantId } } as any) },
  'process-renewal-queue': { scope: 'tenant', run: (tenantId) => processRenewalQueueHandler({ tenantId, horizonDays: RENEWAL_HORIZON_DAYS }) },
  'auto-close-tickets': { scope: 'tenant', run: (tenantId) => autoCloseTicketsHandler({ tenantId }) },
  [SEARCH_RECONCILE_JOB_NAME]: { scope: 'tenant', run: (tenantId) => searchReconcileHandler({ tenantId }) },
  'verify-google-calendar-pubsub': { scope: 'tenant', run: (tenantId) => verifyGoogleCalendarProvisioning({ tenantId }) },
  'renew-google-gmail-watch': { scope: 'tenant', run: (tenantId) => renewGoogleGmailWatchSubscriptions({ tenantId }) },
  'renew-teams-meeting-artifact-subscriptions': { scope: 'tenant', run: (tenantId) => renewTeamsMeetingArtifactSubscriptions({ tenantId }) },
  'renew-telephony-call-subscriptions': { scope: 'tenant', run: (tenantId) => renewTelephonyCallSubscriptions({ tenantId }) },
  [TELEPHONY_CALL_ARTIFACT_SWEEP_JOB]: { scope: 'tenant', run: (tenantId) => telephonyCallArtifactSweepHandler({ tenantId }) },
  [TEAMS_MEETING_SWEEP_JOB]: { scope: 'tenant', run: (tenantId) => teamsMeetingSweepHandler({ tenantId }) },
  'workflow-quota-resume-scan': { scope: 'system', run: () => workflowQuotaResumeScanHandler({ tenantId: 'system', batchSize: WORKFLOW_QUOTA_RESUME_BATCH_SIZE }) },
  'cleanup-temporary-workflow-forms': { scope: 'system', run: () => cleanupTemporaryFormsJob() },
  'cleanup-webhook-deliveries': { scope: 'system', run: () => cleanupWebhookDeliveriesJob() },
  'cleanup-ai-session-keys': { scope: 'system', run: () => cleanupAiSessionKeysHandler() },
  'inbound-email-recovery': { scope: 'tenant', run: (tenantId) => inboundEmailRecoveryHandler({ tenantId }) },
  'provider-disconnect-retry': { scope: 'tenant', run: (tenantId) => providerDisconnectRetryHandler({ tenantId }) },
};

export type MaintenanceJobResult = {
  jobName: string;
  scope: 'tenant' | 'system';
  total: number;
  succeeded: number;
  failed: number;
};

export const isKnownMaintenanceJob = (jobName: string): boolean =>
  Object.prototype.hasOwnProperty.call(MAINTENANCE_JOBS, jobName);

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// Run a maintenance job once across the whole install: system jobs run a single
// time, tenant jobs fan out across all tenants with bounded concurrency and
// per-tenant error isolation (one tenant's failure never aborts the rest).
export async function runMaintenanceJob(
  jobName: string,
  opts: { concurrency?: number } = {},
): Promise<MaintenanceJobResult> {
  const def = MAINTENANCE_JOBS[jobName];
  if (!def) {
    throw new Error(`Unknown maintenance job: ${jobName}`);
  }

  if (def.scope === 'system') {
    await def.run();
    logger.info('[maintenance] system job complete', { jobName });
    return { jobName, scope: 'system', total: 1, succeeded: 1, failed: 0 };
  }

  const knex = await getAdminConnection();
  const tenants = await tenantDb(knex, '__maintenance_job_fanout_tenant_enumeration__')
    .unscoped<{ tenant: string }>('tenants', 'maintenance fanout enumerates tenants for tenant-scoped jobs')
    .whereNull('suspended_at')
    .select('tenant');
  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(tenants, opts.concurrency ?? 10, async (row: { tenant: string }) => {
    const tenantId = String(row.tenant);
    try {
      await def.run(tenantId);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      logger.warn('[maintenance] tenant run failed', {
        jobName,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.info('[maintenance] tenant fan-out complete', { jobName, total: tenants.length, succeeded, failed });
  return { jobName, scope: 'tenant', total: tenants.length, succeeded, failed };
}
