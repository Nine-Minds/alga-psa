import { Job } from 'pg-boss';
import { JobScheduler, JobFilter, IJobScheduler, DummyJobScheduler } from './jobScheduler';
import { registerJobSchedulerAccessor } from '@alga-psa/jobs/scheduler';
import { InvoiceZipJobHandler } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { InvoiceEmailHandler, InvoiceEmailJobData } from 'server/src/lib/jobs/handlers/invoiceEmailHandler';
import type { InvoiceZipJobData } from 'server/src/lib/jobs/handlers/invoiceZipHandler';
import { generateInvoiceHandler, GenerateInvoiceData } from './handlers/generateInvoiceHandler';
import { ExpiredCreditsJobData } from '@alga-psa/jobs/handlers/expiredCreditsHandler';
import { ExpiringCreditsNotificationJobData } from '@alga-psa/jobs/handlers/expiringCreditsNotificationHandler';
import {
  PrepaidBalanceAlertScanJobData,
} from '@alga-psa/jobs/handlers/prepaidBalanceAlertScanHandler';
import { ExpiredHourBlocksJobData } from '@alga-psa/jobs/handlers/expiredHourBlocksHandler';
import { ExpiringHourBlocksNotificationJobData } from '@alga-psa/jobs/handlers/expiringHourBlocksNotificationHandler';
import { expireQuotesHandler, ExpireQuotesJobData } from './handlers/expireQuotesHandler';
import { opportunityDisciplineHandler, OpportunityDisciplineJobData } from './handlers/opportunityDisciplineHandler';
import { opportunityWeeklyDigestHandler, OpportunityWeeklyDigestJobData } from './handlers/opportunityWeeklyDigestHandler';
import { opportunityGeneratorsHandler, OpportunityGeneratorsJobData } from './handlers/opportunityGeneratorsHandler';
// Import the new handler
import { ReconcileBucketUsageJobData } from '@alga-psa/jobs/handlers/reconcileBucketUsageHandler';
import { ReconcileHourBlockAllocationsJobData } from '@alga-psa/jobs/handlers/reconcileHourBlockAllocationsHandler';
import { handleAssetImportJob, AssetImportJobData } from './handlers/assetImportHandler';
import { handleMigrationApplyJob, MigrationApplyJobData } from './handlers/migrationJobHandler';
import { EmailWebhookMaintenanceJobData } from './handlers/emailWebhookMaintenanceHandler';
import { GoogleGmailWatchRenewalJobData } from '@alga-psa/jobs/handlers/googleGmailWatchRenewalHandler';
import { RenewalQueueProcessorJobData } from '@alga-psa/jobs/handlers/processRenewalQueueHandler';
import { createDateTriggerScanHandler, dateTriggerScanHandler, DateTriggerScanJobData } from '@alga-psa/jobs/handlers/dateTriggerScanHandler';
import { GENERATE_RECURRING_TICKETS_CRON, GENERATE_RECURRING_TICKETS_JOB, type GenerateRecurringTicketsJobData } from './handlers/generateRecurringTicketsHandler';
import { resolveDateTriggerWorkflowLauncher } from './dateTriggerWorkflowLauncher';
import {
  PROJECT_DATE_READINESS_JOB,
  projectDateReadinessHandler,
  ProjectDateReadinessJobData,
} from './handlers/projectDateReadinessHandler';
import { cleanupAiSessionKeysHandler, CleanupAiSessionKeysJobData } from '@alga-psa/jobs/handlers/cleanupAiSessionKeysHandler';
import {
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData
} from '@alga-psa/jobs/handlers/calendarWebhookMaintenanceHandler';
import {
  renewTeamsMeetingArtifactSubscriptions,
  processTeamsMeetingArtifactNotification,
  TeamsMeetingArtifactSubscriptionRenewalJobData,
  TeamsMeetingArtifactNotificationJobData,
} from '@alga-psa/jobs/handlers/teamsMeetingArtifactWebhookHandler';
import {
  renewTelephonyCallSubscriptions,
  processTelephonyCallNotification,
  TelephonyCallSubscriptionRenewalJobData,
  TelephonyCallNotificationJobData,
} from '@alga-psa/jobs/handlers/telephonyCallNotificationHandler';
import {
  telephonyCallArtifactSweepHandler,
  TelephonyCallArtifactSweepJobData,
  TELEPHONY_CALL_ARTIFACT_SWEEP_JOB,
} from '@alga-psa/jobs/handlers/telephonyCallArtifactHandler';
import {
  teamsMeetingCleanupHandler,
  TeamsMeetingCleanupJobData,
  TEAMS_MEETING_CLEANUP_JOB,
} from '@alga-psa/jobs/handlers/teamsMeetingCleanupHandler';
import {
  teamsMeetingSweepHandler,
  TeamsMeetingSweepJobData,
  TEAMS_MEETING_SWEEP_JOB,
} from '@alga-psa/jobs/handlers/teamsMeetingSweepHandler';
import { SlaTimerJobData } from './handlers/slaTimerHandler';
import {
  MARKETING_FLIP_DUE_POSTS_JOB,
  MARKETING_EXPIRE_STALE_TARGETS_JOB,
  MARKETING_SEND_SEQUENCE_STEPS_JOB,
  MarketingJobData,
} from './handlers/marketingJobs';
import {
  workflowQuotaResumeScanHandler,
  WorkflowQuotaResumeScanJobData,
} from '@alga-psa/jobs/handlers/workflowQuotaResumeScanHandler';
import {
  SEARCH_VISIBLE_USER_REINDEX_JOB_NAME,
  searchVisibleUserReindexHandler,
  SearchVisibleUserReindexJobData,
} from './handlers/searchVisibleUserReindexHandler';
import {
  SearchReconcileJobData,
} from '@alga-psa/jobs/handlers/searchReconcileHandler';
import { JobService } from '../../services/job.service';
import { StorageService } from '@alga-psa/storage/StorageService';
import logger from '@alga-psa/core/logger';
import type { IRecurringRunExecutionWindowIdentity } from '@alga-psa/types';
import type { IRecurringDueSelectionInput } from '@alga-psa/types';

