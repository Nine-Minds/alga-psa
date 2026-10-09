import logger from '@alga-psa/core/logger';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { acquireMaintenanceJobLock } from '../eventBus/subscribers/maintenanceJobLock';
import { configureEditionDateTriggerWorkflowLauncher } from './dateTriggerWorkflowLauncher';
import { isEnterpriseEdition } from '../features';

/**
 * Make the fan-out registry ready to run any maintenance job on this server:
 * configure the edition's date-workflow launcher and register the server-local
 * (and, in CE, the CE-only) definitions. Idempotent. Loaded lazily because the
 * handlers pull the domain graph.
 */
export async function prepareMaintenanceRegistry(): Promise<void> {
  const enterprise = isEnterpriseEdition();
  configureEditionDateTriggerWorkflowLauncher(enterprise);
  const { registerServerMaintenanceJobs } = await import('./registerServerMaintenanceJobs');
  registerServerMaintenanceJobs();
  if (!enterprise) {
    const { registerCeMaintenanceJobs } = await import('./registerCeMaintenanceJobs');
    registerCeMaintenanceJobs();
  }
}

/**
 * Run a maintenance job across the install, never concurrently with another run
 * of the same job anywhere in the cluster. A run that finds the lock held is
 * skipped. Shared by the EE Temporal subscriber and the CE pg-boss fan-out worker.
 */
export async function runMaintenanceJobExclusive(jobName: string): Promise<void> {
  const lock = await acquireMaintenanceJobLock(jobName);
  if (!lock) {
    logger.info(`[MaintenanceJobSubscriber] Skipping maintenance job '${jobName}': a run is already in progress`);
    return;
  }
  try {
    logger.info(`[MaintenanceJobSubscriber] Running maintenance job '${jobName}'`);
    const result = await runMaintenanceJob(jobName);
    logger.info(`[MaintenanceJobSubscriber] Maintenance job '${jobName}' complete`, result);
  } finally {
    await lock.release();
  }
}
