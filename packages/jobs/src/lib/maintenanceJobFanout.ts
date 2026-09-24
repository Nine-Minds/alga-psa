import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { TenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME } from '@alga-psa/types';
import { replenishContractCadenceServicePeriodsSweep } from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';

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
import { dateTriggerScanHandler } from './handlers/dateTriggerScanHandler';
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
import { reconcileThreecxCallControlHandler, THREECX_CALL_CONTROL_RECONCILE_JOB } from './handlers/threecxCallControlReconcileHandler';
import { backfillThreecxCdrHandler, THREECX_CDR_BACKFILL_JOB } from './handlers/threecxCdrBackfillHandler';
import { reconcileThreecxPhonebookHandler, THREECX_PHONEBOOK_RECONCILE_JOB } from './handlers/threecxPhonebookHandlers';
import { workflowQuotaResumeScanHandler } from './handlers/workflowQuotaResumeScanHandler';
import { cleanupAiSessionKeysHandler } from './handlers/cleanupAiSessionKeysHandler';
import { cleanupTemporaryFormsJob } from './handlers/cleanupTemporaryFormsJob';
import { cleanupWebhookDeliveriesJob } from './handlers/cleanupWebhookDeliveriesJob';
import { inboundEmailRecoveryHandler } from './handlers/inboundEmailRecoveryHandler';
import { providerDisconnectRetryHandler } from './handlers/providerDisconnectRetryHandler';

const RENEWAL_HORIZON_DAYS = 90;
const WORKFLOW_QUOTA_RESUME_BATCH_SIZE = 100;

// Narrows a tenant job to the tenants that can actually do its work (the
// integration is configured), so the fan-out does not burn a pooled connection
// per tenant just to discover there is nothing to do. Returns distinct tenant ids.
type TenantSelector = (db: TenantDb) => PromiseLike<Array<{ tenant: string }>>;

/**
 * Aggregate outcome a system job may report so partial failures are not
 * flattened into "succeeded". Returning nothing keeps the historical
 * single-unit success result.
 */
export type MaintenanceJobExecutionOutcome = {
  total: number;
  succeeded: number;
  failed: number;
};

type MaintenanceJobDef =
  | { scope: 'tenant'; run: (tenantId: string) => Promise<unknown>; tenants?: TenantSelector; concurrency?: number }
  // System jobs may return anything; a result carrying numeric total/succeeded/
  // failed is treated as an execution outcome, everything else is a single unit.
  | { scope: 'system'; run: () => Promise<unknown> };

const DEFAULT_CONCURRENCY = 10;

const tenantsWithActiveTeams: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('teams_integrations', 'maintenance fanout narrows Teams jobs to tenants with an active integration')
  .where('install_status', 'active')
  .whereNotNull('selected_profile_id')
  .distinct('tenant');

const tenantsWithInboundEmail: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('email_providers', 'maintenance fanout narrows inbound-email recovery to tenants with an active provider')
  .where('is_active', true)
  .distinct('tenant');

// 'teams-phone' mirrors TEAMS_PHONE_PROVIDER in @alga-psa/ee-microsoft-teams, which this CE package cannot import.
const tenantsWithActiveTeamsPhone: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('telephony_providers', 'maintenance fanout narrows telephony renewals to tenants with an active Teams Phone provider')
  .where('provider', 'teams-phone')
  .where('status', 'active')
  .distinct('tenant');

// '3cx' mirrors THREECX_PROVIDER in @alga-psa/ee-threecx, which this CE package cannot import.
const tenantsWithActiveThreecx: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('telephony_providers', 'maintenance fanout narrows 3CX call-control reconciliation to tenants with an active 3CX provider')
  .where('provider', '3cx')
  .where('status', 'active')
  .distinct('tenant');

const tenantsWithThreecxCdrImport: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('telephony_providers', 'maintenance fanout narrows 3CX call-history import to tenants that opted in')
  .where('provider', '3cx')
  .where('status', 'active')
  .whereRaw("config->'cdr'->>'enabled' = 'true'")
  .distinct('tenant');

const tenantsWithThreecxPhonebookSync: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('telephony_providers', 'maintenance fanout narrows 3CX phonebook reconciliation to tenants that opted in')
  .where('provider', '3cx')
  .where('status', 'active')
  .whereRaw("config->'phonebook'->>'enabled' = 'true'")
  .distinct('tenant');