const isEnterpriseWorkflowEdition = (): boolean =>
  process.env.EDITION === 'enterprise'
  || process.env.EDITION === 'ee'
  || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

// =============================================================================
// NEW JOB RUNNER ABSTRACTION EXPORTS
// =============================================================================
// These exports provide the new abstraction layer that supports both PG Boss (CE)
// and Temporal (EE) as backend job runners. The existing exports below are
// maintained for backward compatibility.

export * from './interfaces';
export { JobRunnerFactory, getJobRunner } from './JobRunnerFactory';
import { getJobRunner as getJobRunnerInstance } from './JobRunnerFactory';
export { PgBossJobRunner } from './runners/PgBossJobRunner';
export {
  initializeJobRunner,
  getJobRunnerInstance,
  stopJobRunner,
} from './initializeJobRunner';
export {
  JobHandlerRegistry,
  registerJobHandler,
  executeJobHandler,
} from './jobHandlerRegistry';
export {
  registerAllJobHandlers,
  getAvailableJobHandlers,
} from './registerAllHandlers';

// =============================================================================
// LEGACY EXPORTS (Backward Compatibility)
// =============================================================================
// The following exports maintain backward compatibility with existing code.
// New code should prefer using the IJobRunner interface via getJobRunner().

// Initialize the job scheduler singleton
let jobScheduler: IJobScheduler;

