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
import { runMaintenanceJob, isKnownMaintenanceJob } from '@alga-psa/jobs/fanout';
// IMPORTANT: use the SERVER-LOCAL registry — registerAllHandlers populates
// server/src/lib/jobs/jobHandlerRegistry (a different singleton than the
// @alga-psa/jobs one), so rmm/huntress are only registered there.
import { executeJobHandler } from '../../jobs/jobHandlerRegistry';
import { runWithTenant } from '@alga-psa/db';

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
  const { jobName, jobId, data, tenantId } = validated.payload;

  try {
    if (isKnownMaintenanceJob(jobName)) {
      // Global maintenance fan-out: run once / across all tenants.
      logger.info(`[MaintenanceJobSubscriber] Running maintenance job '${jobName}'`);
      const result = await runMaintenanceJob(jobName);
      logger.info(`[MaintenanceJobSubscriber] Maintenance job '${jobName}' complete`, result);
    } else {
      // Worker-scheduled job (e.g. rmm/huntress) forwarded for server-side
      // execution because its handler imports src-consumed packages the worker
      // can't load. Run the registered handler directly for the tenant.
      logger.info(`[MaintenanceJobSubscriber] Running forwarded job '${jobName}' for tenant ${tenantId}`);
      await runWithTenant(tenantId, () =>
        executeJobHandler(jobName, jobId ?? `evt:${jobName}`, (data ?? {}) as any),
      );
      logger.info(`[MaintenanceJobSubscriber] Forwarded job '${jobName}' complete`);
    }
  } catch (error) {
    logger.error(`[MaintenanceJobSubscriber] Job '${jobName}' failed`, { error });
    throw error;
  }
}