const tenantsWithPendingCallArtifacts: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('telephony_call_records', 'maintenance fanout narrows the call artifact sweep to tenants with calls awaiting artifacts')
  .where('artifact_status', 'pending')
  .distinct('tenant');

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
  'date-trigger-scan': { scope: 'tenant', run: (tenantId) => dateTriggerScanHandler({ tenantId }) },
  'process-renewal-queue': { scope: 'tenant', run: (tenantId) => processRenewalQueueHandler({ tenantId, horizonDays: RENEWAL_HORIZON_DAYS }) },
  'auto-close-tickets': { scope: 'tenant', run: (tenantId) => autoCloseTicketsHandler({ tenantId }) },
  [SEARCH_RECONCILE_JOB_NAME]: { scope: 'tenant', run: (tenantId) => searchReconcileHandler({ tenantId }) },
  'verify-google-calendar-pubsub': { scope: 'tenant', run: (tenantId) => verifyGoogleCalendarProvisioning({ tenantId }) },
  'renew-google-gmail-watch': { scope: 'tenant', run: (tenantId) => renewGoogleGmailWatchSubscriptions({ tenantId }) },
  'renew-teams-meeting-artifact-subscriptions': { scope: 'tenant', run: (tenantId) => renewTeamsMeetingArtifactSubscriptions({ tenantId }), tenants: tenantsWithActiveTeams },
  'renew-telephony-call-subscriptions': { scope: 'tenant', run: (tenantId) => renewTelephonyCallSubscriptions({ tenantId }), tenants: tenantsWithActiveTeamsPhone },
  [TELEPHONY_CALL_ARTIFACT_SWEEP_JOB]: { scope: 'tenant', run: (tenantId) => telephonyCallArtifactSweepHandler({ tenantId }), tenants: tenantsWithPendingCallArtifacts },
  [TEAMS_MEETING_SWEEP_JOB]: { scope: 'tenant', run: (tenantId) => teamsMeetingSweepHandler({ tenantId }), tenants: tenantsWithActiveTeams },
  [THREECX_CALL_CONTROL_RECONCILE_JOB]: { scope: 'tenant', run: (tenantId) => reconcileThreecxCallControlHandler({ tenantId }), tenants: tenantsWithActiveThreecx },
  [THREECX_CDR_BACKFILL_JOB]: { scope: 'tenant', run: (tenantId) => backfillThreecxCdrHandler({ tenantId }), tenants: tenantsWithThreecxCdrImport },
  [THREECX_PHONEBOOK_RECONCILE_JOB]: { scope: 'tenant', run: (tenantId) => reconcileThreecxPhonebookHandler({ tenantId }), tenants: tenantsWithThreecxPhonebookSync },
  'workflow-quota-resume-scan': { scope: 'system', run: () => workflowQuotaResumeScanHandler({ tenantId: 'system', batchSize: WORKFLOW_QUOTA_RESUME_BATCH_SIZE }) },
  'cleanup-temporary-workflow-forms': { scope: 'system', run: () => cleanupTemporaryFormsJob() },
  'cleanup-webhook-deliveries': { scope: 'system', run: () => cleanupWebhookDeliveriesJob() },
  'cleanup-ai-session-keys': { scope: 'system', run: () => cleanupAiSessionKeysHandler() },
  'inbound-email-recovery': { scope: 'tenant', run: (tenantId) => inboundEmailRecoveryHandler({ tenantId }), tenants: tenantsWithInboundEmail, concurrency: 3 },
  'provider-disconnect-retry': { scope: 'tenant', run: (tenantId) => providerDisconnectRetryHandler({ tenantId }) },
  // The sweep owns tenant enumeration and per-tenant advisory locking itself,
  // so it runs once as a system job rather than being fanned out twice. Its
  // per-tenant and per-line failures are aggregated so the maintenance result
  // reports them instead of an unconditional success.
  [CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME]: {
    scope: 'system',
    run: async () => {
      const sweep = await replenishContractCadenceServicePeriodsSweep({
        sourceRunPrefix: 'temporal-contract-cadence-replenishment',
      });
      const lineFailures = sweep.summaries.reduce(
        (count, summary) => count + summary.failures.length,
        0,
      );
      const failed = sweep.tenantsFailed + lineFailures;
      return {
        total: sweep.tenantsProcessed + failed,
        succeeded: sweep.tenantsProcessed,
        failed,
      };
    },
  },
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
    const raw = await def.run();
    const outcome = raw && typeof raw === 'object'
      ? (raw as Partial<MaintenanceJobExecutionOutcome>)
      : undefined;
    const total = typeof outcome?.total === 'number' ? outcome.total : 1;
    const succeeded = typeof outcome?.succeeded === 'number' ? outcome.succeeded : 1;
    const failed = typeof outcome?.failed === 'number' ? outcome.failed : 0;
    if (failed > 0) {
      logger.warn('[maintenance] system job completed with failures', {
        jobName,
        total,
        succeeded,
        failed,
      });
    } else {
      logger.info('[maintenance] system job complete', { jobName, total, succeeded, failed });
    }
    return { jobName, scope: 'system', total, succeeded, failed };
  }

  const db = tenantDb(await getAdminConnection(), '__maintenance_job_fanout_tenant_enumeration__');
  const active = await db
    .unscoped<{ tenant: string }>('tenants', 'maintenance fanout enumerates tenants for tenant-scoped jobs')
    .whereNull('suspended_at')
    .select('tenant');
  let tenants = active;
  if (def.tenants) {
    const eligible = new Set((await def.tenants(db)).map((row) => String(row.tenant)));
    tenants = active.filter((row) => eligible.has(String(row.tenant)));
  }
  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(tenants, opts.concurrency ?? def.concurrency ?? DEFAULT_CONCURRENCY, async (row: { tenant: string }) => {
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