// Initialize function to ensure scheduler is ready
export const initializeScheduler = async (storageService?: StorageService) => {
  if (!jobScheduler) {
    const jobService = await JobService.create();
    const storageService = new StorageService();
    jobScheduler = await JobScheduler.getInstance(jobService, storageService);

    if (!jobScheduler) {
      logger.error('Failed to initialize job scheduler');
      return DummyJobScheduler.getInstance();
    }
    
    // Register job handlers
    jobScheduler.registerJobHandler<GenerateInvoiceData>('generate-invoice', async (job: Job<GenerateInvoiceData>) => {
      await generateInvoiceHandler(job.data);
    });
    jobScheduler.registerJobHandler<AssetImportJobData>('asset_import', handleAssetImportJob);

    // Register the AMP migration application handler
    jobScheduler.registerJobHandler<MigrationApplyJobData>('migration_apply', handleMigrationApplyJob);
    
    jobScheduler.registerJobHandler<ProjectDateReadinessJobData>(PROJECT_DATE_READINESS_JOB, async (job: Job<ProjectDateReadinessJobData>) => {
      await projectDateReadinessHandler(job.data);
    });
    
    jobScheduler.registerJobHandler<ExpireQuotesJobData>('expire-quotes', async (job: Job<ExpireQuotesJobData>) => {
      await expireQuotesHandler(job.data);
    });

    jobScheduler.registerJobHandler<OpportunityDisciplineJobData>('opportunity-discipline', async (job: Job<OpportunityDisciplineJobData>) => {
      await opportunityDisciplineHandler(job.data);
    });

    jobScheduler.registerJobHandler<OpportunityWeeklyDigestJobData>('opportunity-weekly-digest', async (job: Job<OpportunityWeeklyDigestJobData>) => {
      await opportunityWeeklyDigestHandler(job.data);
    });

    jobScheduler.registerJobHandler<OpportunityGeneratorsJobData>('opportunity-generators', async (job: Job<OpportunityGeneratorsJobData>) => {
      await opportunityGeneratorsHandler(job.data);
    });

    // Register invoice handlers if storageService is provided
    if (storageService && jobService) {
      const invoiceZipHandler = new InvoiceZipJobHandler(jobService, storageService);
      jobScheduler.registerJobHandler<InvoiceZipJobData>('invoice_zip', async (job: Job<InvoiceZipJobData>) => {
        await invoiceZipHandler.handleInvoiceZipJob(job.id, job.data);
      });
        
      // Register invoice email handler
      jobScheduler.registerJobHandler<InvoiceEmailJobData>('invoice_email', async (job: Job<InvoiceEmailJobData>) => {
        if (!job.data || typeof job.data !== 'object') {
          logger.error(`Invalid job data received for invoice_email job ${job.id}`);
          return;
        }
        await InvoiceEmailHandler.handle(job.id, job.data);
      });
    }

    // Keep the legacy scheduler's EE handler aligned with JobHandlerRegistry without a CE import edge.
    const dateTriggerLauncher = resolveDateTriggerWorkflowLauncher(isEnterpriseWorkflowEdition());
    const runDateTriggerScan = dateTriggerLauncher ? createDateTriggerScanHandler(dateTriggerLauncher) : dateTriggerScanHandler;
    jobScheduler.registerJobHandler<DateTriggerScanJobData>('date-trigger-scan', async (job) => { await runDateTriggerScan(job.data); });

    if (process.env.EDITION === 'enterprise') {
      jobScheduler.registerJobHandler<CleanupAiSessionKeysJobData>('cleanup-ai-session-keys', async () => {
        await cleanupAiSessionKeysHandler();
      });
    }

    if (isEnterpriseWorkflowEdition()) {
      jobScheduler.registerJobHandler<TeamsMeetingArtifactSubscriptionRenewalJobData>(
        'renew-teams-meeting-artifact-subscriptions',
        async (job: Job<TeamsMeetingArtifactSubscriptionRenewalJobData>) => {
          await renewTeamsMeetingArtifactSubscriptions(job.data);
        }
      );

      jobScheduler.registerJobHandler<TeamsMeetingArtifactNotificationJobData>(
        'process-teams-meeting-artifact-notification',
        async (job: Job<TeamsMeetingArtifactNotificationJobData>) => {
          await processTeamsMeetingArtifactNotification(job.data);
        }
      );

      jobScheduler.registerJobHandler<TelephonyCallSubscriptionRenewalJobData>(
        'renew-telephony-call-subscriptions',
        async (job: Job<TelephonyCallSubscriptionRenewalJobData>) => {
          await renewTelephonyCallSubscriptions(job.data);
        }
      );

      jobScheduler.registerJobHandler<TelephonyCallNotificationJobData>(
        'process-telephony-call-notification',
        async (job: Job<TelephonyCallNotificationJobData>) => {
          await processTelephonyCallNotification(job.data);
        }
      );

      jobScheduler.registerJobHandler<TelephonyCallArtifactSweepJobData>(
        TELEPHONY_CALL_ARTIFACT_SWEEP_JOB,
        async (job: Job<TelephonyCallArtifactSweepJobData>) => {
          await telephonyCallArtifactSweepHandler(job.data);
        }
      );

      jobScheduler.registerJobHandler<TeamsMeetingCleanupJobData>(
        TEAMS_MEETING_CLEANUP_JOB,
        async (job: Job<TeamsMeetingCleanupJobData>) => {
          await teamsMeetingCleanupHandler(job.data);
        }
      );

      jobScheduler.registerJobHandler<TeamsMeetingSweepJobData>(
        TEAMS_MEETING_SWEEP_JOB,
        async (job: Job<TeamsMeetingSweepJobData>) => {
          await teamsMeetingSweepHandler(job.data);
        }
      );
    }

    if (isEnterpriseWorkflowEdition()) {
      jobScheduler.registerJobHandler<WorkflowQuotaResumeScanJobData>(
        'workflow-quota-resume-scan',
        async (job: Job<WorkflowQuotaResumeScanJobData>) => {
          await workflowQuotaResumeScanHandler(job.data);
        }
      );
    }

    jobScheduler.registerJobHandler<SearchVisibleUserReindexJobData>(
      SEARCH_VISIBLE_USER_REINDEX_JOB_NAME,
      async (job: Job<SearchVisibleUserReindexJobData>) => {
        await searchVisibleUserReindexHandler(job.data);
      }
    );

    // Note: Password reset token cleanup is handled automatically during token operations
    // No pg-boss job needed

  }
  return jobScheduler;
};

