import { defineJob } from '@alga-psa/jobs/fanout';

export const CO_MANAGED_SLA_OBSERVATION_JOB = 'co-managed-sla-observation';
export const CO_MANAGED_SLA_OBSERVATION_CAPABILITY = 'co-managed';

// Kept free of the handler's import graph (co-managed, notifications, delivery): job registration runs on the
// worker boot path, and the handler is only loaded when the job first runs.
/**
 * Declares the job as data. `capability` makes the fan-out ask the registered filter which tenants are
 * served BEFORE any tenant run, so plain PSA tenants never reach a statement against the SLA tables. No
 * `tenants` selector is used: a selector would itself query tables ahead of the capability filter.
 * The filter itself is wired once by the job-registry boot (`wireJobCapabilityFilter`); this definition
 * registers none, so it cannot replace another job's. Without the wiring the fan-out skips the job.
 * Idempotent, because the registry is reached from more than one boot path.
 */
export function defineCoManagedSlaObservationJob(): void {
  try {
    defineJob({ name: CO_MANAGED_SLA_OBSERVATION_JOB, scope: 'tenant', capability: CO_MANAGED_SLA_OBSERVATION_CAPABILITY,
      schedule: { cron: '*/1 * * * *' }, run: async tenantId => (await import('./coManagedSlaObservationHandler')).coManagedSlaObservationHandler({ tenantId }) });
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('duplicate job name'))) throw error;
  }
}
