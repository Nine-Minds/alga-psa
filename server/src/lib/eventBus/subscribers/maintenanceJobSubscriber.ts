/**
 * Maintenance Job Subscriber
 *
 * Handles MAINTENANCE_JOB_REQUESTED events emitted by the Temporal maintenance
 * schedules (runMaintenanceJobActivity, in the worker). The worker cannot run the
 * maintenance handlers itself — they import Next.js-src-transpiled vertical
 * packages that are not Node-ESM-consumable — so execution happens here on the
 * server, where the domain graph loads. runMaintenanceJob fans the job out across
 * tenants (or runs it once for system jobs).
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';

let isRegistered = false;

export async function registerMaintenanceJobSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('MAINTENANCE_JOB_REQUESTED', handleMaintenanceJobRequested);

  isRegistered = true;
  logger.info('[MaintenanceJobSubscriber] Registered');
}

export async function unregisterMaintenanceJobSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('MAINTENANCE_JOB_REQUESTED', handleMaintenanceJobRequested);

  isRegistered = false;
  logger.info('[MaintenanceJobSubscriber] Unregistered');
}

async function handleMaintenanceJobRequested(event: unknown): Promise<void> {
  const validated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse(event);
  const { jobName } = validated.payload;

  try {
    logger.info(`[MaintenanceJobSubscriber] Running maintenance job '${jobName}'`);
    const result = await runMaintenanceJob(jobName);
    logger.info(`[MaintenanceJobSubscriber] Maintenance job '${jobName}' complete`, result);
  } catch (error) {
    logger.error(`[MaintenanceJobSubscriber] Maintenance job '${jobName}' failed`, { error });
    throw error;
  }
}
