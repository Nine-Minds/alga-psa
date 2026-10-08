import { initializeScheduler, scheduleQuoteAutoExpirationJob, scheduleDateTriggerScanJob, scheduleGenerateRecurringTicketsJob, scheduleOpportunityDisciplineJob, scheduleOpportunityWeeklyDigestJob, scheduleOpportunityGeneratorsJob, scheduleMarketingFlipDuePostsJob, scheduleMarketingExpireStaleTargetsJob, scheduleMarketingSendSequenceStepsJob, scheduleProjectDateReadinessJob } from './index';
import logger from '@alga-psa/core/logger';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { scheduleMarketingJobsForTenant } from './marketingScheduleCutover';
import { initializeJobRunner } from './initializeJobRunner';
import { convergeCeMaintenanceSchedules } from './convergeCeMaintenanceSchedules';

const isEnterpriseWorkflowEdition = (): boolean =>
  process.env.EDITION === 'enterprise'
  || process.env.EDITION === 'ee'
  || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

/**
 * Initialize all scheduled jobs for the application.
 *
 * CE converges its global maintenance fan-out schedules and its remaining per-tenant pg-boss schedules here. EE/appliance does not:
 * every recurring job there is a global Temporal schedule owned by the worker
 * (packages/types/src/constants/maintenanceFanoutSchedules.ts), so boot
 * time never grows with the tenant count.
 */
export async function initializeScheduledJobs(): Promise<void> {
  try {
    // Registers the legacy pg-boss handlers, which both editions still need
    // for immediate jobs (invoice generation, imports, ...).
    await initializeScheduler();
    logger.info('Job scheduler initialized');

    if (isEnterpriseWorkflowEdition()) {
      logger.info('Skipping server-side recurring schedule convergence (Temporal owns recurring schedules in EE)');
      return;
    }

    // Every recurring maintenance job (credits, auto-close, SLA, ...) runs from one
    // global pg-boss cron schedule each, which fans out across tenants on every
    // firing, so new tenants are covered without a restart.
    await convergeCeMaintenanceSchedules(await initializeJobRunner());

    // Get all tenants using root connection
    const knex = await getConnection(null);
    const tenants = await tenantDb(knex, '__scheduled_jobs_tenant_enumeration__')
      .unscoped('tenants', 'scheduler enumerates all tenants to register recurring jobs')
      .whereNull('suspended_at')
      .select('tenant');
    logger.info(`Preparing to schedule jobs for ${tenants.length} tenants`);
    
    // LEVERAGE: pattern ce-per-tenant-runner-schedules — the jobs below still schedule one pg-boss cron per tenant (queues, pollers and `jobs` rows grow with jobs x tenants); they belong on the global maintenance-fanout schedules.
    // Remaining per-tenant runner-path schedules
    for (const tenantRecord of tenants) {
      const tenantId = tenantRecord.tenant;

      try {
        const disciplineJobId = await scheduleOpportunityDisciplineJob(tenantId, '0 7 * * *');
        logger.info('Opportunity discipline schedule converged', { tenantId, disciplineJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity discipline job for tenant ${tenantId}`, error);
      }

      try {
        const generatorsJobId = await scheduleOpportunityGeneratorsJob(tenantId, '0 6 * * *');
        logger.info('Opportunity generators schedule converged', { tenantId, generatorsJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity generators job for tenant ${tenantId}`, error);
      }

      try {
        const cron = '15 0 * * *';
        const readinessJobId = await scheduleProjectDateReadinessJob(tenantId, cron);
        logger.info('Project date readiness schedule converged', { tenantId, readinessJobId, cron });
      } catch (error) {
        logger.error(`Failed to schedule project date readiness job for tenant ${tenantId}`, error);
      }

      try {
        const digestJobId = await scheduleOpportunityWeeklyDigestJob(tenantId, '0 8 * * 1');
        logger.info('Opportunity weekly digest schedule converged', { tenantId, digestJobId });
      } catch (error) {
        logger.error(`Failed to schedule opportunity weekly digest job for tenant ${tenantId}`, error);
      }

      try { await scheduleDateTriggerScanJob(tenantId, '5 * * * *'); } catch (error) { logger.error(`Failed to schedule workflow date trigger scan for tenant ${tenantId}`, error); }

      try { await scheduleGenerateRecurringTicketsJob(tenantId); } catch (error) { logger.error(`Failed to schedule recurring ticket generation for tenant ${tenantId}`, error); }

      await scheduleMarketingJobsForTenant({
        tenantId,
        enterpriseWorkflowEdition: false,
        dependencies: {
          logger,
          scheduleFlipDuePosts: scheduleMarketingFlipDuePostsJob,
          scheduleExpireStaleTargets: scheduleMarketingExpireStaleTargetsJob,
          scheduleSendSequenceSteps: scheduleMarketingSendSequenceStepsJob,
        },
      });
   }

   logger.info('All scheduled jobs initialized');
  } catch (error: any) {
    logger.error('Failed to initialize scheduled jobs', error);
    throw error;
  }
}
