import { getConnection } from '@alga-psa/db';
import { defineJob } from '@alga-psa/jobs/fanout';
import { observeDueCoManagedTicketSlas, processCoManagedSlaEmailDeliveries } from '@alga-psa/co-managed';
import { persistCoManagedSlaNotifications } from '@alga-psa/notifications/lib/coManagedSlaNotifications';
import { sendCoManagedSlaEmail } from './coManagedSlaEmailTransport';

export const CO_MANAGED_SLA_OBSERVATION_JOB = 'co-managed-sla-observation';
export const CO_MANAGED_SLA_OBSERVATION_CAPABILITY = 'co-managed';

/** One tenant's pass: observe running obligations, fan retained crossings out, send due email. */
export async function coManagedSlaObservationHandler(input: { tenantId: string }) {
  const db = await getConnection(input.tenantId);
  const failures: unknown[] = [];
  let observation, notifications, emails;
  try { observation = await observeDueCoManagedTicketSlas(db, input.tenantId); } catch (error) { failures.push(error); }
  // A failed clock must not prevent delivery of already retained crossings.
  try { notifications = await persistCoManagedSlaNotifications(db, input.tenantId); } catch (error) { failures.push(error); }
  try { emails = await processCoManagedSlaEmailDeliveries(db, input.tenantId, sendCoManagedSlaEmail); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'SLA maintenance has unfinished work');
  return { observation, notifications, emails };
}

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
      schedule: { cron: '*/1 * * * *' }, run: tenantId => coManagedSlaObservationHandler({ tenantId }) });
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('duplicate job name'))) throw error;
  }
}
