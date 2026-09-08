import { getConnection } from '@alga-psa/db';
import { observeDueCoManagedTicketSlas } from '@alga-psa/co-managed';
export const CO_MANAGED_SLA_OBSERVATION_JOB = 'co-managed-sla-observation';
export async function coManagedSlaObservationHandler(input: { tenantId: string }) {
  return observeDueCoManagedTicketSlas(await getConnection(input.tenantId), input.tenantId);
}
