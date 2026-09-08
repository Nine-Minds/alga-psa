import { sendCoManagedSlaEmail } from './coManagedSlaEmailTransport';
import { persistCoManagedSlaNotifications } from '@alga-psa/notifications/lib/coManagedSlaNotifications';
import { getConnection } from '@alga-psa/db';
import { observeDueCoManagedTicketSlas, processCoManagedSlaEmailDeliveries } from '@alga-psa/co-managed';
export const CO_MANAGED_SLA_OBSERVATION_JOB = 'co-managed-sla-observation';
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
