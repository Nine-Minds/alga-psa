import type { Job } from 'pg-boss';
import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { coManagedSlaObservationHandler, CO_MANAGED_SLA_OBSERVATION_JOB } from '@alga-psa/jobs/handlers/coManagedSlaObservationHandler';
export { CO_MANAGED_SLA_OBSERVATION_JOB };
export interface CoManagedSlaObservationJobData { tenantId?: string; [key: string]: unknown }
export async function coManagedSlaObservationJobHandler(job: Job<CoManagedSlaObservationJobData>) {
  const input = job.data || {};
  return input.tenantId ? coManagedSlaObservationHandler({ tenantId: input.tenantId })
    : runMaintenanceJob(CO_MANAGED_SLA_OBSERVATION_JOB);
}
