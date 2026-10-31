import type { Job } from 'pg-boss';
import { getConnection } from '@alga-psa/db';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import {
  coManagedUploadCleanupJob,
  registerCoManagedUploadCleanupJob,
  registerUploadCleanupAdapter,
  CO_MANAGED_UPLOAD_CLEANUP_JOB,
} from '@alga-psa/jobs/handlers/coManagedUploadCleanupHandler';
import { cleanupCommentAttachmentDrafts } from './cleanupCommentAttachmentDrafts';

export { CO_MANAGED_UPLOAD_CLEANUP_JOB };
export interface CoManagedUploadCleanupJobData { tenantId?: string; limit?: number; [key: string]: unknown }

/** Base adapter: the native comment-attachment draft sweep, run by the one handler. */
registerUploadCleanupAdapter({
  name: 'comment-attachment-drafts',
  run: async (tenantId) => cleanupCommentAttachmentDrafts(await getConnection(tenantId), tenantId),
});
registerCoManagedUploadCleanupJob();

export async function coManagedUploadCleanupJobHandler(job: Job<CoManagedUploadCleanupJobData>) {
  const input = job.data || {};
  return input.tenantId ? coManagedUploadCleanupJob(String(job.id ?? ''), { tenantId: input.tenantId, limit: input.limit }) : runMaintenanceJob(CO_MANAGED_UPLOAD_CLEANUP_JOB);
}
