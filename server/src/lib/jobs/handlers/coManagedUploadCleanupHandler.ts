import { getConnection } from '@alga-psa/db';
import { filterServed } from '@alga-psa/core/capability';
import { cleanupCoManagedUploads, cleanupCoManagedThreadTransfers } from '@alga-psa/co-managed';
import { registerJobCapabilityFilter, getJobCapabilityFilter, registerMaintenanceJob } from '@alga-psa/jobs/fanout';
import {
  coManagedUploadCleanupJobDef,
  registerUploadCleanupAdapter,
  CO_MANAGED_UPLOAD_CLEANUP_JOB,
} from '@alga-psa/jobs/handlers/coManagedUploadCleanupHandler';

export { CO_MANAGED_UPLOAD_CLEANUP_JOB };

async function removeFromStorage(path: string): Promise<void> {
  const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
  await (await StorageProviderFactory.createProvider()).delete(path);
}

/**
 * Boot registration (called from registerServerMaintenanceJobs): the co-managed
 * sweep adapter, the capability filter capability-gated jobs require, and the
 * fan-out definition. The schedule is NOT registered here: it is static in
 * MAINTENANCE_FANOUT_SCHEDULES / CE_SHARED_MAINTENANCE_JOBS so both schedulers see it without server boot.
 *
 * Decision: the base `cleanupCommentAttachmentDrafts` is deliberately NOT an
 * adapter here. It already runs for every draft tenant from
 * publishScheduledCommentHandler; this job only reaches co-managed-served tenants,
 * so adding it would double-sweep them and does nothing for native tenants.
 */
export function registerCoManagedUploadCleanup(): void {
  registerUploadCleanupAdapter({
    name: 'co-managed',
    async run(tenantId, limit) {
      const db = await getConnection(tenantId);
      return {
        uploads: await cleanupCoManagedUploads(db, tenantId, removeFromStorage, limit),
        transfers: await cleanupCoManagedThreadTransfers(db, tenantId, removeFromStorage, limit),
      };
    },
  });
  if (!getJobCapabilityFilter()) {
    registerJobCapabilityFilter((capability, tenantIds) => filterServed(capability as Parameters<typeof filterServed>[0], tenantIds));
  }
  registerMaintenanceJob(CO_MANAGED_UPLOAD_CLEANUP_JOB, coManagedUploadCleanupJobDef);
}
