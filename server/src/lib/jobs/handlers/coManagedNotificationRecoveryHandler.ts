import type { Job } from 'pg-boss';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { coManagedNotificationRecoveryHandler, CO_MANAGED_NOTIFICATION_RECOVERY_JOB } from '@alga-psa/jobs/handlers/coManagedNotificationRecoveryHandler';
export { CO_MANAGED_NOTIFICATION_RECOVERY_JOB };
export interface CoManagedNotificationRecoveryJobData { tenantId?: string; limit?: number; [key: string]: unknown }
export async function coManagedNotificationRecoveryJobHandler(job: Job<CoManagedNotificationRecoveryJobData>) {
  const input = job.data || {};
  return input.tenantId ? coManagedNotificationRecoveryHandler({ tenantId: input.tenantId, limit: input.limit })
    : runMaintenanceJob(CO_MANAGED_NOTIFICATION_RECOVERY_JOB);
}
