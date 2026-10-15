import logger from '@alga-psa/core/logger';
import type { IJobRunner } from './interfaces';
import { CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME } from './handlers/replenishContractCadenceServicePeriodsHandler';
import { getJobRunnerInstance } from './initializeJobRunner';

/** Daily at 04:00 UTC, mirroring the Temporal maintenance fan-out schedule. */
export const CONTRACT_CADENCE_REPLENISHMENT_CRON = '0 4 * * *';

export const CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID =
  `global-${CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME}`;

export type ContractCadenceReplenishmentSchedulingOutcome =
  | 'scheduled'
  | 'temporal-authority';

/**
 * Ensure the nightly contract-cadence replenishment runs on deployments where
 * Temporal is not the scheduling authority.
 *
 * The executable handler is registered on every boot through
 * `registerAllJobHandlers` (independent of schedule existence), so this only
 * owns the durable schedule. It uses the job runner's pg-boss schedule, which
 * pg-boss persists in its own `schedule` table: successive days fire, restarts
 * re-register the worker without losing the schedule, and repeated
 * initialization upserts the same schedule id rather than duplicating it.
 *
 * Enterprise (Essentials/Solo/Pro) schedules the same job on the durable
 * Temporal maintenance fan-out, so this returns without scheduling anything.
 */
export async function registerContractCadenceReplenishmentSchedule(options: {
  isEnterprise: boolean;
  getRunner?: () => IJobRunner | null;
}): Promise<ContractCadenceReplenishmentSchedulingOutcome> {
  if (options.isEnterprise) {
    logger.info(
      'Skipping pg-boss contract-cadence replenishment registration (Enterprise schedules it via the Temporal maintenance fan-out)',
    );
    return 'temporal-authority';
  }

  const runner = (options.getRunner ?? getJobRunnerInstance)();
  if (!runner) {
    throw new Error(
      'Cannot schedule contract-cadence replenishment: the job runner is not initialized.',
    );
  }

  if (runner.getRunnerType() !== 'pgboss') {
    logger.info(
      'Skipping pg-boss contract-cadence replenishment registration (runner is not pg-boss)',
      { runnerType: runner.getRunnerType() },
    );
    return 'temporal-authority';
  }

  if (typeof runner.scheduleGlobalRecurringJob !== 'function') {
    throw new Error(
      'The pg-boss job runner does not support global recurring schedules; cannot schedule contract-cadence replenishment.',
    );
  }

  await runner.scheduleGlobalRecurringJob(
    CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME,
    CONTRACT_CADENCE_REPLENISHMENT_CRON,
    { scheduleId: CONTRACT_CADENCE_REPLENISHMENT_SCHEDULE_ID },
  );

  return 'scheduled';
}
