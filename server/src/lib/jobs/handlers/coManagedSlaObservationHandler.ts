import { getConnection } from '@alga-psa/db';
import { observeDueCoManagedTicketSlas, flagStaleCoManagedSlaSending } from '@alga-psa/co-managed';
import { persistCoManagedSlaNotifications } from '@alga-psa/notifications/lib/coManagedSlaNotifications';
import { deliverCoManagedSlaNotifications } from '../../notifications/coManagedSlaDelivery';

export { CO_MANAGED_SLA_OBSERVATION_JOB, CO_MANAGED_SLA_OBSERVATION_CAPABILITY, defineCoManagedSlaObservationJob } from './coManagedSlaObservationJob';

/** One tenant's pass: observe running obligations, capture retained crossings as owed L5 deliveries, deliver them. */
export async function coManagedSlaObservationHandler(input: { tenantId: string }) {
  const db = await getConnection(input.tenantId);
  const failures: unknown[] = [];
  let observation, notifications, deliveries;
  try { observation = await observeDueCoManagedTicketSlas(db, input.tenantId); } catch (error) { failures.push(error); }
  // A failed clock must not prevent delivery of already retained crossings.
  try { notifications = await persistCoManagedSlaNotifications(db, input.tenantId); } catch (error) { failures.push(error); }
  // Unknown-outcome `sending` rows are flagged for reconciliation before delivery runs, so they are never resent.
  let flagged = 0;
  try { flagged = await flagStaleCoManagedSlaSending(db, input.tenantId); } catch (error) { failures.push(error); }
  try { deliveries = await deliverCoManagedSlaNotifications(db, input.tenantId); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'SLA maintenance has unfinished work');
  return { observation, notifications, flagged, deliveries };
}
