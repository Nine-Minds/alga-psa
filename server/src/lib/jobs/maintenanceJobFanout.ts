import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';

import { expiredCreditsHandler } from './handlers/expiredCreditsHandler';
import { expiringCreditsNotificationHandler } from './handlers/expiringCreditsNotificationHandler';
import { creditReconciliationHandler } from './handlers/creditReconciliationHandler';
import { handleReconcileBucketUsage } from './handlers/reconcileBucketUsageHandler';
import { processRenewalQueueHandler } from './handlers/processRenewalQueueHandler';
import { autoCloseTicketsHandler } from './handlers/autoCloseTicketsHandler';
import { SEARCH_RECONCILE_JOB_NAME, searchReconcileHandler } from './handlers/searchReconcileHandler';
import { verifyGoogleCalendarProvisioning } from './handlers/calendarWebhookMaintenanceHandler';
import { renewGoogleGmailWatchSubscriptions } from './handlers/googleGmailWatchRenewalHandler';
import { renewTeamsMeetingArtifactSubscriptions } from './handlers/teamsMeetingArtifactWebhookHandler';
import { workflowQuotaResumeScanHandler } from './handlers/workflowQuotaResumeScanHandler';
import { cleanupAiSessionKeysHandler } from './handlers/cleanupAiSessionKeysHandler';
import { cleanupTemporaryFormsJob } from '../../services/cleanupTemporaryFormsJob';
import { cleanupWebhookDeliveriesJob } from '../../services/cleanupWebhookDeliveriesJob';

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
  'credit-reconciliation': { scope: 'tenant', run: (tenantId) => creditReconciliationHandler({ tenantId }) },
  'reconcile-bucket-usage': { scope: 'tenant', run: (tenantId) => handleReconcileBucketUsage({ id: `fanout:${tenantId}`, data: { tenantId } } as any) },
  'process-renewal-queue': { scope: 'tenant', run: (tenantId) => processRenewalQueueHandler({ tenantId, horizonDays: RENEWAL_HORIZON_DAYS }) },
  'auto-close-tickets': { scope: 'tenant', run: (tenantId) => autoCloseTicketsHandler({ tenantId }) },
  [SEARCH_RECONCILE_JOB_NAME]: { scope: 'tenant', run: (tenantId) => searchReconcileHandler({ tenantId }) },
  'verify-google-calendar-pubsub': { scope: 'tenant', run: (tenantId) => verifyGoogleCalendarProvisioning({ tenantId }) },
  'renew-google-gmail-watch': { scope: 'tenant', run: (tenantId) => renewGoogleGmailWatchSubscriptions({ tenantId }) },
  'renew-teams-meeting-artifact-subscriptions': { scope: 'tenant', run: (tenantId) => renewTeamsMeetingArtifactSubscriptions({ tenantId }) },
  'workflow-quota-resume-scan': { scope: 'system', run: () => workflowQuotaResumeScanHandler({ tenantId: 'system', batchSize: WORKFLOW_QUOTA_RESUME_BATCH_SIZE }) },
  'cleanup-temporary-workflow-forms': { scope: 'system', run: () => cleanupTemporaryFormsJob() },
  'cleanup-webhook-deliveries': { scope: 'system', run: () => cleanupWebhookDeliveriesJob() },
  'cleanup-ai-session-keys': { scope: 'system', run: () => cleanupAiSessionKeysHandler() },
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
  const tenants = await knex('tenants').select('tenant');
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