// Let @alga-psa/jobs CE scheduling helpers reach the fully-initialized server
// scheduler without importing server/src (keeps the Temporal worker build clean).
registerJobSchedulerAccessor(() => initializeScheduler());


// Export types
export type {
  JobFilter,
  GenerateInvoiceData,
  ExpiredCreditsJobData,
  ExpiringCreditsNotificationJobData,
  PrepaidBalanceAlertScanJobData,
  ExpiredHourBlocksJobData,
  ExpiringHourBlocksNotificationJobData,
  ReconcileBucketUsageJobData,
  ReconcileHourBlockAllocationsJobData,
  CleanupAiSessionKeysJobData,
  MicrosoftWebhookRenewalJobData,
  GooglePubSubVerificationJobData,
  TeamsMeetingArtifactSubscriptionRenewalJobData,
  TeamsMeetingArtifactNotificationJobData,
  GoogleGmailWatchRenewalJobData,
  AssetImportJobData,
  EmailWebhookMaintenanceJobData,
  RenewalQueueProcessorJobData,
  SlaTimerJobData,
  WorkflowQuotaResumeScanJobData,
  SearchVisibleUserReindexJobData,
  SearchReconcileJobData
};
// Export job scheduling helper functions
export const scheduleInvoiceGeneration = async (
  clientId: string,
  billingCycleId: string,
  runAt: Date,
  tenantId: string
): Promise<string | null> => {
  throw new Error(
    `Recurring invoice scheduling no longer accepts billingCycleId ${billingCycleId}. Use scheduleRecurringWindowInvoiceGeneration with canonical selectorInput.`,
  );
};

