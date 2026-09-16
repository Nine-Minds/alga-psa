import logger from '@alga-psa/core/logger';
import type { IJobScheduler } from './jobScheduler';
import {
  CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME,
  replenishContractCadenceServicePeriodsSweep,
} from './handlers/replenishContractCadenceServicePeriodsHandler';

export type ContractCadenceReplenishmentSchedulingOutcome =
  | 'scheduled'
  | 'already-scheduled'
  | 'temporal-authority';

/**
 * Registers the nightly contract-cadence replenishment on the legacy pg-boss
 * scheduler for deployments where Temporal is not the scheduling authority.
 *
 * Enterprise (Essentials/Solo/Pro) runs the same job on the durable Temporal
 * maintenance fan-out schedule, so registering it here too would execute the
 * sweep twice per day. Repeated initialization is idempotent: an already-queued
 * recurring job is left untouched.
 */
export async function registerContractCadenceReplenishmentSchedule(
  jobScheduler: IJobScheduler,
  options: { isEnterprise: boolean },
): Promise<ContractCadenceReplenishmentSchedulingOutcome> {
  if (options.isEnterprise) {
    logger.info(
      'Skipping pg-boss contract-cadence replenishment registration (Enterprise schedules it via the Temporal maintenance fan-out)',
    );
    return 'temporal-authority';
  }

  const existing = await jobScheduler.getJobs({
    jobName: CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME,
  });
  if (existing.length > 0) {
    return 'already-scheduled';
  }

  jobScheduler.registerJobHandler(CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME, async () => {
    await replenishContractCadenceServicePeriodsSweep();
  });

  await jobScheduler.scheduleRecurringJob(
    CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME,
    '24 hours',
    { tenantId: 'system' },
  );

  return 'scheduled';
}
