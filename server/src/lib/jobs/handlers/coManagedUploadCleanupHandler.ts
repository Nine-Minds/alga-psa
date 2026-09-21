import type { Job } from 'pg-boss';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { coManagedUploadCleanupHandler, CO_MANAGED_UPLOAD_CLEANUP_JOB } from '@alga-psa/jobs/handlers/coManagedUploadCleanupHandler';
export { CO_MANAGED_UPLOAD_CLEANUP_JOB };
export interface CoManagedUploadCleanupJobData { tenantId?: string; limit?: number; [key: string]: unknown }
export async function coManagedUploadCleanupJobHandler(job: Job<CoManagedUploadCleanupJobData>) {
  const input = job.data || {};
  return input.tenantId ? coManagedUploadCleanupHandler({ tenantId: input.tenantId, limit: input.limit }) : runMaintenanceJob(CO_MANAGED_UPLOAD_CLEANUP_JOB);
}