export const scheduleRecurringWindowInvoiceGeneration = async (input: {
  clientId: string;
  runAt: Date;
  tenantId: string;
  executionWindow?: IRecurringRunExecutionWindowIdentity;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  const executionWindow = input.executionWindow ?? input.selectorInput.executionWindow;

  if (executionWindow.identityKey !== input.selectorInput.executionWindow.identityKey) {
    throw new Error(
      `Recurring invoice job execution window ${executionWindow.identityKey} does not match selectorInput ${input.selectorInput.executionWindow.identityKey}.`,
    );
  }

  return await scheduler.scheduleScheduledJob<GenerateInvoiceData>(
    'generate-invoice',
    input.runAt,
    {
      clientId: input.clientId,
      executionWindow,
      selectorInput: input.selectorInput,
      tenantId: input.tenantId,
    }
  );
};

// Export monitoring functions
export interface JobHistoryFilter {
  jobName?: string;
  startDate?: Date;
  endDate?: Date;
  status?: 'completed' | 'failed' | 'active' | 'expired';
  limit?: number;
  offset?: number;
}

export interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

export const scheduleImmediateJob = async <T extends Record<string, unknown>>(
  jobName: string,
  data: T
): Promise<string | null> => {
  const scheduler = await initializeScheduler();
  return await scheduler.scheduleImmediateJob(jobName, data);
};

export const scheduleSearchVisibleUserReindexJob = async (
  tenantId: string,
  userId: string,
  batchSize: number = 500
): Promise<string | null> => {
  return await scheduleImmediateJob<SearchVisibleUserReindexJobData>(
    SEARCH_VISIBLE_USER_REINDEX_JOB_NAME,
    { tenantId, userId, batchSize }
  );
};

export const scheduleQuoteAutoExpirationJob = async (
  tenantId: string,
  cronExpression: string = '0 6 * * *'
): Promise<string | null> => {
  // Runner path, like the other cron jobs: the legacy JobScheduler no longer has a recurring API.
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<ExpireQuotesJobData>(
    'expire-quotes',
    { tenantId },
    cronExpression,
    { singletonKey: `expire-quotes:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleOpportunityDisciplineJob = async (
  tenantId: string,
  cronExpression: string = '0 7 * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<OpportunityDisciplineJobData>(
    'opportunity-discipline',
    { tenantId },
    cronExpression,
    { singletonKey: `opportunity-discipline:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleOpportunityWeeklyDigestJob = async (
  tenantId: string,
  cronExpression: string = '0 8 * * 1'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<OpportunityWeeklyDigestJobData>(
    'opportunity-weekly-digest',
    { tenantId },
    cronExpression,
    { singletonKey: `opportunity-weekly-digest:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleOpportunityGeneratorsJob = async (
  tenantId: string,
  cronExpression: string = '0 6 * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<OpportunityGeneratorsJobData>(
    'opportunity-generators',
    { tenantId },
    cronExpression,
    { singletonKey: `opportunity-generators:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleProjectDateReadinessJob = async (
  tenantId: string,
  cronExpression: string = '15 0 * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<ProjectDateReadinessJobData>(
    PROJECT_DATE_READINESS_JOB,
    { tenantId },
    cronExpression,
    { singletonKey: `${PROJECT_DATE_READINESS_JOB}:${tenantId}` }
  );
  return result.jobId;
};

/**
 * Marketing module recurring jobs (F027/F049). Every handler self-gates on the
 * `marketing-module` feature flag, so these are scheduled for all tenants and
 * no-op where the module is off.
 */
export const scheduleMarketingFlipDuePostsJob = async (
  tenantId: string,
  cronExpression: string = '*/5 * * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<MarketingJobData>(
    MARKETING_FLIP_DUE_POSTS_JOB,
    { tenantId },
    cronExpression,
    { singletonKey: `${MARKETING_FLIP_DUE_POSTS_JOB}:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleMarketingExpireStaleTargetsJob = async (
  tenantId: string,
  cronExpression: string = '11 * * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<MarketingJobData>(
    MARKETING_EXPIRE_STALE_TARGETS_JOB,
    { tenantId },
    cronExpression,
    { singletonKey: `${MARKETING_EXPIRE_STALE_TARGETS_JOB}:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleMarketingSendSequenceStepsJob = async (
  tenantId: string,
  cronExpression: string = '*/5 * * * *'
): Promise<string | null> => {
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<MarketingJobData>(
    MARKETING_SEND_SEQUENCE_STEPS_JOB,
    { tenantId },
    cronExpression,
    { singletonKey: `${MARKETING_SEND_SEQUENCE_STEPS_JOB}:${tenantId}` }
  );
  return result.jobId;
};

export const scheduleTeamsMeetingArtifactSubscriptionRenewalJob = async (
  tenantId: string,
  cronExpression: string = '*/30 * * * *'
): Promise<string | null> => {
  // Runner-agnostic (F027): on a Temporal-backed runner the global maintenance
  // fan-out schedule covers renewal, so no per-tenant schedule is needed. On a
  // pg-boss-backed runner — including EE deployments configured without
  // Temporal — the per-tenant schedule is registered through the IJobRunner
  // abstraction so the renewal cron is never silently absent.
  try {
    const runner = await getJobRunnerInstance();
    if (runner.getRunnerType() === 'temporal') {
      return null;
    }
    const result = await runner.scheduleRecurringJob<TeamsMeetingArtifactSubscriptionRenewalJobData & { tenantId: string }>(
      'renew-teams-meeting-artifact-subscriptions',
      { tenantId },
      cronExpression,
      { singletonKey: `renew-teams-meeting-artifact-subscriptions:${tenantId}` }
    );
    return result.jobId;
  } catch (error) {
    logger.error('Failed to schedule Teams meeting artifact subscription renewal job', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const scheduleTeamsMeetingSweepJob = async (
  tenantId: string,
  cronExpression: string = '*/10 * * * *'
): Promise<string | null> => {
  // Runner-agnostic like the renewal schedule above: Temporal deployments get
  // the sweep from the global maintenance fan-out; pg-boss-backed runners get
  // a per-tenant recurring schedule via IJobRunner.
  try {
    const runner = await getJobRunnerInstance();
    if (runner.getRunnerType() === 'temporal') {
      return null;
    }
    const result = await runner.scheduleRecurringJob<TeamsMeetingSweepJobData & { tenantId: string }>(
      TEAMS_MEETING_SWEEP_JOB,
      { tenantId },
      cronExpression,
      { singletonKey: `${TEAMS_MEETING_SWEEP_JOB}:${tenantId}` }
    );
    return result.jobId;
  } catch (error) {
    logger.error('Failed to schedule Teams meeting sweep job', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

// Note: Password reset token cleanup is handled automatically during token operations
// No scheduled job needed since pg-boss is unreliable and auto-cleanup is more efficient

export const scheduleDateTriggerScanJob = async (tenantId: string, cronExpression: string = '5 * * * *'): Promise<string | null> => {
  if (isEnterpriseWorkflowEdition()) return null;
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<DateTriggerScanJobData>(
    'date-trigger-scan',
    { tenantId },
    cronExpression,
    { singletonKey: `date-trigger-scan:${tenantId}` }
  );
  return result.jobId;
};

/**
 * Recurring-ticket generation sweep. CE runs it as a per-tenant pg-boss schedule; EE runs it from the
 * global maintenance fan-out schedule (generate-recurring-tickets), so this returns null there.
 *
 * Goes through the job runner, not the legacy JobScheduler: that one degrades a sub-daily cron to once
 * every 24 hours, which would turn a 15-minute sweep into a daily one.
 */
export const scheduleGenerateRecurringTicketsJob = async (
  tenantId: string,
  cronExpression: string = GENERATE_RECURRING_TICKETS_CRON
): Promise<string | null> => {
  if (isEnterpriseWorkflowEdition()) return null;
  const runner = await getJobRunnerInstance();
  const result = await runner.scheduleRecurringJob<GenerateRecurringTicketsJobData>(
    GENERATE_RECURRING_TICKETS_JOB,
    { tenantId },
    cronExpression,
    { singletonKey: `${GENERATE_RECURRING_TICKETS_JOB}:${tenantId}` }
  );
  return result.jobId;
};
